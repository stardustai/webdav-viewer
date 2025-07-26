use crate::archive::{types::*, formats};
use crate::storage::traits::StorageClient;
use std::sync::Arc;

/// 压缩包处理器的统一入口
pub struct ArchiveHandler;

impl ArchiveHandler {
    pub fn new() -> Self {
        Self
    }

    /// 分析压缩包结构（统一StorageClient接口）
    pub async fn analyze_archive_with_client(
        &self,
        client: Arc<dyn StorageClient>,
        file_path: String,
        filename: String,
        max_size: Option<usize>,
    ) -> Result<ArchiveInfo, String> {
        let compression_type = CompressionType::from_filename(&filename);

        // 检查是否支持该格式
        match compression_type {
            CompressionType::SevenZip => {
                return Err("archive.format.7z.not.supported".to_string());
            }
            CompressionType::Rar => {
                return Err("archive.format.rar.not.supported".to_string());
            }
            CompressionType::Brotli => {
                return Err("archive.format.brotli.not.supported".to_string());
            }
            CompressionType::Lz4 => {
                return Err("archive.format.lz4.not.supported".to_string());
            }
            CompressionType::Zstd => {
                return Err("archive.format.zstd.not.supported".to_string());
            }
            _ => {}
        }

        let handler = if matches!(compression_type, CompressionType::Unknown) {
            // 通过 StorageClient 读取文件头部来检测格式
            let header_data = client.read_file_range(&file_path, 0, 512).await
                .map_err(|e| format!("Failed to read file header: {}", e))?;
            formats::detect_format_and_get_handler(&header_data)
                .ok_or_else(|| "Unsupported archive format".to_string())?
        } else {
            formats::get_handler(&compression_type)
                .ok_or_else(|| "Unsupported archive format".to_string())?
        };

        // 通过 StorageClient 进行流式分析
        println!("开始流式分析压缩文件: {} ({})", file_path, compression_type.to_string());
        handler.analyze_with_client(client, &file_path, &filename, max_size).await
    }

    /// 获取文件预览（统一StorageClient接口）
    pub async fn get_file_preview_with_client(
        &self,
        client: Arc<dyn StorageClient>,
        file_path: String,
        filename: String,
        entry_path: String,
        max_preview_size: Option<usize>,
    ) -> Result<FilePreview, String> {
        let compression_type = CompressionType::from_filename(&filename);

        // 检查是否支持该格式
        match compression_type {
            CompressionType::SevenZip => {
                return Err("archive.format.7z.not.supported".to_string());
            }
            CompressionType::Rar => {
                return Err("archive.format.rar.not.supported".to_string());
            }
            CompressionType::Brotli => {
                return Err("archive.format.brotli.not.supported".to_string());
            }
            CompressionType::Lz4 => {
                return Err("archive.format.lz4.not.supported".to_string());
            }
            CompressionType::Zstd => {
                return Err("archive.format.zstd.not.supported".to_string());
            }
            _ => {}
        }

        let handler = if matches!(compression_type, CompressionType::Unknown) {
            let header_data = client.read_file_range(&file_path, 0, 512).await
                .map_err(|e| format!("Failed to read file header: {}", e))?;
            formats::detect_format_and_get_handler(&header_data)
                .ok_or_else(|| "Unsupported archive format".to_string())?
        } else {
            formats::get_handler(&compression_type)
                .ok_or_else(|| "Unsupported archive format".to_string())?
        };

        let max_size = max_preview_size.unwrap_or(64 * 1024); // 默认64KB
        println!("开始流式预览压缩文件: {} -> {} ({})", file_path, entry_path, compression_type.to_string());
        handler.extract_preview_with_client(client, &file_path, &entry_path, max_size).await
    }
    /// 检查文件是否支持压缩包操作
    pub fn is_supported_archive(&self, filename: &str) -> bool {
        let compression_type = CompressionType::from_filename(filename);
        !matches!(compression_type, CompressionType::Unknown)
    }

    /// 检查文件是否支持流式读取
    pub fn supports_streaming(&self, filename: &str) -> bool {
        let compression_type = CompressionType::from_filename(filename);
        compression_type.supports_streaming()
    }

    /// 获取压缩格式信息
    pub fn get_compression_info(&self, filename: &str) -> CompressionType {
        CompressionType::from_filename(filename)
    }

    // 辅助方法



    /// 获取支持的压缩格式列表
    pub fn get_supported_formats(&self) -> Vec<&'static str> {
        vec!["zip", "tar", "tar.gz", "tgz", "gz", "gzip"]
    }

    /// 格式化文件大小
    pub fn format_file_size(&self, bytes: u64) -> String {
        if bytes == 0 {
            return "0 B".to_string();
        }

        let units = ["B", "KB", "MB", "GB", "TB"];
        let mut size = bytes as f64;
        let mut unit_index = 0;

        while size >= 1024.0 && unit_index < units.len() - 1 {
            size /= 1024.0;
            unit_index += 1;
        }

        if unit_index == 0 {
            format!("{} {}", bytes, units[unit_index])
        } else {
            format!("{:.2} {}", size, units[unit_index])
        }
    }

    /// 获取压缩率
    pub fn get_compression_ratio(&self, uncompressed: u64, compressed: u64) -> String {
        if compressed == 0 {
            return "0%".to_string();
        }
        let ratio = ((uncompressed.saturating_sub(compressed)) as f64 / uncompressed as f64) * 100.0;
        format!("{:.1}%", ratio)
    }

    /// 获取推荐的分块大小
    pub fn get_recommended_chunk_size(&self, filename: &str, file_size: u64) -> usize {
        let compression_type = CompressionType::from_filename(filename);
        let base_size = match compression_type {
            CompressionType::Zip => 8192,    // 8KB for ZIP (random access)
            CompressionType::TarGz => 32768, // 32KB for TAR.GZ (sequential)
            CompressionType::Tar => 16384,   // 16KB for TAR
            CompressionType::Gzip => 16384,  // 16KB for GZIP
            _ => 8192,
        };

        // 根据文件大小调整
        if file_size > 100 * 1024 * 1024 { // >100MB
            base_size * 4
        } else if file_size > 10 * 1024 * 1024 { // >10MB
            base_size * 2
        } else {
            base_size
        }
    }
}
