/// TAR 格式处理器
use crate::archive::types::*;
use crate::archive::formats::{CompressionHandlerDispatcher, common::*};
use crate::storage::traits::StorageClient;
use std::collections::HashMap;
use std::sync::Arc;
use base64::{Engine as _, engine::general_purpose};

pub struct TarHandler;

#[async_trait::async_trait]
impl CompressionHandlerDispatcher for TarHandler {
    async fn analyze_with_client(
        &self,
        client: Arc<dyn StorageClient>,
        file_path: &str,
        _filename: &str,
        _max_size: Option<usize>,
    ) -> Result<ArchiveInfo, String> {
        Self::analyze_with_storage_client(client, file_path).await
    }

    async fn extract_preview_with_client(
        &self,
        client: Arc<dyn StorageClient>,
        file_path: &str,
        entry_path: &str,
        max_size: usize,
    ) -> Result<FilePreview, String> {
        Self::extract_preview_with_storage_client(client, file_path, entry_path, max_size).await
    }

    fn compression_type(&self) -> CompressionType {
        CompressionType::Tar
    }

    fn validate_format(&self, data: &[u8]) -> bool {
        data.len() >= 512 && {
            // TAR文件以512字节为块，检查文件头
            let header = &data[..512];
            // 简单验证：检查magic字段
            header[257..262] == [0x75, 0x73, 0x74, 0x61, 0x72] // "ustar"
        }
    }
}

impl TarHandler {
    /// 使用存储客户端分析TAR文件（流式分析）
    async fn analyze_with_storage_client(
        client: Arc<dyn StorageClient>,
        file_path: &str,
    ) -> Result<ArchiveInfo, String> {
        log::debug!("TAR流式分析开始: {}", file_path);

        // 获取文件大小
        let file_size = client.get_file_size(file_path).await
            .map_err(|e| format!("Failed to get file size: {}", e))?;

        log::debug!("TAR文件大小: {} 字节", file_size);

        // 所有TAR文件都使用流式分析，因为TAR格式天然支持顺序读取
        // 这样可以节省内存，提高性能，特别是对于大文件
        Self::analyze_tar_streaming(client, file_path, file_size).await
    }

    /// 使用存储客户端提取TAR文件预览（流式提取）
    async fn extract_preview_with_storage_client(
        client: Arc<dyn StorageClient>,
        file_path: &str,
        entry_path: &str,
        max_size: usize,
    ) -> Result<FilePreview, String> {
        // 使用流式方法提取预览，避免加载整个文件
        Self::extract_tar_preview_streaming(client, file_path, entry_path, max_size).await
    }

    /// 验证TAR文件头
    #[allow(dead_code)]
    fn validate_tar_header(data: &[u8]) -> bool {
        if data.len() < 512 {
            return false;
        }

        // 检查TAR文件的magic bytes
        let magic_ustar = &data[257..262];
        let magic_gnu = &data[257..265];

        magic_ustar == b"ustar" || magic_gnu == b"ustar  \0"
    }

    /// 流式提取TAR文件预览，只读取目标文件内容
    async fn extract_tar_preview_streaming(
        client: Arc<dyn StorageClient>,
        file_path: &str,
        entry_path: &str,
        max_size: usize,
    ) -> Result<FilePreview, String> {
        log::debug!("开始流式提取TAR文件预览: {} -> {}", file_path, entry_path);

        let file_size = client.get_file_size(file_path).await
            .map_err(|e| format!("Failed to get file size: {}", e))?;

        let mut current_offset = 0u64;
        let mut index = 0;

        // TAR文件以512字节为一个块
        const BLOCK_SIZE: u64 = 512;

        while current_offset < file_size {
            // 读取TAR头部（512字节）
            let header_data = match client.read_file_range(file_path, current_offset, BLOCK_SIZE).await {
                Ok(data) => {
                    if data.len() < BLOCK_SIZE as usize {
                        break;
                    }
                    data
                },
                Err(e) => {
                    log::warn!("流式读取TAR头部失败，位置 {}: {}", current_offset, e);
                    break;
                }
            };

            // 检查是否为空块（TAR文件末尾标识）
            if header_data.iter().all(|&b| b == 0) {
                break;
            }

            // 解析TAR头部
            if let Ok(entry_info) = Self::parse_tar_header(&header_data, index) {
                // 检查是否是我们要找的文件
                if entry_info.path == entry_path {
                    if entry_info.is_dir {
                        return Err("Cannot preview directory".to_string());
                    }

                    // 找到了目标文件，读取其内容
                    let file_offset = current_offset + BLOCK_SIZE;
                    let preview_size = max_size.min(entry_info.size as usize);

                    let content_data = client.read_file_range(file_path, file_offset, preview_size as u64).await
                        .map_err(|e| format!("Failed to read file content: {}", e))?;

                    let _mime_type = detect_mime_type(&content_data);
                    let is_text = is_text_content(&content_data);

                    let content = if is_text {
                        String::from_utf8_lossy(&content_data).into_owned()
                    } else {
                        general_purpose::STANDARD.encode(&content_data)
                    };

                    return Ok(PreviewBuilder::new()
                        .content(content)
                        .total_size(entry_info.size)
                        .file_type(if is_text { FileType::Text } else { FileType::Binary })
                        .encoding(if is_text { "utf-8".to_string() } else { "base64".to_string() })
                        .with_truncated(content_data.len() >= max_size || (content_data.len() as u64) < entry_info.size)
                        .build());
                }

                // 计算文件数据的大小（向上舍入到512字节的倍数）
                let file_size_blocks = (entry_info.size + BLOCK_SIZE - 1) / BLOCK_SIZE;
                let file_data_size = file_size_blocks * BLOCK_SIZE;

                // 跳过头部和文件数据
                current_offset += BLOCK_SIZE + file_data_size;
                index += 1;

                // 防止无限循环
                if index >= 10000 {
                    log::warn!("TAR条目搜索达到限制(10000)，停止搜索");
                    break;
                }
            } else {
                log::warn!("解析TAR头部失败，位置 {}", current_offset);
                current_offset += BLOCK_SIZE;
            }
        }

        Err("File not found in archive".to_string())
    }

