use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fmt;

/// 压缩格式类型
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum CompressionType {
    Zip,
    Gzip,
    Tar,
    TarGz,
    Brotli,
    Lz4,
    Zstd,
    SevenZip,
    Rar,
    Unknown,
}

impl CompressionType {
    pub fn from_filename(filename: &str) -> Self {
        let lower = filename.to_lowercase();
        if lower.ends_with(".zip") {
            CompressionType::Zip
        } else if lower.ends_with(".gz") && !lower.contains(".tar.") {
            CompressionType::Gzip
        } else if lower.ends_with(".tar") {
            CompressionType::Tar
        } else if lower.ends_with(".tar.gz") || lower.ends_with(".tgz") {
            CompressionType::TarGz
        } else if lower.ends_with(".br") {
            CompressionType::Brotli
        } else if lower.ends_with(".lz4") {
            CompressionType::Lz4
        } else if lower.ends_with(".zst") || lower.ends_with(".zstd") {
            CompressionType::Zstd
        } else if lower.ends_with(".7z") {
            CompressionType::SevenZip
        } else if lower.ends_with(".rar") {
            CompressionType::Rar
        } else {
            CompressionType::Unknown
        }
    }

    /// 获取压缩类型的字符串表示
    pub fn as_str(&self) -> &'static str {
        match self {
            CompressionType::Zip => "zip",
            CompressionType::Gzip => "gzip",
            CompressionType::Tar => "tar",
            CompressionType::TarGz => "tar.gz",
            CompressionType::Brotli => "brotli",
            CompressionType::Lz4 => "lz4",
            CompressionType::Zstd => "zstd",
            CompressionType::SevenZip => "7z",
            CompressionType::Rar => "rar",
            CompressionType::Unknown => "unknown",
        }
    }

    pub fn supports_streaming(&self) -> bool {
        matches!(
            self,
            CompressionType::Zip |
            CompressionType::TarGz |
            CompressionType::Tar |
            CompressionType::Gzip
        )
        // 7z 和 RAR 不支持流式处理，需要完整文件下载
    }

    #[allow(dead_code)] // API 保留方法，可能在未来版本使用
    pub fn supports_random_access(&self) -> bool {
        matches!(self, CompressionType::Zip)
    }
}

impl fmt::Display for CompressionType {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.as_str())
    }
}

/// 压缩包条目信息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ArchiveEntry {
    pub path: String,
    pub size: u64,
    pub compressed_size: Option<u64>,
    pub is_dir: bool,
    pub modified_time: Option<String>,
    pub crc32: Option<u32>,
    /// 条目在压缩包中的索引
    pub index: usize,
    /// 额外的元数据
    pub metadata: HashMap<String, String>,
}

/// 压缩包整体信息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ArchiveInfo {
    pub compression_type: CompressionType,
    pub entries: Vec<ArchiveEntry>,
    pub total_entries: usize,
    pub total_uncompressed_size: u64,
    pub total_compressed_size: u64,
    /// 是否支持流式读取
    pub supports_streaming: bool,
    /// 是否支持随机访问
    pub supports_random_access: bool,
    /// 分析状态
    pub analysis_status: AnalysisStatus,
}

/// 分析状态
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum AnalysisStatus {
    /// 完整分析完成
    Complete,
    /// 部分分析（只读取了部分条目）
    Partial { analyzed_entries: usize },
    /// 流式分析（基于文件头/尾分析）
    Streaming { estimated_entries: Option<usize> },
    /// 分析失败
    Failed { error: String },
}

/// 文件预览结果
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FilePreview {
    pub content: String,
    pub is_truncated: bool,
    pub total_size: u64,
    pub preview_size: usize,
    pub encoding: String,
    pub file_type: FileType,
}

/// 文件类型
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum FileType {
    Text,
    Binary,
    Image,
    Audio,
    Video,
    Archive,
    Unknown,
}

impl FileType {
    #[allow(dead_code)] // 在其他模块中被使用
    pub fn from_path(path: &str) -> Self {
        let lower = path.to_lowercase();
        let ext = lower.split('.').last().unwrap_or("");

        match ext {
            "txt" | "md" | "json" | "jsonl" | "xml" | "html" | "css" | "js" | "ts" | "jsx" | "tsx" | "py" | "rs" | "go" | "java" | "c" | "cpp" | "h" |
            "php" | "rb" | "yaml" | "yml" | "sql" | "sh" | "bat" | "ps1" | "log" | "config" | "ini" | "tsv" | "csv" | "scss" | "less" => FileType::Text,
            "jpg" | "jpeg" | "png" | "gif" | "bmp" | "svg" | "webp" => FileType::Image,
            "mp3" | "wav" | "flac" | "ogg" | "aac" => FileType::Audio,
            "mp4" | "avi" | "mov" | "wmv" | "mkv" => FileType::Video,
            "zip" | "tar" | "gz" | "7z" | "rar" => FileType::Archive,
            _ => {
                if ext.is_empty() {
                    FileType::Unknown
                } else {
                    FileType::Binary
                }
            }
        }
    }

    #[allow(dead_code)] // 在其他模块中被使用
    pub fn is_text(&self) -> bool {
        matches!(self, FileType::Text)
    }

    #[allow(dead_code)] // API 保留方法
    pub fn supports_preview(&self) -> bool {
        matches!(self, FileType::Text | FileType::Image)
    }
}

/// 下载选项
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DownloadOptions {
    pub save_path: String,
    pub overwrite: bool,
    pub resume: bool,
    pub chunk_size: usize,
}

/// 批量操作选项
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BatchOptions {
    pub max_concurrent: usize,
    pub continue_on_error: bool,
    pub progress_callback: bool,
}
