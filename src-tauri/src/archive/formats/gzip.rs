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
    async fn analyze_complete(&self, data: &[u8]) -> Result<ArchiveInfo, String> {
        Self::analyze_gzip_complete(data).await
    }

    async fn analyze_streaming(
        &self,
        url: &str,
        headers: &HashMap<String, String>,
        filename: &str,
        file_size: u64,
    ) -> Result<ArchiveInfo, String> {
        Self::analyze_gzip_streaming(url, headers, filename, file_size).await
    }

    async fn analyze_streaming_without_size(
        &self,
        url: &str,
        headers: &HashMap<String, String>,
        filename: &str,
    ) -> Result<ArchiveInfo, String> {
        Self::analyze_gzip_streaming_without_size(url, headers, filename).await
    }

    async fn extract_preview(
        &self,
        url: &str,
        headers: &HashMap<String, String>,
        _entry_path: &str,
        max_size: usize,
    ) -> Result<FilePreview, String> {
        Self::extract_gzip_preview(url, headers, max_size).await
    }

    async fn analyze_with_client(
        &self,
        client: Arc<dyn StorageClient>,
        file_path: &str,
        _filename: &str,
        max_size: Option<usize>,
    ) -> Result<ArchiveInfo, String> {
        // 对于GZIP文件，读取完整内容进行分析
        let data = if let Some(limit) = max_size {
            // 如果有大小限制，只读取指定大小
            client.read_file_range(file_path, 0, limit as u64).await
                .map_err(|e| format!("Failed to read file: {}", e))?
        } else {
            // 读取完整文件
            client.read_full_file(file_path).await
                .map_err(|e| format!("Failed to read file: {}", e))?
        };

        Self::analyze_gzip_complete(&data).await
    }

    async fn extract_preview_with_client(
        &self,
        client: Arc<dyn StorageClient>,
        file_path: &str,
        _entry_path: &str,
        max_size: usize,
    ) -> Result<FilePreview, String> {
        // 读取文件并解压缩
        let data = client.read_full_file(file_path).await
            .map_err(|e| format!("Failed to read file: {}", e))?;

        Self::extract_gzip_preview_from_data(&data, max_size)
    }

    fn compression_type(&self) -> CompressionType {
        CompressionType::Gzip
    }

    fn validate_format(&self, data: &[u8]) -> bool {
        data.len() >= 2 && data[0] == 0x1f && data[1] == 0x8b
    }
}

impl GzipHandler {
    /// 完整GZIP文件分析
    async fn analyze_gzip_complete(data: &[u8]) -> Result<ArchiveInfo, String> {
        println!("开始分析GZIP文件，数据长度: {} 字节", data.len());

        // 验证GZIP头部
        if !Self::validate_gzip_header(data) {
            return Err("Invalid GZIP header".to_string());
        }

        // 尝试解压缩获取真实内容大小
        let mut decoder = GzDecoder::new(Cursor::new(data));
        let mut uncompressed_data = Vec::new();

        // 读取前64KB来确定内容类型
        let mut buffer = vec![0u8; 64 * 1024];
        let bytes_read = decoder.read(&mut buffer).unwrap_or(0);
        buffer.truncate(bytes_read);
        uncompressed_data.extend_from_slice(&buffer);

        // 确定原始文件名
        let original_filename = Self::extract_original_filename(data)
            .unwrap_or_else(|| "compressed_content".to_string());

        // 创建单个条目
        let entry = ArchiveEntry {
            path: original_filename.clone(),
            size: uncompressed_data.len() as u64,
            compressed_size: Some(data.len() as u64),
            is_dir: false,
            modified_time: None,
            crc32: None,
            index: 0,
            metadata: HashMap::new(),
        };

        Ok(ArchiveInfoBuilder::new(CompressionType::Gzip)
            .entries(vec![entry])
            .total_entries(1)
            .total_uncompressed_size(uncompressed_data.len() as u64)
            .total_compressed_size(data.len() as u64)
            .supports_streaming(true)
            .supports_random_access(false)
            .analysis_status(AnalysisStatus::Complete)
            .build())
    }

    /// 流式分析GZIP文件
    async fn analyze_gzip_streaming(
        url: &str,
        headers: &HashMap<String, String>,
        filename: &str,
        file_size: u64,
    ) -> Result<ArchiveInfo, String> {
        println!("开始流式分析GZIP文件: {} (大小: {} 字节)", filename, file_size);

        // 读取头部检查格式
        let header_size = 1024.min(file_size);
        let header_data = HttpClient::download_range(url, headers, 0, header_size).await?;

        if !Self::validate_gzip_header(&header_data) {
            return Err("Invalid GZIP header".to_string());
        }

        // 从GZIP头部提取原始文件名
        let original_filename = Self::extract_original_filename(&header_data)
            .unwrap_or_else(|| {
                filename.strip_suffix(".gz")
                    .unwrap_or(filename)
                    .to_string()
            });

        // 尝试流式解压缩前64KB以获取内容类型信息
        let sample_size = (64 * 1024).min(file_size);
        let sample_data = HttpClient::download_range(url, headers, 0, sample_size).await?;

        let estimated_uncompressed_size = Self::estimate_uncompressed_size(
            file_size, &sample_data
        );

        // 创建单个条目
        let entry = ArchiveEntry {
            path: original_filename,
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
            .analysis_status(AnalysisStatus::Streaming { estimated_entries: Some(1) })
            .build())
    }

