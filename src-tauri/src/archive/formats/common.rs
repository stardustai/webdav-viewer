/// 共享的工具函数和常用逻辑

/// 检测 MIME 类型
pub fn detect_mime_type(data: &[u8]) -> String {
    // 检查文件头部特征
    if data.len() >= 8 {
        // PNG
        if &data[0..8] == b"\x89PNG\r\n\x1a\n" {
            return "image/png".to_string();
        }
        // JPEG
        if &data[0..3] == b"\xff\xd8\xff" {
            return "image/jpeg".to_string();
        }
        // GIF
        if &data[0..6] == b"GIF87a" || &data[0..6] == b"GIF89a" {
            return "image/gif".to_string();
        }
        // PDF
        if &data[0..5] == b"%PDF-" {
            return "application/pdf".to_string();
        }
    }

    // 尝试解析为文本
    if is_text_content(data) {
        "text/plain".to_string()
    } else {
        "application/octet-stream".to_string()
    }
}

/// 检查是否为文本内容
pub fn is_text_content(data: &[u8]) -> bool {
    if data.is_empty() {
        return true;
    }

    // 检查前1024字节或全部数据
    let check_len = data.len().min(1024);
    let sample = &data[0..check_len];

    // 统计非文本字符数量
    let mut non_text_count = 0;
    let mut total_checked = 0;

    for &byte in sample {
        total_checked += 1;

        // 允许的文本字符：
        // - ASCII 可打印字符 (32-126)
        // - 常见空白字符 (9, 10, 13)
        // - UTF-8 序列起始字节 (128-255)
        if !(32..=126).contains(&byte) && // 可打印ASCII
           ![9, 10, 13].contains(&byte) && // 制表符、换行符、回车符
           byte < 128 { // 非UTF-8起始字节
            non_text_count += 1;
        }
    }

    // 如果非文本字符比例小于10%，认为是文本
    (non_text_count as f64 / total_checked as f64) < 0.1
}

/// 文本解码工具
pub struct TextDecoder;

impl TextDecoder {
    /// 尝试解码文本（处理非UTF-8编码）
    pub fn try_decode_text(buffer: Vec<u8>) -> Result<String, String> {
        // 尝试UTF-8
        if let Ok(text) = String::from_utf8(buffer.clone()) {
            return Ok(text);
        }

        // 尝试Latin-1（ISO-8859-1）
        let latin1_text: String = buffer.iter().map(|&b| b as char).collect();
        if latin1_text.chars().all(|c| !c.is_control() || c.is_whitespace()) {
            return Ok(format!("[Latin-1编码]\n{}", latin1_text));
        }

        // 如果都不行，返回十六进制表示
        Ok(Self::format_binary_preview(buffer))
    }

    /// 格式化二进制预览
    pub fn format_binary_preview(buffer: Vec<u8>) -> String {
        let mut result = String::new();
        result.push_str("[二进制文件预览]\n");

        for (i, chunk) in buffer.chunks(16).enumerate() {
            // 地址
            result.push_str(&format!("{:08x}: ", i * 16));

            // 十六进制
            for (j, &byte) in chunk.iter().enumerate() {
                result.push_str(&format!("{:02x} ", byte));
                if j == 7 {
                    result.push(' ');
                }
            }

            // 填充空格
            for _ in chunk.len()..16 {
                result.push_str("   ");
                if chunk.len() <= 8 {
                    result.push(' ');
                }
            }

            // ASCII表示
            result.push_str(" |");
            for &byte in chunk {
                if (32..=126).contains(&byte) {
                    result.push(byte as char);
                } else {
                    result.push('.');
                }
            }
            result.push_str("|\n");

            // 限制预览长度
            if i >= 32 {
                result.push_str("...\n");
                break;
            }
        }

        result
    }
}

/// 文件预览构建器
pub struct PreviewBuilder {
    content: String,
    is_truncated: bool,
    total_size: u64,
    preview_size: usize,
    encoding: String,
    file_type: crate::archive::types::FileType,
}

impl PreviewBuilder {
    pub fn new() -> Self {
        Self {
            content: String::new(),
            is_truncated: false,
            total_size: 0,
            preview_size: 0,
            encoding: "utf-8".to_string(),
            file_type: crate::archive::types::FileType::Unknown,
        }
    }

    pub fn content(mut self, content: String) -> Self {
        self.preview_size = content.len();
        self.content = content;
        self
    }

    pub fn with_truncated(mut self, truncated: bool) -> Self {
        self.is_truncated = truncated;
        self
    }

    pub fn total_size(mut self, size: u64) -> Self {
        self.total_size = size;
        self
    }

    pub fn file_type(mut self, file_type: crate::archive::types::FileType) -> Self {
        self.file_type = file_type;
        self
    }

    pub fn encoding(mut self, encoding: String) -> Self {
        self.encoding = encoding;
        self
    }

    pub fn build(self) -> crate::archive::types::FilePreview {
        crate::archive::types::FilePreview {
            content: self.content,
            is_truncated: self.is_truncated,
            total_size: self.total_size,
            preview_size: self.preview_size,
            encoding: self.encoding,
            file_type: self.file_type,
        }
    }
}

/// 压缩包信息构建器
pub struct ArchiveInfoBuilder {
    compression_type: crate::archive::types::CompressionType,
    entries: Vec<crate::archive::types::ArchiveEntry>,
    total_entries: usize,
    total_uncompressed_size: u64,
    total_compressed_size: u64,
    supports_streaming: bool,
    supports_random_access: bool,
    analysis_status: crate::archive::types::AnalysisStatus,
}

impl ArchiveInfoBuilder {
    pub fn new(compression_type: crate::archive::types::CompressionType) -> Self {
        Self {
            compression_type,
            entries: Vec::new(),
            total_entries: 0,
            total_uncompressed_size: 0,
            total_compressed_size: 0,
            supports_streaming: false,
            supports_random_access: false,
            analysis_status: crate::archive::types::AnalysisStatus::Complete,
        }
    }

    pub fn entries(mut self, entries: Vec<crate::archive::types::ArchiveEntry>) -> Self {
        self.total_entries = entries.len();
        self.entries = entries;
        self
    }

    pub fn total_entries(mut self, count: usize) -> Self {
        self.total_entries = count;
        self
    }

    pub fn total_uncompressed_size(mut self, size: u64) -> Self {
        self.total_uncompressed_size = size;
        self
    }

    pub fn total_compressed_size(mut self, size: u64) -> Self {
        self.total_compressed_size = size;
        self
    }

    pub fn supports_streaming(mut self, streaming: bool) -> Self {
        self.supports_streaming = streaming;
        self
    }

    pub fn supports_random_access(mut self, random_access: bool) -> Self {
        self.supports_random_access = random_access;
        self
    }

    pub fn analysis_status(mut self, status: crate::archive::types::AnalysisStatus) -> Self {
        self.analysis_status = status;
        self
    }

    pub fn build(self) -> crate::archive::types::ArchiveInfo {
        crate::archive::types::ArchiveInfo {
            compression_type: self.compression_type,
            entries: self.entries,
            total_entries: self.total_entries,
            total_uncompressed_size: self.total_uncompressed_size,
            total_compressed_size: self.total_compressed_size,
            supports_streaming: self.supports_streaming,
            supports_random_access: self.supports_random_access,
            analysis_status: self.analysis_status,
        }
    }
}
