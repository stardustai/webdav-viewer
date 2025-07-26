use async_trait::async_trait;
use reqwest::Client;
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use chrono::Utc;
use hmac::{Hmac, Mac};
use sha1;
use url::Url;
use urlencoding;
use quick_xml::Reader;
use quick_xml::events::Event;
use base64::Engine;

use crate::storage::traits::{
    StorageClient, StorageRequest, StorageResponse, StorageError,
    ConnectionConfig, StorageCapabilities, DirectoryResult, StorageFile, ListOptions
};

pub struct OSSClient {
    client: Client,
    config: ConnectionConfig,
    connected: AtomicBool,
    endpoint: String,
    access_key: String,
    secret_key: String,
    bucket: String,
    region: Option<String>,
}

impl OSSClient {
    pub fn new(config: ConnectionConfig) -> Result<Self, StorageError> {
        let endpoint = config.url.clone()
            .ok_or_else(|| StorageError::InvalidConfig("OSS endpoint is required".to_string()))?;

        let access_key = config.access_key.clone()
            .ok_or_else(|| StorageError::InvalidConfig("OSS access key is required".to_string()))?;

        let secret_key = config.secret_key.clone()
            .ok_or_else(|| StorageError::InvalidConfig("OSS secret key is required".to_string()))?;

        let bucket = config.bucket.clone()
            .ok_or_else(|| StorageError::InvalidConfig("OSS bucket is required".to_string()))?;

        let region = config.region.clone();

        Ok(Self {
            client: Client::new(),
            config,
            connected: AtomicBool::new(false),
            endpoint,
            access_key,
            secret_key,
            bucket,
            region,
        })
    }

    /// 生成 OSS 签名
    fn generate_signature(
        &self,
        method: &str,
        uri: &str,
        headers: &HashMap<String, String>,
        date: &str,
    ) -> String {
        // 构建签名字符串
        let mut string_to_sign = format!("{}\n", method);

        // Content-MD5
        string_to_sign.push_str(&format!("{}\n", headers.get("Content-MD5").unwrap_or(&String::new())));

        // Content-Type
        string_to_sign.push_str(&format!("{}\n", headers.get("Content-Type").unwrap_or(&String::new())));

        // Date
        string_to_sign.push_str(&format!("{}\n", date));

        // Canonicalized OSS Headers
        let mut oss_headers: Vec<_> = headers
            .iter()
            .filter(|(k, _)| k.to_lowercase().starts_with("x-oss-"))
            .collect();
        oss_headers.sort_by(|a, b| a.0.cmp(b.0));

        for (key, value) in oss_headers {
            string_to_sign.push_str(&format!("{}:{}\n", key.to_lowercase(), value));
        }

        // Canonicalized Resource
        // 根据OSS文档，签名中的URI应该是解码后的UTF-8形式
        let normalized_uri = self.normalize_uri_for_signing(&uri);

        let canonicalized_resource = if normalized_uri == "/" {
            format!("/{}/", self.bucket)
        } else {
            format!("/{}{}", self.bucket, normalized_uri)
        };

        string_to_sign.push_str(&canonicalized_resource);

        // 打印调试信息（仅在开发环境）
        #[cfg(debug_assertions)]
        {
            println!("DEBUG: StringToSign:");
            println!("{}", string_to_sign);
            println!("DEBUG: StringToSign bytes: {:?}", string_to_sign.as_bytes());

            // 如果需要测试签名生成，应该使用环境变量或测试配置文件
            // 而不是硬编码凭据
        }

        // 计算 HMAC-SHA1 签名
        type HmacSha1 = Hmac<sha1::Sha1>;
        let mut mac = HmacSha1::new_from_slice(self.secret_key.as_bytes())
            .expect("HMAC can take key of any size");
        mac.update(string_to_sign.as_bytes());
        let result = mac.finalize();
        let signature = base64::engine::general_purpose::STANDARD.encode(result.into_bytes());

        // 打印调试信息（仅在开发环境）
        #[cfg(debug_assertions)]
        {
            println!("DEBUG: Generated signature: {}", signature);
            println!("DEBUG: Secret key length: {}", self.secret_key.len());
        }

        signature
    }

