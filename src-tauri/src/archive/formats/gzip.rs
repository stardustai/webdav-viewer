/// GZIP 格式处理器
use crate::archive::types::*;
use crate::archive::formats::{CompressionHandlerDispatcher, common::*};
use crate::storage::traits::StorageClient;
use std::collections::HashMap;
use std::sync::Arc;
use std::io::{Cursor, Read};
use flate2::read::GzDecoder;
use base64::{Engine as _, engine::general_purpose};

pub struct GzipHandler;

#[async_trait::async_trait]
impl CompressionHandlerDispatcher for GzipHandler {
    async fn analyze_with_client(
        &self,
        client: Arc<dyn StorageClient>,
        file_path: &str,
        _filename: &str,
        max_size: Option<usize>,
    ) -> Result<ArchiveInfo, String> {
        Self::analyze_with_storage_client(client, file_path, max_size).await
    }

    async fn extract_preview_with_client(
        &self,
        client: Arc<dyn StorageClient>,
        file_path: &str,
        _entry_path: &str,
        max_size: usize,
    ) -> Result<FilePreview, String> {
        Self::extract_preview_with_storage_client(client, file_path, max_size).await
    }

    fn compression_type(&self) -> CompressionType {
        CompressionType::Gzip
    }

    fn validate_format(&self, data: &[u8]) -> bool {
        data.len() >= 2 && data[0] == 0x1f && data[1] == 0x8b
    }
}

impl GzipHandler {
    /// 使用存储客户端分析GZIP文件
    async fn analyze_with_storage_client(
        client: Arc<dyn StorageClient>,
        file_path: &str,
        max_size: Option<usize>,
    ) -> Result<ArchiveInfo, String> {
        log::debug!("使用storage client分析GZIP文件: {}", file_path);

        // 获取文件大小
        let file_size = client.get_file_size(file_path).await
            .map_err(|e| format!("Failed to get file size: {}", e))?;

        log::debug!("GZIP文件大小: {} 字节", file_size);

        // 使用流式分析，只读取必要的部分
        Self::analyze_gzip_streaming(client, file_path, file_size, max_size).await
    }

    /// 使用存储客户端提取GZIP文件预览
    async fn extract_preview_with_storage_client(
        client: Arc<dyn StorageClient>,
        file_path: &str,
        max_size: usize,
    ) -> Result<FilePreview, String> {
        log::debug!("使用storage client从GZIP文件提取预览: {}", file_path);

        // 使用流式方法提取预览，无需完整加载文件
        Self::extract_gzip_preview_streaming(client, file_path, max_size).await
    }

    /// 流式分析GZIP文件，只读取必要的头部和少量内容
    async fn analyze_gzip_streaming(
        client: Arc<dyn StorageClient>,
        file_path: &str,
        file_size: u64,
        max_sample_size: Option<usize>,
    ) -> Result<ArchiveInfo, String> {
        log::debug!("开始流式分析GZIP文件: {} ({} 字节)", file_path, file_size);

        // 读取GZIP头部用于验证和提取元数据
        const HEADER_SIZE: u64 = 1024; // 读取前1KB用于头部分析
        let header_size = HEADER_SIZE.min(file_size);

        let header_data = client.read_file_range(file_path, 0, header_size).await
            .map_err(|e| format!("Failed to read GZIP header: {}", e))?;

        if !Self::validate_gzip_header(&header_data) {
            return Err("Invalid GZIP header".to_string());
        }

        // 提取原始文件名
        let original_filename = Self::extract_original_filename(&header_data)
            .unwrap_or_else(|| "compressed_content".to_string());

        // 确定要读取的样本大小用于内容分析
        let sample_size = max_sample_size.unwrap_or(64 * 1024); // 默认64KB
        let read_size = (sample_size * 2).min(file_size as usize); // 考虑压缩比，读取2倍大小

        let compressed_data = client.read_file_range(file_path, 0, read_size as u64).await
            .map_err(|e| format!("Failed to read GZIP data for analysis: {}", e))?;

        // 流式解压缩样本数据来估算大小
        let uncompressed_sample = Self::decompress_sample(&compressed_data, sample_size)?;

        // 估算解压后的总大小（基于样本压缩比）
        let compression_ratio = compressed_data.len() as f64 / uncompressed_sample.len() as f64;
        let estimated_uncompressed_size = (file_size as f64 / compression_ratio) as u64;

        let entry = ArchiveEntry {
            path: original_filename.clone(),
            size: estimated_uncompressed_size,
            compressed_size: Some(file_size),
            is_dir: false,
            modified_time: None,
            crc32: None,
            index: 0,
            metadata: HashMap::new(),
        };

        Ok(ArchiveInfoBuilder::new(CompressionType::Gzip)
            .entries(vec![entry])
            .total_entries(1)
            .total_uncompressed_size(estimated_uncompressed_size)
            .total_compressed_size(file_size)
            .supports_streaming(true)
            .supports_random_access(false)
            .analysis_status(AnalysisStatus::Complete)
            .build())
    }

