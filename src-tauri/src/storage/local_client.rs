use async_trait::async_trait;
use serde_json::Value;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use tokio::fs;
use tokio::io::AsyncReadExt;

use super::traits::{StorageClient, StorageError, StorageRequest, StorageResponse, DirectoryResult, StorageFile, ListOptions, ConnectionConfig, StorageCapabilities};

/// 本机文件系统存储客户端
pub struct LocalFileSystemClient {
    root_path: Option<PathBuf>,
    connected: AtomicBool,
}

impl LocalFileSystemClient {
    pub fn new() -> Self {
        Self {
            root_path: None,
            connected: AtomicBool::new(false),
        }
    }

    /// 构建完整路径并进行安全检查
    /// 支持绝对路径和相对路径两种模式
    fn build_safe_path(&self, path: &str) -> Result<PathBuf, StorageError> {
        // 如果路径以 ~ 开头，直接展开
        if path.starts_with('~') {
            if let Some(home_dir) = dirs::home_dir() {
                let expanded_path = if path == "~" {
                    home_dir
                } else if let Some(stripped) = path.strip_prefix("~/") {
                    home_dir.join(stripped)
                } else {
                    PathBuf::from(path)
                };
                return Ok(expanded_path);
            } else {
                return Err(StorageError::ConnectionFailed(
                    "Cannot determine home directory".to_string()
                ));
            }
        }

        // 检查是否为绝对路径
        let path_buf = PathBuf::from(path);
        if path_buf.is_absolute() {
            return Ok(path_buf);
        }

        // 获取根路径
        let root = self.root_path
            .as_ref()
            .ok_or(StorageError::NotConnected)?;

        // 对于相对路径，与根目录拼接
        let clean_path = path.trim_start_matches('/');

        // 构建完整路径
        let full_path = if clean_path.is_empty() {
            root.clone()
        } else {
            root.join(clean_path)
        };

        Ok(full_path)
    }

    /// 获取文件的 MIME 类型
    fn get_mime_type(path: &Path) -> Option<String> {
        path.extension()
            .and_then(|ext| ext.to_str())
            .map(|ext| match ext.to_lowercase().as_str() {
                "txt" | "md" | "log" => "text/plain",
                "html" | "htm" => "text/html",
                "css" => "text/css",
                "js" => "application/javascript",
                "json" => "application/json",
                "xml" => "application/xml",
                "pdf" => "application/pdf",
                "jpg" | "jpeg" => "image/jpeg",
                "png" => "image/png",
                "gif" => "image/gif",
                "svg" => "image/svg+xml",
                "mp3" => "audio/mpeg",
                "mp4" => "video/mp4",
                "zip" => "application/zip",
                "tar" => "application/x-tar",
                "gz" => "application/gzip",
                _ => "application/octet-stream",
            })
            .map(|s| s.to_string())
    }

    /// 格式化文件修改时间
    fn format_modification_time(metadata: &std::fs::Metadata) -> String {
        metadata
            .modified()
            .ok()
            .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|duration| {
                let seconds = duration.as_secs();
                chrono::DateTime::from_timestamp(seconds as i64, 0)
                    .map(|dt| dt.to_rfc3339())
                    .unwrap_or_else(|| "1970-01-01T00:00:00Z".to_string())
            })
            .unwrap_or_else(|| "1970-01-01T00:00:00Z".to_string())
    }
}

#[async_trait]
impl StorageClient for LocalFileSystemClient {
    async fn connect(&mut self, config: &super::traits::ConnectionConfig) -> Result<(), StorageError> {
        // 检查是否是本机文件系统协议
        if config.protocol != "local" {
            return Err(StorageError::ProtocolNotSupported(config.protocol.clone()));
        }

        // 检查根路径是否提供
        let root_path = config.url
            .as_ref()
            .ok_or_else(|| {
                StorageError::InvalidConfig("Root path is required".to_string())
            })?;

        // 展开 ~ 为用户主目录
        let expanded_path = if root_path.starts_with('~') {
            if let Some(home_dir) = dirs::home_dir() {
                if root_path == "~" {
                    home_dir
                } else if let Some(stripped) = root_path.strip_prefix("~/") {
                    home_dir.join(stripped)
                } else {
                    PathBuf::from(root_path)
                }
            } else {
                return Err(StorageError::ConnectionFailed(
                    "Cannot determine home directory".to_string()
                ));
            }
        } else {
            PathBuf::from(root_path)
        };

        // 验证路径是否存在
        if !expanded_path.exists() {
            return Err(StorageError::ConnectionFailed(
                format!("Path does not exist: {}", expanded_path.display())
            ));
        }

        if !expanded_path.is_dir() {
            return Err(StorageError::ConnectionFailed(
                format!("Path is not a directory: {}", expanded_path.display())
            ));
        }

        self.root_path = Some(expanded_path);
        self.connected.store(true, Ordering::Relaxed);

        Ok(())
    }