    /// 构建认证头
    fn build_auth_headers(&self, method: &str, uri: &str, extra_headers: &HashMap<String, String>) -> HashMap<String, String> {
        let now = Utc::now();
        let date = now.format("%a, %d %b %Y %H:%M:%S GMT").to_string();

        let mut headers = extra_headers.clone();
        headers.insert("Date".to_string(), date.clone());
        headers.insert("Host".to_string(), self.get_host());

        let signature = self.generate_signature(method, uri, &headers, &date);
        let authorization = format!("OSS {}:{}", self.access_key, signature);

        headers.insert("Authorization".to_string(), authorization);
        headers
    }

    /// 获取主机名
    fn get_host(&self) -> String {
        if let Ok(url) = Url::parse(&self.endpoint) {
            url.host_str().unwrap_or("").to_string()
        } else {
            "".to_string()
        }
    }

    /// 构建对象的完整 URL
    fn build_object_url(&self, object_key: &str) -> String {
        // 对对象键进行URL编码，以正确处理中文和特殊字符
        let encoded_key = urlencoding::encode(object_key);
        format!("{}/{}", self.endpoint.trim_end_matches('/'), encoded_key)
    }

    /// 解析 XML 列表响应
    fn parse_list_objects_response(&self, xml_content: &str, prefix: &str) -> Result<DirectoryResult, StorageError> {
        let mut reader = Reader::from_str(xml_content);
        reader.trim_text(true);

        let mut files = Vec::new();
        let mut buf = Vec::new();
        let mut current_object: Option<StorageFile> = None;
        let mut current_prefix: Option<String> = None;
        let mut current_text = String::new();
        let mut is_truncated = false;
        let mut next_marker: Option<String> = None;

        loop {
            match reader.read_event_into(&mut buf) {
                Ok(Event::Start(ref e)) => {
                    let element_name = String::from_utf8_lossy(e.name().as_ref()).to_string();
                    if element_name == "Contents" {
                        current_object = Some(StorageFile {
                            filename: String::new(),
                            basename: String::new(),
                            lastmod: String::new(),
                            size: 0,
                            file_type: "file".to_string(),
                            mime: None,
                            etag: None,
                        });
                    } else if element_name == "CommonPrefixes" {
                        current_prefix = Some(String::new());
                    }
                    current_text.clear();
                }
                Ok(Event::Text(e)) => {
                    current_text = e.unescape().unwrap_or_default().to_string();
                }
                Ok(Event::End(ref e)) => {
                    let element_name_bytes = e.name();
                    let element_name = String::from_utf8_lossy(element_name_bytes.as_ref());

                    if let Some(ref mut obj) = current_object {
                        match element_name.as_ref() {
                            "Key" => {
                                obj.filename = current_text.clone();
                                obj.basename = current_text.rsplit('/').next().unwrap_or(&current_text).to_string();
                            }
                            "LastModified" => {
                                obj.lastmod = current_text.clone();
                            }
                            "Size" => {
                                obj.size = current_text.parse().unwrap_or(0);
                            }
                            "ETag" => {
                                obj.etag = Some(current_text.trim_matches('"').to_string());
                            }
                            "Contents" => {
                                if let Some(obj) = current_object.take() {
                                    // 只添加当前前缀下的直接子项
                                    let relative_path = obj.filename.strip_prefix(prefix).unwrap_or(&obj.filename);
                                    if !relative_path.is_empty() && !relative_path.contains('/') {
                                        files.push(obj);
                                    }
                                }
                            }
                            _ => {}
                        }
                    }

                    // 处理 CommonPrefixes (文件夹)
                    if let Some(ref mut prefix_val) = current_prefix {
                        match element_name.as_ref() {
                            "Prefix" => {
                                *prefix_val = current_text.clone();
                            }
                            "CommonPrefixes" => {
                                if let Some(prefix_path) = current_prefix.take() {
                                    // 只添加当前前缀下的直接子目录
                                    let relative_path = prefix_path.strip_prefix(prefix).unwrap_or(&prefix_path);
                                    if !relative_path.is_empty() && !relative_path.trim_end_matches('/').contains('/') {
                                        let dir_name = relative_path.trim_end_matches('/');
                                        files.push(StorageFile {
                                            filename: prefix_path.clone(),
                                            basename: dir_name.to_string(),
                                            lastmod: chrono::Utc::now().to_rfc3339(),
                                            size: 0,
                                            file_type: "directory".to_string(),
                                            mime: None,
                                            etag: None,
                                        });
                                    }
                                }
                            }
                            _ => {}
                        }
                    }

                    match element_name.as_ref() {
                        "IsTruncated" => {
                            is_truncated = current_text == "true";
                        }
                        "NextMarker" => {
                            next_marker = Some(current_text.clone());
                        }
                        _ => {}
                    }
                }
                Ok(Event::Eof) => break,
                Err(e) => return Err(StorageError::RequestFailed(format!("XML parsing error: {}", e))),
                _ => {}
            }
            buf.clear();
        }

        Ok(DirectoryResult {
            files,
            has_more: is_truncated,
            next_marker,
            total_count: None,
            path: prefix.to_string(),
        })
    }