    /// 流式提取GZIP预览，只读取和解压必要的部分
    async fn extract_gzip_preview_streaming(
        client: Arc<dyn StorageClient>,
        file_path: &str,
        max_size: usize,
    ) -> Result<FilePreview, String> {
        log::debug!("开始流式提取GZIP预览: {}", file_path);

        // 估算需要读取的压缩数据大小（考虑压缩比）
        // 通常文本压缩比在3-5倍，二进制文件1.5-2倍
        let estimated_compressed_size = (max_size * 3).max(4096); // 至少读取4KB

        let compressed_data = client.read_file_range(file_path, 0, estimated_compressed_size as u64).await
            .map_err(|e| format!("Failed to read GZIP data: {}", e))?;

        if !Self::validate_gzip_header(&compressed_data) {
            return Err("Invalid GZIP header".to_string());
        }

        // 流式解压缩预览数据
        let preview_data = Self::decompress_sample(&compressed_data, max_size)?;

        // 检测内容类型
        let _mime_type = detect_mime_type(&preview_data);
        let is_text = is_text_content(&preview_data);

        let content = if is_text {
            String::from_utf8_lossy(&preview_data).into_owned()
        } else {
            general_purpose::STANDARD.encode(&preview_data)
        };

        // 判断是否被截断（如果解压数据达到了最大size，可能还有更多内容）
        let is_truncated = preview_data.len() >= max_size;

        Ok(PreviewBuilder::new()
            .content(content)
            .total_size(preview_data.len() as u64) // 这里只能给出已解压的大小
            .file_type(if is_text { FileType::Text } else { FileType::Binary })
            .encoding(if is_text { "utf-8".to_string() } else { "base64".to_string() })
            .with_truncated(is_truncated)
            .build())
    }

    /// 解压缩样本数据
    fn decompress_sample(compressed_data: &[u8], max_output_size: usize) -> Result<Vec<u8>, String> {
        let mut decoder = GzDecoder::new(Cursor::new(compressed_data));
        let mut buffer = vec![0u8; max_output_size];

        let bytes_read = decoder.read(&mut buffer)
            .map_err(|e| format!("Failed to decompress data: {}", e))?;

        buffer.truncate(bytes_read);
        Ok(buffer)
    }

    // 辅助方法
    fn validate_gzip_header(data: &[u8]) -> bool {
        data.len() >= 3 && data[0] == 0x1f && data[1] == 0x8b && data[2] == 0x08
    }

    fn extract_original_filename(data: &[u8]) -> Option<String> {
        if data.len() < 10 {
            return None;
        }

        // 检查FLG字段中的FNAME位
        let flg = data[3];
        if (flg & 0x08) == 0 {
            return None; // 没有文件名
        }

        // 跳过固定头部 (10 bytes)
        let mut offset = 10;

        // 如果有FEXTRA标志，跳过额外字段
        if (flg & 0x04) != 0 {
            if offset + 2 > data.len() {
                return None;
            }
            let xlen = u16::from_le_bytes([data[offset], data[offset + 1]]);
            offset += 2 + xlen as usize;
        }

        // 读取文件名（以null结尾）
        if offset >= data.len() {
            return None;
        }

        let mut filename_bytes = Vec::new();
        for &byte in &data[offset..] {
            if byte == 0 {
                break;
            }
            filename_bytes.push(byte);
        }

        String::from_utf8(filename_bytes).ok()
    }
}