    async fn disconnect(&self) {
        // 本地文件系统连接无需特殊清理，只需要更新连接状态
        self.connected.store(false, Ordering::Relaxed);
    }

    async fn is_connected(&self) -> bool {
        self.connected.load(Ordering::Relaxed)
    }

    async fn list_directory(&self, path: &str, _options: Option<&ListOptions>) -> Result<DirectoryResult, StorageError> {
        let dir_path = self.build_safe_path(path)?;

        if !dir_path.exists() {
            return Err(StorageError::RequestFailed("Directory not found".to_string()));
        }

        if !dir_path.is_dir() {
            return Err(StorageError::RequestFailed("Path is not a directory".to_string()));
        }

        let mut entries = fs::read_dir(&dir_path).await
            .map_err(|e| StorageError::IoError(format!("Failed to read directory: {}", e)))?;

        let mut files = Vec::new();

        while let Some(entry) = entries.next_entry().await
            .map_err(|e| StorageError::IoError(format!("Failed to read directory entry: {}", e)))? {

            let file_path = entry.path();
            let file_name = file_path
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("Unknown")
                .to_string();

            let metadata = entry.metadata().await
                .map_err(|e| StorageError::IoError(format!("Failed to get metadata: {}", e)))?;

            let is_directory = metadata.is_dir();
            let size = if is_directory { 0 } else { metadata.len() };
            let mime_type = if is_directory {
                None
            } else {
                Self::get_mime_type(&file_path)
            };

            let storage_file = StorageFile {
                filename: file_name.clone(),
                basename: file_name,
                lastmod: Self::format_modification_time(&metadata),
                size,
                file_type: if is_directory { "directory" } else { "file" }.to_string(),
                mime: mime_type,
                etag: None, // 本机文件系统不需要 ETag
            };

            files.push(storage_file);
        }

        // 按名称排序
        files.sort_by(|a, b| {
            // 目录优先，然后按名称排序
            match (a.file_type.as_str(), b.file_type.as_str()) {
                ("directory", "file") => std::cmp::Ordering::Less,
                ("file", "directory") => std::cmp::Ordering::Greater,
                _ => a.filename.cmp(&b.filename),
            }
        });

        Ok(DirectoryResult {
            files,
            has_more: false,
            next_marker: None,
            total_count: None,
            path: path.to_string(),
        })
    }

    async fn request(&self, request: &StorageRequest) -> Result<StorageResponse, StorageError> {
        if !self.connected.load(Ordering::Relaxed) {
            return Err(StorageError::NotConnected);
        }

        match request.method.as_str() {
            "CHECK_ACCESS" => {
                let path = self.build_safe_path("")?;
                if path.exists() && path.is_dir() {
                    Ok(StorageResponse {
                        status: 200,
                        headers: HashMap::new(),
                        body: "OK".to_string(),
                        metadata: None,
                    })
                } else {
                    Err(StorageError::RequestFailed("Path not accessible".to_string()))
                }
            }
            "LIST_DIRECTORY" => {
                self.list_directory_internal(&request.url, request.options.as_ref()).await
            }
            "READ_FILE" => {
                self.read_file(&request.url, request.options.as_ref()).await
            }
            "GET_FILE_SIZE" => {
                self.get_file_size(&request.url).await
            }
            _ => Err(StorageError::RequestFailed(
                format!("Unsupported method: {}", request.method)
            )),
        }
    }

    async fn request_binary(&self, request: &StorageRequest) -> Result<Vec<u8>, StorageError> {
        if !self.connected.load(Ordering::Relaxed) {
            return Err(StorageError::NotConnected);
        }

        match request.method.as_str() {
            "READ_FILE_BINARY" => {
                let path = self.build_safe_path(&request.url)?;

                if !path.exists() {
                    return Err(StorageError::RequestFailed("File not found".to_string()));
                }

                let mut file = fs::File::open(&path).await
                    .map_err(|e| StorageError::IoError(format!("Failed to open file: {}", e)))?;

                let mut buffer = Vec::new();
                file.read_to_end(&mut buffer).await
                    .map_err(|e| StorageError::IoError(format!("Failed to read file: {}", e)))?;

                Ok(buffer)
            }
            _ => Err(StorageError::RequestFailed(
                format!("Unsupported binary method: {}", request.method)
            )),
        }
    }