    /// 标准化 URI 路径，处理编码/解码
    fn normalize_uri_for_signing(&self, uri: &str) -> String {
        match urlencoding::decode(uri) {
            Ok(decoded) => decoded.to_string(),
            Err(_) => {
                // 如果解码失败，可能路径本身就没有编码
                if uri.starts_with('/') {
                    uri.to_string()
                } else {
                    format!("/{}", uri)
                }
            }
        }
    }
}

#[async_trait]
impl StorageClient for OSSClient {
    async fn connect(&mut self, config: &ConnectionConfig) -> Result<(), StorageError> {
        // 更新配置
        self.config = config.clone();

        if let Some(endpoint) = &config.url {
            self.endpoint = endpoint.clone();
        }
        if let Some(access_key) = &config.access_key {
            self.access_key = access_key.clone();
        }
        if let Some(secret_key) = &config.secret_key {
            self.secret_key = secret_key.clone();
        }
        if let Some(bucket) = &config.bucket {
            self.bucket = bucket.clone();
        }
        self.region = config.region.clone();

        // 测试连接 - 直接使用标准化后的端点
        let uri = "/";
        let headers = self.build_auth_headers("GET", &uri, &HashMap::new());

        let url = format!("{}/", self.endpoint.trim_end_matches('/'));
        let mut req_builder = self.client.get(&url);

        for (key, value) in headers {
            req_builder = req_builder.header(&key, &value);
        }

        let response = req_builder.send().await
            .map_err(|e| StorageError::NetworkError(format!("OSS connection test failed: {}", e)))?;

        if response.status().is_success() {
            self.connected.store(true, Ordering::Relaxed);
            Ok(())
        } else {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            Err(StorageError::RequestFailed(format!(
                "OSS connection test failed with status {}: {}",
                status, body
            )))
        }
    }

    async fn disconnect(&self) {
        self.connected.store(false, Ordering::Relaxed);
    }

    async fn is_connected(&self) -> bool {
        self.connected.load(Ordering::Relaxed)
    }

