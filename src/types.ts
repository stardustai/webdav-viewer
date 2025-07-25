export interface WebDAVFile {
  filename: string;
  basename: string;
  lastmod: string;
  size: number;
  type: 'file' | 'directory';
  mime?: string;
  etag?: string;
}

export interface WebDAVConnection {
  url: string;
  username: string;
  password: string;
  connected: boolean;
}

export interface FileContent {
  content: string;
  size: number;
  encoding: string;
}

export interface SearchResult {
  line: number;
  column: number;
  text: string;
  match: string;
}

export interface ReleaseInfo {
  downloadUrl: string;
  filename: string;
  fileSize: string;
}

export interface UpdateCheckResult {
  hasUpdate: boolean;
  currentVersion: string;
  latestVersion: string;
  downloadUrl?: string;
  filename?: string;
  fileSize?: string;
}

export interface ArchiveEntry {
  path: string;
  size: number;
  is_dir: boolean;
  modified_time?: string;
  compressed_size?: number;
}

export interface ArchiveInfo {
  entries: ArchiveEntry[];
  total_entries: number;
  compression_type: string;
  total_uncompressed_size: number;
  total_compressed_size: number;
  supports_streaming?: boolean;
  supports_random_access?: boolean;
  analysis_status?: AnalysisStatus;
}

export interface AnalysisStatus {
  Complete?: {};
  Partial?: { analyzed_entries: number };
  Streaming?: { estimated_entries: number | null };
  Failed?: { error: string };
}

export interface FilePreview {
  content: string;
  is_truncated: boolean;
  total_size: number;
  preview_size: number;
  encoding: string;
  file_type: string;
}