    /// 流式分析GZIP文件（无文件大小）
    async fn analyze_gzip_streaming_without_size(
        url: &str,
        headers: &HashMap<String, String>,
        filename: &str,
    ) -> Result<ArchiveInfo, String> {
        println!("开始流式分析GZIP文件（无文件大小信息）: {}", filename);

        // 读取头部验证格式
        let header_data = HttpClient::download_range(url, headers, 0, 1024).await?;

        if !Self::validate_gzip_header(&header_data) {
            return Err("Invalid GZIP header".to_string());
        }

        // 从GZIP头部提取原始文件名
        let original_filename = Self::extract_original_filename(&header_data)
            .unwrap_or_else(|| {
                filename.strip_suffix(".gz")
                    .unwrap_or(filename)
                    .to_string()
            });

        // 创建占位符条目
        let entry = ArchiveEntry {
            path: original_filename,
            size: 0,
            compressed_size: None,
            is_dir: false,
            modified_time: None,
            crc32: None,
            index: 0,
            metadata: HashMap::new(),
        };

        Ok(ArchiveInfoBuilder::new(CompressionType::Gzip)
            .entries(vec![entry])
            .total_entries(1)
            .supports_streaming(true)
            .supports_random_access(false)
            .analysis_status(AnalysisStatus::Streaming { estimated_entries: Some(1) })
            .build())
    }

    /// 从GZIP文件提取预览
    async fn extract_gzip_preview(
        url: &str,
        headers: &HashMap<String, String>,
        max_size: usize,
    ) -> Result<FilePreview, String> {
        println!("开始提取GZIP文件预览，最大大小: {} 字节", max_size);

        // 下载足够的数据进行解压缩预览
        let download_size = (max_size * 2).max(64 * 1024);
        let compressed_data = match HttpClient::download_range(url, headers, 0, download_size as u64).await {
            Ok(data) => data,
            Err(_) => {
                // 如果范围请求失败，尝试下载整个文件
                println!("范围请求失败，尝试下载整个文件");
                HttpClient::download_file(url, headers).await?
            }
        };

        if !Self::validate_gzip_header(&compressed_data) {
            return Err("Invalid GZIP header".to_string());
        }

        // 解压缩数据
        let mut decoder = GzDecoder::new(Cursor::new(&compressed_data));
        let mut preview_buffer = vec![0u8; max_size];
        let bytes_read = decoder.read(&mut preview_buffer).map_err(|e| e.to_string())?;
        preview_buffer.truncate(bytes_read);

        // 确定文件类型
        let original_filename = Self::extract_original_filename(&compressed_data)
            .unwrap_or_else(|| "compressed_content".to_string());
        let file_type = FileType::from_path(&original_filename);

        // 处理文本内容
        let content = if file_type.is_text() {
            match String::from_utf8(preview_buffer.clone()) {
                Ok(text) => text,
                Err(_) => TextDecoder::try_decode_text(preview_buffer)?,
            }
        } else {
            TextDecoder::format_binary_preview(preview_buffer)
        };

        // 估算总大小
        let estimated_total_size = Self::estimate_uncompressed_size(
            compressed_data.len() as u64, &compressed_data
        );

        Ok(PreviewBuilder::new()
            .content(content)
            .with_truncated(bytes_read < estimated_total_size as usize)
            .total_size(estimated_total_size)
            .file_type(file_type)
            .build())
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

    fn estimate_uncompressed_size(compressed_size: u64, sample_data: &[u8]) -> u64 {
        // 简单的压缩比估算
        if sample_data.len() < 1024 {
            return compressed_size * 3; // 保守估计
        }

        // 尝试解压缩样本数据来估算压缩比
        let mut decoder = GzDecoder::new(Cursor::new(sample_data));
        let mut buffer = vec![0u8; 64 * 1024];

        match decoder.read(&mut buffer) {
            Ok(bytes_read) if bytes_read > 0 => {
                let sample_ratio = bytes_read as f64 / sample_data.len() as f64;
                let estimated = (compressed_size as f64 * sample_ratio) as u64;
                estimated.max(compressed_size) // 确保不小于压缩大小
            }
            _ => compressed_size * 3, // 默认压缩比
        }
    }

    /// 从数据中提取GZIP预览
    fn extract_gzip_preview_from_data(data: &[u8], max_size: usize) -> Result<FilePreview, String> {
        let mut decoder = GzDecoder::new(Cursor::new(data));
        let mut preview_data = vec![0u8; max_size];

        let bytes_read = decoder.read(&mut preview_data)
            .map_err(|e| format!("Failed to decompress data: {}", e))?;

        preview_data.truncate(bytes_read);

        // 检测内容类型
        let _mime_type = detect_mime_type(&preview_data);
        let is_text = is_text_content(&preview_data);

        let content = if is_text {
            String::from_utf8_lossy(&preview_data).into_owned()
        } else {
            general_purpose::STANDARD.encode(&preview_data)
        };

        Ok(PreviewBuilder::new()
            .content(content)
            .file_type(if is_text { FileType::Text } else { FileType::Binary })
            .encoding(if is_text { "utf-8".to_string() } else { "base64".to_string() })
            .with_truncated(bytes_read >= max_size)
            .build())
    }
}