    async fn request(&self, req: &StorageRequest) -> Result<StorageResponse, StorageError> {
        if !self.is_connected().await {
            return Err(StorageError::NotConnected);
        }

        let url = &req.url;
        let uri = if let Ok(parsed_url) = Url::parse(url) {
            // 只提取路径部分，不包含查询参数
            // URL路径已经是编码的，这里直接使用
            parsed_url.path().to_string()
        } else {
            // 如果无法解析为完整 URL，则尝试提取路径部分
            if let Some(path_end) = url.find('?') {
                url[..path_end].to_string()
            } else {
                url.clone()
            }
        };

        // 对于签名，使用解码后的URI（OSS签名需要原始的未编码路径）
        let signing_uri = self.normalize_uri_for_signing(&uri);

        // 构建认证头
        // 对于 LIST 请求，实际的 HTTP 方法是 GET
        let signing_method = if req.method == "LIST" { "GET" } else { &req.method };
        let auth_headers = self.build_auth_headers(signing_method, &signing_uri, &req.headers);

        // 发送请求
        let mut req_builder = match req.method.as_str() {
            "GET" => self.client.get(url),
            "HEAD" => self.client.head(url),
            "PUT" => self.client.put(url),
            "POST" => self.client.post(url),
            "DELETE" => self.client.delete(url),
            "LIST" => {
                // 特殊处理列表请求
                let query_params = if let Some(body) = &req.body {
                    serde_json::from_str::<serde_json::Value>(body)
                        .map_err(|e| StorageError::RequestFailed(format!("Invalid list request body: {}", e)))?
                } else {
                    serde_json::Value::Null
                };

                // 构建 LIST 请求 URL - 直接使用标准化的端点
                let mut list_url = format!("{}/?list-type=2", self.endpoint.trim_end_matches('/'));

                if let Some(prefix) = query_params.get("prefix").and_then(|v| v.as_str()) {
                    if !prefix.is_empty() {
                        list_url.push_str(&format!("&prefix={}", urlencoding::encode(prefix)));
                    }
                }
                if let Some(delimiter) = query_params.get("delimiter").and_then(|v| v.as_str()) {
                    list_url.push_str(&format!("&delimiter={}", urlencoding::encode(delimiter)));
                }
                if let Some(max_keys) = query_params.get("max-keys").and_then(|v| v.as_u64()) {
                    list_url.push_str(&format!("&max-keys={}", max_keys));
                }
                if let Some(marker) = query_params.get("marker").and_then(|v| v.as_str()) {
                    list_url.push_str(&format!("&continuation-token={}", urlencoding::encode(marker)));
                }

                self.client.get(&list_url)
            }
            _ => return Err(StorageError::RequestFailed(format!("Unsupported method: {}", req.method))),
        };

        // 添加认证头
        for (key, value) in auth_headers {
            req_builder = req_builder.header(&key, &value);
        }

        // 添加请求体
        if let Some(body) = &req.body {
            if req.method != "LIST" {
                req_builder = req_builder.body(body.clone());
            }
        }

        let response = req_builder.send().await
            .map_err(|e| StorageError::NetworkError(format!("Request failed: {}", e)))?;

        let status = response.status().as_u16();
        let headers: HashMap<String, String> = response
            .headers()
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_str().unwrap_or("").to_string()))
            .collect();

        let body = response.text().await.unwrap_or_default();

        Ok(StorageResponse {
            status,
            headers,
            body,
            metadata: None,
        })
    }

    async fn request_binary(&self, req: &StorageRequest) -> Result<Vec<u8>, StorageError> {
        if !self.is_connected().await {
            return Err(StorageError::NotConnected);
        }

        let uri = if let Ok(parsed_url) = Url::parse(&req.url) {
            parsed_url.path().to_string()
        } else {
            req.url.clone()
        };

        // 对于签名，使用解码后的URI（OSS签名需要原始的未编码路径）
        let signing_uri = match urlencoding::decode(&uri) {
            Ok(decoded) => decoded.to_string(),
            Err(_) => {
                // 如果解码失败，可能路径本身就没有编码，直接使用
                if uri.starts_with('/') {
                    uri
                } else {
                    format!("/{}", uri)
                }
            }
        };

        let auth_headers = self.build_auth_headers(&req.method, &signing_uri, &req.headers);

        let mut req_builder = match req.method.as_str() {
            "GET" => self.client.get(&req.url),
            "HEAD" => self.client.head(&req.url),
            _ => return Err(StorageError::RequestFailed(format!("Unsupported binary method: {}", req.method))),
        };

        for (key, value) in auth_headers {
            req_builder = req_builder.header(&key, &value);
        }

        let response = req_builder.send().await
            .map_err(|e| StorageError::NetworkError(format!("Binary request failed: {}", e)))?;

        if !response.status().is_success() {
            return Err(StorageError::RequestFailed(format!(
                "Binary request failed with status: {}",
                response.status()
            )));
        }

        response.bytes().await
            .map(|bytes| bytes.to_vec())
            .map_err(|e| StorageError::RequestFailed(format!("Failed to read response body: {}", e)))
    }

    async fn read_file_range(&self, path: &str, start: u64, length: u64) -> Result<Vec<u8>, StorageError> {
        if !self.is_connected().await {
            return Err(StorageError::NotConnected);
        }

        println!("OSS读取文件范围: path={}, start={}, length={}", path, start, length);

        let object_key = path.trim_start_matches('/');
        let url = self.build_object_url(object_key);

        println!("构建的URL: {}", url);

        let uri = if let Ok(parsed_url) = Url::parse(&url) {
            parsed_url.path().to_string()
        } else {
            // 如果无法解析URL，则直接使用编码后的路径
            format!("/{}", urlencoding::encode(object_key))
        };

        // 对于签名，使用解码后的URI（OSS签名需要原始的未编码路径）
        let signing_uri = match urlencoding::decode(&uri) {
            Ok(decoded) => decoded.to_string(),
            Err(_) => {
                // 如果解码失败，可能路径本身就没有编码，直接使用
                if uri.starts_with('/') {
                    uri
                } else {
                    format!("/{}", uri)
                }
            }
        };

        let mut headers = HashMap::new();
        // 添加范围请求头
        let end = start + length - 1;
        let range_header = format!("bytes={}-{}", start, end);
        headers.insert("Range".to_string(), range_header.clone());

        println!("Range请求头: {}", range_header);

        let auth_headers = self.build_auth_headers("GET", &signing_uri, &headers);

        let mut req_builder = self.client.get(&url);
        for (key, value) in auth_headers {
            req_builder = req_builder.header(&key, &value);
        }

        let response = req_builder.send().await
            .map_err(|e| StorageError::NetworkError(format!("Range request failed: {}", e)))?;

        let status = response.status();
        println!("OSS Range请求响应状态: {}", status);

        if !status.is_success() {
            let error_body = response.text().await.unwrap_or_default();
            println!("OSS Range请求失败，响应体: {}", error_body);
            return Err(StorageError::RequestFailed(format!(
                "Range request failed with status {}: {}",
                status, error_body
            )));
        }

        let content_length = response.headers()
            .get("content-length")
            .and_then(|v| v.to_str().ok())
            .and_then(|s| s.parse::<u64>().ok())
            .unwrap_or(0);

        println!("预期接收 {} 字节，实际Content-Length: {}", length, content_length);

        let bytes = response.bytes().await
            .map_err(|e| StorageError::RequestFailed(format!("Failed to read range content: {}", e)))?;

        println!("实际接收到 {} 字节", bytes.len());

        Ok(bytes.to_vec())
    }

    fn capabilities(&self) -> StorageCapabilities {
        StorageCapabilities {
            supports_streaming: true,
            supports_range_requests: true,
            supports_multipart_upload: false,
            supports_metadata: true,
            supports_encryption: false,
            supports_directories: true,
            max_file_size: Some(5 * 1024 * 1024 * 1024), // 5GB
            supported_methods: vec![
                "GET".to_string(),
                "HEAD".to_string(),
                "PUT".to_string(),
                "DELETE".to_string(),
            ],
        }
    }

    async fn list_directory(&self, path: &str, options: Option<&ListOptions>) -> Result<DirectoryResult, StorageError> {
        if !self.is_connected().await {
            return Err(StorageError::NotConnected);
        }

        let options = options.unwrap_or(&ListOptions {
            page_size: Some(1000),
            marker: None,
            prefix: None,
            recursive: Some(false),
            sort_by: None,
            sort_order: None,
        });

        // 标准化路径 - 对于非根目录，确保 prefix 以斜杠结尾
        let prefix = if path == "/" {
            String::new()
        } else {
            let trimmed = path.trim_start_matches('/');
            if trimmed.is_empty() {
                String::new()
            } else if trimmed.ends_with('/') {
                trimmed.to_string()
            } else {
                format!("{}/", trimmed)
            }
        };

        // 构建列表请求
        let mut list_url = format!("{}/?list-type=2", self.endpoint.trim_end_matches('/'));

        if !prefix.is_empty() {
            list_url.push_str(&format!("&prefix={}", urlencoding::encode(&prefix)));
        }
        list_url.push_str("&delimiter=/"); // 用于模拟目录结构

        if let Some(page_size) = options.page_size {
            list_url.push_str(&format!("&max-keys={}", page_size));
        }
        if let Some(marker) = &options.marker {
            list_url.push_str(&format!("&continuation-token={}", urlencoding::encode(marker)));
        }

        // 对于 list 操作，URI 应该是 /
        let auth_headers = self.build_auth_headers("GET", "/", &HashMap::new());

        let mut req_builder = self.client.get(&list_url);
        for (key, value) in auth_headers {
            req_builder = req_builder.header(&key, &value);
        }

        let response = req_builder.send().await
            .map_err(|e| StorageError::NetworkError(format!("List request failed: {}", e)))?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(StorageError::RequestFailed(format!(
                "List request failed with status {}: {}",
                status, body
            )));
        }

        let xml_content = response.text().await
            .map_err(|e| StorageError::RequestFailed(format!("Failed to read response: {}", e)))?;

        self.parse_list_objects_response(&xml_content, &prefix)
    }

    async fn read_full_file(&self, path: &str) -> Result<Vec<u8>, StorageError> {
        if !self.is_connected().await {
            return Err(StorageError::NotConnected);
        }

        println!("OSS读取完整文件: path={}", path);

        let object_key = path.trim_start_matches('/');
        let url = self.build_object_url(object_key);

        println!("构建的URL: {}", url);

        let uri = if let Ok(parsed_url) = Url::parse(&url) {
            parsed_url.path().to_string()
        } else {
            // 如果无法解析URL，则直接使用编码后的路径
            format!("/{}", urlencoding::encode(object_key))
        };

        // 对于签名，使用解码后的URI（OSS签名需要原始的未编码路径）
        let signing_uri = match urlencoding::decode(&uri) {
            Ok(decoded) => decoded.to_string(),
            Err(_) => {
                // 如果解码失败，可能路径本身就没有编码，直接使用
                if uri.starts_with('/') {
                    uri
                } else {
                    format!("/{}", uri)
                }
            }
        };

        let auth_headers = self.build_auth_headers("GET", &signing_uri, &HashMap::new());

        let mut req_builder = self.client.get(&url);
        for (key, value) in auth_headers {
            req_builder = req_builder.header(&key, &value);
        }

        let response = req_builder.send().await
            .map_err(|e| StorageError::NetworkError(format!("Get file request failed: {}", e)))?;

        let status = response.status();
        println!("OSS文件请求响应状态: {}", status);

        if !status.is_success() {
            let error_body = response.text().await.unwrap_or_default();
            println!("OSS文件请求失败，响应体: {}", error_body);
            return Err(StorageError::RequestFailed(format!(
                "Get file failed with status {}: {}",
                status, error_body
            )));
        }

        let content_length = response.headers()
            .get("content-length")
            .and_then(|v| v.to_str().ok())
            .and_then(|s| s.parse::<u64>().ok())
            .unwrap_or(0);

        println!("Content-Length: {}", content_length);

        let bytes = response.bytes().await
            .map_err(|e| StorageError::RequestFailed(format!("Failed to read file content: {}", e)))?;

        println!("实际接收到 {} 字节", bytes.len());

        Ok(bytes.to_vec())
    }

    async fn get_file_size(&self, path: &str) -> Result<u64, StorageError> {
        if !self.is_connected().await {
            return Err(StorageError::NotConnected);
        }

        let object_key = path.trim_start_matches('/');
        let url = self.build_object_url(object_key);
        let uri = if let Ok(parsed_url) = Url::parse(&url) {
            parsed_url.path().to_string()
        } else {
            // 如果无法解析URL，则直接使用编码后的路径
            format!("/{}", urlencoding::encode(object_key))
        };

        // 对于签名，使用解码后的URI（OSS签名需要原始的未编码路径）
        let signing_uri = match urlencoding::decode(&uri) {
            Ok(decoded) => decoded.to_string(),
            Err(_) => {
                // 如果解码失败，可能路径本身就没有编码，直接使用
                if uri.starts_with('/') {
                    uri
                } else {
                    format!("/{}", uri)
                }
            }
        };

        let auth_headers = self.build_auth_headers("HEAD", &signing_uri, &HashMap::new());

        let mut req_builder = self.client.head(&url);
        for (key, value) in auth_headers {
            req_builder = req_builder.header(&key, &value);
        }

        let response = req_builder.send().await
            .map_err(|e| StorageError::NetworkError(format!("Head request failed: {}", e)))?;

        if !response.status().is_success() {
            return Err(StorageError::RequestFailed(format!(
                "Head request failed with status: {}",
                response.status()
            )));
        }

        response
            .headers()
            .get("content-length")
            .and_then(|v| v.to_str().ok())
            .and_then(|s| s.parse().ok())
            .ok_or_else(|| StorageError::RequestFailed("No content-length header".to_string()))
    }

    fn protocol(&self) -> &str {
        "oss"
    }

    fn validate_config(&self, config: &ConnectionConfig) -> Result<(), StorageError> {
        if config.url.is_none() {
            return Err(StorageError::InvalidConfig("OSS endpoint is required".to_string()));
        }
        if config.access_key.is_none() {
            return Err(StorageError::InvalidConfig("OSS access key is required".to_string()));
        }
        if config.secret_key.is_none() {
            return Err(StorageError::InvalidConfig("OSS secret key is required".to_string()));
        }
        if config.bucket.is_none() {
            return Err(StorageError::InvalidConfig("OSS bucket is required".to_string()));
        }
        Ok(())
    }

    fn get_download_url(&self, path: &str) -> Result<String, StorageError> {
        // 从传入的路径/URL 中提取对象键
        let object_key = self.extract_object_key(path)?;

        // 生成 1 小时有效期的预签名下载 URL
        self.generate_download_url(&object_key, 3600)
    }
}