    /// 读取文件的指定范围
    async fn read_file_range(&self, path: &str, start: u64, length: u64) -> Result<Vec<u8>, StorageError> {
        if !self.connected.load(Ordering::Relaxed) {
            return Err(StorageError::NotConnected);
        }

        log::debug!("本地文件读取范围: path={}, start={}, length={}", path, start, length);

        let file_path = self.build_safe_path(path)?;

        if !file_path.exists() {
            return Err(StorageError::RequestFailed("File not found".to_string()));
        }

        let mut file = fs::File::open(&file_path).await
            .map_err(|e| StorageError::IoError(format!("Failed to open file: {}", e)))?;

        use tokio::io::AsyncSeekExt;

        // 定位到起始位置
        file.seek(std::io::SeekFrom::Start(start)).await
            .map_err(|e| StorageError::IoError(format!("Failed to seek in file: {}", e)))?;

        // 读取指定长度的数据
        let mut buffer = vec![0u8; length as usize];
        let bytes_read = file.read(&mut buffer).await
            .map_err(|e| StorageError::IoError(format!("Failed to read file: {}", e)))?;

        buffer.truncate(bytes_read);
        log::debug!("本地文件实际读取到 {} 字节", buffer.len());
        Ok(buffer)
    }

    /// 读取完整文件
    async fn read_full_file(&self, path: &str) -> Result<Vec<u8>, StorageError> {
        if !self.connected.load(Ordering::Relaxed) {
            return Err(StorageError::NotConnected);
        }

        let file_path = self.build_safe_path(path)?;

        if !file_path.exists() {
            return Err(StorageError::RequestFailed("File not found".to_string()));
        }

        fs::read(&file_path).await
            .map_err(|e| StorageError::IoError(format!("Failed to read file: {}", e)))
    }

    /// 获取文件大小
    async fn get_file_size(&self, path: &str) -> Result<u64, StorageError> {
        if !self.connected.load(Ordering::Relaxed) {
            return Err(StorageError::NotConnected);
        }

        let file_path = self.build_safe_path(path)?;

        if !file_path.exists() {
            return Err(StorageError::RequestFailed("File not found".to_string()));
        }

        let metadata = fs::metadata(&file_path).await
            .map_err(|e| StorageError::IoError(format!("Failed to get file metadata: {}", e)))?;

        if metadata.is_dir() {
            return Err(StorageError::RequestFailed("Path is a directory, not a file".to_string()));
        }

        Ok(metadata.len())
    }

    fn capabilities(&self) -> StorageCapabilities {
        StorageCapabilities {
            supports_directories: true,
            supports_metadata: true,
            supports_streaming: true,
            supports_range_requests: true,
            supports_multipart_upload: false,
            supports_encryption: false,
            max_file_size: None,
            supported_methods: vec![
                "READ_FILE".to_string(),
                "READ_FILE_BINARY".to_string(),
                "LIST_DIRECTORY".to_string(),
                "GET_FILE_SIZE".to_string(),
                "CHECK_ACCESS".to_string(),
            ],
        }
    }

    fn protocol(&self) -> &str {
        "local"
    }

    fn validate_config(&self, config: &ConnectionConfig) -> Result<(), StorageError> {
        if config.protocol != "local" {
            return Err(StorageError::InvalidConfig(
                format!("Expected protocol 'local', got '{}'", config.protocol)
            ));
        }

        if config.url.is_none() {
            return Err(StorageError::InvalidConfig("Root path is required for local file system".to_string()));
        }

        Ok(())
    }

    fn get_download_url(&self, path: &str) -> Result<String, StorageError> {
        // 如果传入的已经是 file:// URL，直接返回
        if path.starts_with("file://") {
            return Ok(path.to_string());
        }

        // 否则，构建完整路径并转换为 file:// URL
        let full_path = self.build_safe_path(path)?;

        // 将路径转换为 file:// URL
        let file_url = format!("file://{}", full_path.to_string_lossy());

        Ok(file_url)
    }
}

