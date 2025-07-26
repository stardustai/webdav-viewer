use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// 统一的文件信息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StorageFile {
    pub filename: String,
    pub basename: String,
    pub lastmod: String,
    pub size: u64,
    #[serde(rename = "type")]
    pub file_type: String, // "file" or "directory"
    pub mime: Option<String>,
    pub etag: Option<String>,
}

/// 统一的目录列表结果
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DirectoryResult {
    pub files: Vec<StorageFile>,
    pub has_more: bool,
    pub next_marker: Option<String>,
    pub total_count: Option<u64>,
    pub path: String,
}

/// 统一的列表选项
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ListOptions {
    pub page_size: Option<u32>,
    pub marker: Option<String>,
    pub prefix: Option<String>,
    pub recursive: Option<bool>,
    pub sort_by: Option<String>, // "name", "size", "modified"
    pub sort_order: Option<String>, // "asc", "desc"
}

/// 统一的存储响应结构
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StorageResponse {
    pub status: u16,
    pub headers: HashMap<String, String>,
    pub body: String,
    pub metadata: Option<serde_json::Value>,
}

/// 统一的存储请求结构
#[derive(Debug, Clone)]
pub struct StorageRequest {
    pub method: String,
    pub url: String,
    pub headers: HashMap<String, String>,
    pub body: Option<String>,
    pub options: Option<serde_json::Value>,
}

/// 连接配置
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConnectionConfig {
    pub protocol: String,
    pub url: Option<String>,
    pub access_key: Option<String>,
    pub secret_key: Option<String>,
    pub region: Option<String>,
    pub bucket: Option<String>,
    pub endpoint: Option<String>,
    pub username: Option<String>,
    pub password: Option<String>,
    pub extra_options: Option<HashMap<String, String>>,
}

/// 存储客户端错误类型
#[derive(Debug, thiserror::Error)]
pub enum StorageError {
    #[error("Connection failed: {0}")]
    ConnectionFailed(String),

    #[error("Request failed: {0}")]
    RequestFailed(String),

    #[error("Invalid configuration: {0}")]
    InvalidConfig(String),

    #[error("Protocol not supported: {0}")]
    ProtocolNotSupported(String),

    #[error("Unsupported protocol: {0}")]
    UnsupportedProtocol(String),

    #[error("Not connected")]
    NotConnected,

    #[error("IO error: {0}")]
    IoError(String),

    #[error("Network error: {0}")]
    NetworkError(String),
}

/// 统一存储客户端接口
#[async_trait]
pub trait StorageClient: Send + Sync {
    /// 连接到存储服务
    async fn connect(&mut self, config: &ConnectionConfig) -> Result<(), StorageError>;

    /// 断开连接
    async fn disconnect(&self);

    /// 检查是否已连接
    async fn is_connected(&self) -> bool;

    /// 列出目录内容
    async fn list_directory(&self, path: &str, options: Option<&ListOptions>) -> Result<DirectoryResult, StorageError>;

    /// 发起请求
    async fn request(&self, request: &StorageRequest) -> Result<StorageResponse, StorageError>;

    /// 发起二进制请求
    async fn request_binary(&self, request: &StorageRequest) -> Result<Vec<u8>, StorageError>;

    /// 读取文件的指定范围（用于压缩包等需要随机访问的场景）
    async fn read_file_range(&self, path: &str, start: u64, length: u64) -> Result<Vec<u8>, StorageError>;

    /// 读取完整文件（用于小文件或完整下载）
    async fn read_full_file(&self, path: &str) -> Result<Vec<u8>, StorageError>;

    /// 获取文件大小
    async fn get_file_size(&self, path: &str) -> Result<u64, StorageError>;

    /// 获取下载 URL（对于需要签名的存储如 OSS）
    fn get_download_url(&self, path: &str) -> Result<String, StorageError> {
        // 默认实现：直接返回路径，适用于不需要签名的存储
        Ok(path.to_string())
    }

    /// 获取客户端能力
    fn capabilities(&self) -> StorageCapabilities;

    /// 获取协议名称
    fn protocol(&self) -> &str;

    /// 验证配置
    #[allow(dead_code)] // API 保留方法
    fn validate_config(&self, config: &ConnectionConfig) -> Result<(), StorageError>;
}

/// 存储能力描述
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StorageCapabilities {
    pub supports_streaming: bool,
    pub supports_range_requests: bool,
    pub supports_multipart_upload: bool,
    pub supports_metadata: bool,
    pub supports_encryption: bool,
    pub supports_directories: bool,
    pub max_file_size: Option<u64>,
    pub supported_methods: Vec<String>,
}

impl Default for StorageCapabilities {
    fn default() -> Self {
        Self {
            supports_streaming: false,
            supports_range_requests: false,
            supports_multipart_upload: false,
            supports_metadata: false,
            supports_encryption: false,
            supports_directories: false,
            max_file_size: None,
            supported_methods: vec!["GET".to_string(), "HEAD".to_string()],
        }
    }
}