impl OSSClient {
    /// 从路径或 URL 中提取对象键
    fn extract_object_key(&self, input: &str) -> Result<String, StorageError> {
        if let Ok(parsed_url) = url::Url::parse(input) {
            // 是完整 URL，提取路径部分
            let path = parsed_url.path().trim_start_matches('/');
            match urlencoding::decode(path) {
                Ok(decoded) => Ok(decoded.to_string()),
                Err(_) => Ok(path.to_string()),
            }
        } else {
            // 不是完整 URL，可能是相对路径，直接使用
            // 移除开头的斜杠，OSS 对象键不应该以斜杠开头
            let normalized = input.trim_start_matches('/');
            Ok(normalized.to_string())
        }
    }

    /// 生成预签名下载 URL
    fn generate_download_url(&self, object_key: &str, expires_in_seconds: i64) -> Result<String, StorageError> {
        if !self.connected.load(Ordering::Relaxed) {
            return Err(StorageError::NotConnected);
        }

        // 计算过期时间戳
        let now = Utc::now().timestamp();
        let expires = now + expires_in_seconds;

        // 构建对象 URL
        let object_url = format!("{}/{}", self.endpoint.trim_end_matches('/'),
            urlencoding::encode(object_key));

        // 构建查询参数
        let mut query_params = HashMap::new();
        query_params.insert("OSSAccessKeyId".to_string(), self.access_key.clone());
        query_params.insert("Expires".to_string(), expires.to_string());

        // 构建待签名字符串
        let uri = format!("/{}", object_key);
        let method = "GET";
        let content_md5 = "";
        let content_type = "";

        // 构建 Canonicalized Resource
        let canonicalized_resource = format!("/{}{}", self.bucket, uri);

        // 构建签名字符串
        let string_to_sign = format!("{}\n{}\n{}\n{}\n{}",
            method, content_md5, content_type, expires, canonicalized_resource);

        // 生成签名
        let signature = self.sign_string(&string_to_sign);
        query_params.insert("Signature".to_string(), signature);

        // 构建最终 URL
        let query_string: String = query_params.iter()
            .map(|(k, v)| format!("{}={}", k, urlencoding::encode(v)))
            .collect::<Vec<_>>()
            .join("&");

        Ok(format!("{}?{}", object_url, query_string))
    }

    /// 签名字符串
    fn sign_string(&self, string_to_sign: &str) -> String {
        type HmacSha1 = Hmac<sha1::Sha1>;
        let mut mac = HmacSha1::new_from_slice(self.secret_key.as_bytes())
            .expect("HMAC can take key of any size");
        mac.update(string_to_sign.as_bytes());
        let result = mac.finalize();
        base64::engine::general_purpose::STANDARD.encode(result.into_bytes())
    }
}
