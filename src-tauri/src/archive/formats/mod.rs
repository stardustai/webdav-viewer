/// 压缩格式处理模块
///
/// 此模块将不同压缩格式的处理逻辑分离到独立的子模块中，
/// 提供统一的接口和共享的工具函数。
pub mod zip;
pub mod gzip;
pub mod tar;
pub mod tar_gz;
pub mod common;

use crate::archive::types::*;
use crate::storage::traits::StorageClient;
use std::sync::Arc;

/// 处理器分发接口（统一的流式压缩文件处理）
#[async_trait::async_trait]
pub trait CompressionHandlerDispatcher: Send + Sync {
    /// 通过存储客户端分析压缩文件（统一接口，支持流式分析）
    async fn analyze_with_client(
        &self,
        client: Arc<dyn StorageClient>,
        file_path: &str,
        filename: &str,
        max_size: Option<usize>,
    ) -> Result<ArchiveInfo, String>;

    /// 通过存储客户端提取文件预览（统一接口，支持流式提取）
    async fn extract_preview_with_client(
        &self,
        client: Arc<dyn StorageClient>,
        file_path: &str,
        entry_path: &str,
        max_size: usize,
    ) -> Result<FilePreview, String>;

    /// 获取压缩类型
    #[allow(dead_code)] // API 保留方法，保持接口完整性
    fn compression_type(&self) -> CompressionType;

    /// 验证文件格式
    fn validate_format(&self, data: &[u8]) -> bool;
}

/// 获取压缩格式处理器
pub fn get_handler(compression_type: &CompressionType) -> Option<Box<dyn CompressionHandlerDispatcher>> {
    match compression_type {
        CompressionType::Zip => Some(Box::new(zip::ZipHandler)),
        CompressionType::Gzip => Some(Box::new(gzip::GzipHandler)),
        CompressionType::Tar => Some(Box::new(tar::TarHandler)),
        CompressionType::TarGz => Some(Box::new(tar_gz::TarGzHandler)),
        CompressionType::SevenZip => None, // 7Z 格式不支持流式处理
        CompressionType::Rar => None, // RAR 格式不支持流式处理
        CompressionType::Brotli => None, // Brotli 格式暂不支持
        CompressionType::Lz4 => None, // LZ4 格式暂不支持
        CompressionType::Zstd => None, // Zstd 格式暂不支持
        CompressionType::Unknown => None,
    }
}

/// 根据文件头部数据自动检测格式并获取处理器
pub fn detect_format_and_get_handler(data: &[u8]) -> Option<Box<dyn CompressionHandlerDispatcher>> {
    let handlers: Vec<Box<dyn CompressionHandlerDispatcher>> = vec![
        Box::new(zip::ZipHandler),
        Box::new(gzip::GzipHandler),
        Box::new(tar_gz::TarGzHandler), // TAR.GZ 需要在 TAR 之前检查
        Box::new(tar::TarHandler),
    ];

    handlers.into_iter().find(|handler| handler.validate_format(data))
}