impl LocalFileSystemClient {
    async fn list_directory_internal(&self, path: &str, _options: Option<&Value>) -> Result<StorageResponse, StorageError> {
        let dir_path = self.build_safe_path(path)?;

        if !dir_path.exists() {
            return Err(StorageError::RequestFailed("Directory not found".to_string()));
        }

        if !dir_path.is_dir() {
            return Err(StorageError::RequestFailed("Path is not a directory".to_string()));
        }

        let mut entries = fs::read_dir(&dir_path).await
            .map_err(|e| StorageError::IoError(format!("Failed to read directory: {}", e)))?;

        let mut files = Vec::new();

        while let Some(entry) = entries.next_entry().await
            .map_err(|e| StorageError::IoError(format!("Failed to read directory entry: {}", e)))? {

            let file_path = entry.path();
            let file_name = file_path
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("Unknown")
                .to_string();

            let metadata = entry.metadata().await
                .map_err(|e| StorageError::IoError(format!("Failed to get metadata: {}", e)))?;

            let is_directory = metadata.is_dir();
            let size = if is_directory { 0 } else { metadata.len() };
            let mime_type = if is_directory {
                None
            } else {
                Self::get_mime_type(&file_path)
            };

            let storage_file = StorageFile {
                filename: file_name.clone(),
                basename: file_name,
                lastmod: Self::format_modification_time(&metadata),
                size,
                file_type: if is_directory { "directory" } else { "file" }.to_string(),
                mime: mime_type,
                etag: None, // 本机文件系统不需要 ETag
            };

            files.push(storage_file);
        }

        // 按名称排序
        files.sort_by(|a, b| {
            // 目录优先，然后按名称排序
            match (a.file_type.as_str(), b.file_type.as_str()) {
                ("directory", "file") => std::cmp::Ordering::Less,
                ("file", "directory") => std::cmp::Ordering::Greater,
                _ => a.filename.cmp(&b.filename),
            }
        });

        let result = DirectoryResult {
            files,
            has_more: false,
            next_marker: None,
            total_count: None,
            path: path.to_string(),
        };

        let response_body = serde_json::to_string(&result)
            .map_err(|e| StorageError::RequestFailed(format!("Failed to serialize response: {}", e)))?;

        Ok(StorageResponse {
            status: 200,
            headers: HashMap::new(),
            body: response_body,
            metadata: None,
        })
    }

    async fn read_file(&self, path: &str, options: Option<&Value>) -> Result<StorageResponse, StorageError> {
        let file_path = self.build_safe_path(path)?;

        if !file_path.exists() {
            return Err(StorageError::RequestFailed("File not found".to_string()));
        }

        if file_path.is_dir() {
            return Err(StorageError::RequestFailed("Path is a directory, not a file".to_string()));
        }

        let mut file = fs::File::open(&file_path).await
            .map_err(|e| StorageError::IoError(format!("Failed to open file: {}", e)))?;

        let file_size = file.metadata().await
            .map_err(|e| StorageError::IoError(format!("Failed to get file metadata: {}", e)))?
            .len();

        // 检查是否需要部分读取
        let (start, length) = if let Some(opts) = options {
            let start = opts.get("start").and_then(|v| v.as_u64()).unwrap_or(0);
            let length = opts.get("length").and_then(|v| v.as_u64());
            (start, length)
        } else {
            (0, None)
        };

        // 读取文件内容
        let content = if start > 0 || length.is_some() {
            // 部分读取
            use tokio::io::AsyncSeekExt;
            file.seek(std::io::SeekFrom::Start(start)).await
                .map_err(|e| StorageError::IoError(format!("Failed to seek file: {}", e)))?;

            let read_length = length.unwrap_or(file_size - start).min(file_size - start);
            let mut buffer = vec![0u8; read_length as usize];
            file.read_exact(&mut buffer).await
                .map_err(|e| StorageError::IoError(format!("Failed to read file: {}", e)))?;

            String::from_utf8_lossy(&buffer).to_string()
        } else {
            // 完整读取
            let mut buffer = Vec::new();
            file.read_to_end(&mut buffer).await
                .map_err(|e| StorageError::IoError(format!("Failed to read file: {}", e)))?;

            String::from_utf8_lossy(&buffer).to_string()
        };

        let response_data = serde_json::json!({
            "content": content,
            "size": file_size,
            "encoding": "utf-8"
        });

        let response_body = serde_json::to_string(&response_data)
            .map_err(|e| StorageError::RequestFailed(format!("Failed to serialize response: {}", e)))?;

        Ok(StorageResponse {
            status: 200,
            headers: HashMap::new(),
            body: response_body,
            metadata: None,
        })
    }

    async fn get_file_size(&self, path: &str) -> Result<StorageResponse, StorageError> {
        let file_path = self.build_safe_path(path)?;

        if !file_path.exists() {
            return Err(StorageError::RequestFailed("File not found".to_string()));
        }

        let metadata = fs::metadata(&file_path).await
            .map_err(|e| StorageError::IoError(format!("Failed to get file metadata: {}", e)))?;

        if metadata.is_dir() {
            return Err(StorageError::RequestFailed("Path is a directory, not a file".to_string()));
        }

        let response_data = serde_json::json!({
            "size": metadata.len()
        });

        let response_body = serde_json::to_string(&response_data)
            .map_err(|e| StorageError::RequestFailed(format!("Failed to serialize response: {}", e)))?;

        Ok(StorageResponse {
            status: 200,
            headers: HashMap::new(),
            body: response_body,
            metadata: None,
        })
    }
}