    /// 流式分析TAR文件，逐块读取头部信息
    ///
    /// TAR格式的优势：
    /// 1. 顺序存储格式，天然支持流式处理
    /// 2. 每个文件头固定512字节，便于解析
    /// 3. 无需随机访问，适合网络存储
    /// 4. 内存占用恒定，不受文件大小影响
    async fn analyze_tar_streaming(
        client: Arc<dyn StorageClient>,
        file_path: &str,
        file_size: u64,
    ) -> Result<ArchiveInfo, String> {
        log::debug!("开始流式分析TAR文件: {} ({} 字节)", file_path, file_size);

        let mut entries = Vec::new();
        let mut total_uncompressed_size = 0u64;
        let mut current_offset = 0u64;
        let mut index = 0;

        // TAR文件以512字节为一个块
        const BLOCK_SIZE: u64 = 512;

        while current_offset < file_size {
            // 读取TAR头部（512字节）
            let header_data = match client.read_file_range(file_path, current_offset, BLOCK_SIZE).await {
                Ok(data) => {
                    if data.len() < BLOCK_SIZE as usize {
                        // 文件结束或不完整的块
                        break;
                    }
                    data
                },
                Err(e) => {
                    log::warn!("流式读取TAR头部失败，位置 {}: {}", current_offset, e);
                    break;
                }
            };

            // 检查是否为空块（TAR文件末尾标识）
            if header_data.iter().all(|&b| b == 0) {
                break;
            }

            // 解析TAR头部
            if let Ok(entry_info) = Self::parse_tar_header(&header_data, index) {
                total_uncompressed_size += entry_info.size;
                entries.push(entry_info);

                // 计算文件数据的大小（向上舍入到512字节的倍数）
                let file_size_blocks = (entries.last().unwrap().size + BLOCK_SIZE - 1) / BLOCK_SIZE;
                let file_data_size = file_size_blocks * BLOCK_SIZE;

                // 跳过头部和文件数据
                current_offset += BLOCK_SIZE + file_data_size;
                index += 1;

                // 限制条目数量以避免内存问题
                if entries.len() >= 10000 {
                    log::warn!("TAR条目数量达到限制(10000)，停止分析");
                    break;
                }
            } else {
                log::warn!("解析TAR头部失败，位置 {}", current_offset);
                current_offset += BLOCK_SIZE;
            }
        }

        log::debug!("流式分析完成，找到 {} 个条目", entries.len());

        let entry_count = entries.len();

        Ok(ArchiveInfoBuilder::new(CompressionType::Tar)
            .entries(entries)
            .total_uncompressed_size(total_uncompressed_size)
            .total_compressed_size(file_size)
            .supports_streaming(true)
            .supports_random_access(false)
            .analysis_status(if entry_count >= 10000 {
                AnalysisStatus::Partial { analyzed_entries: entry_count }
            } else {
                AnalysisStatus::Complete
            })
            .build())
    }

    /// 解析TAR头部信息
    fn parse_tar_header(header: &[u8], index: usize) -> Result<ArchiveEntry, String> {
        if header.len() < 512 {
            return Err("Header too short".to_string());
        }

        // 提取文件名（前100字节，以null结尾）
        let name_bytes = &header[0..100];
        let name_end = name_bytes.iter().position(|&b| b == 0).unwrap_or(100);
        let name = String::from_utf8_lossy(&name_bytes[..name_end]).to_string();

        if name.is_empty() {
            return Err("Empty file name".to_string());
        }

        // 提取文件大小（八进制字符串，位置124-135）
        let size_bytes = &header[124..136];
        let size_string = String::from_utf8_lossy(size_bytes);
        let size_str = size_string.trim_end_matches('\0').trim();
        let size = u64::from_str_radix(size_str, 8)
            .map_err(|_| format!("Invalid size field: {}", size_str))?;

        // 提取修改时间（八进制字符串，位置136-147）
        let mtime_bytes = &header[136..148];
        let mtime_string = String::from_utf8_lossy(mtime_bytes);
        let mtime_str = mtime_string.trim_end_matches('\0').trim();
        let mtime = u64::from_str_radix(mtime_str, 8).unwrap_or(0);

        // 提取文件类型（位置156）
        let type_flag = header[156];
        let is_directory = type_flag == b'5' || name.ends_with('/');

        let last_modified = if mtime > 0 {
            use std::time::{Duration, UNIX_EPOCH};
            use chrono::{DateTime, Utc};
            let duration = Duration::from_secs(mtime);
            let datetime = UNIX_EPOCH + duration;
            let datetime: DateTime<Utc> = datetime.into();
            Some(datetime.to_rfc3339())
        } else {
            None
        };

        Ok(ArchiveEntry {
            path: name,
            size: size,
            compressed_size: Some(size), // TAR文件不压缩
            is_dir: is_directory,
            modified_time: last_modified,
            crc32: None,
            index,
            metadata: HashMap::new(),
        })
    }
}
