import { invoke } from '@tauri-apps/api/core';
import {
  StorageClient,
  ConnectionConfig,
  DirectoryResult,
  FileContent,
  ListOptions,
  ReadOptions,
  StorageResponse
} from './types';
import { CompressionService } from '../compression';
import { ArchiveInfo, FilePreview } from '../../types';

/**
 * 统一存储客户端基类
 * 提供所有存储类型的通用接口实现
 */
export abstract class BaseStorageClient implements StorageClient {
  protected abstract protocol: string;
  protected connected: boolean = false;

  /**
   * 获取连接的显示名称
   */
  abstract getDisplayName(): string;

  /**
   * 发起存储请求的统一接口
   */
  protected async makeRequest(params: {
    method: string;
    url: string;
    headers?: Record<string, string>;
    body?: string;
    options?: any;
  }): Promise<StorageResponse> {
    return await invoke('storage_request', {
      protocol: this.protocol,
      method: params.method,
      url: params.url,
      headers: params.headers || {},
      body: params.body,
      options: params.options,
    });
  }

  /**
   * 发起二进制请求
   */
  protected async makeRequestBinary(params: {
    method: string;
    url: string;
    headers?: Record<string, string>;
    options?: any;
  }): Promise<ArrayBuffer> {
    const response = await invoke<string>('storage_request_binary', {
      protocol: this.protocol,
      method: params.method,
      url: params.url,
      headers: params.headers || {},
      options: params.options,
    });

    // 转换为 ArrayBuffer
    const binaryString = atob(response);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes.buffer;
  }

  /**
   * 带进度的下载接口
   * 使用 Tauri 后端提供的流式下载和进度事件
   */
  protected async downloadWithProgress(
    method: string,
    url: string,
    filename: string,
    headers: Record<string, string> = {}
  ): Promise<string> {
    return await invoke('download_file_with_progress', {
      method,
      url,
      headers,
      filename,
    });
  }

  /**
   * 分析压缩文件（统一使用StorageClient流式接口）
   */
  async analyzeArchive(
    path: string,
    filename: string,
    maxSize?: number
  ): Promise<ArchiveInfo> {
    try {
      // 所有存储类型都使用统一的StorageClient流式接口
      console.log(`${this.protocol}存储使用统一流式分析:`, { path, filename });
      return await this.analyzeArchiveWithClient(path, filename, maxSize);
    } catch (error) {
      console.error('Failed to analyze archive:', error);
      throw error;
    }
  }

  /**
   * 获取压缩文件中的文件预览（统一使用StorageClient流式接口）
   */
  async getArchiveFilePreview(
    path: string,
    filename: string,
    entryPath: string,
    maxPreviewSize?: number
  ): Promise<FilePreview> {
    try {
      // 所有存储类型都使用统一的StorageClient流式接口
      console.log(`${this.protocol}存储使用统一流式预览:`, { path, filename, entryPath });
      return await this.getArchiveFilePreviewWithClient(path, filename, entryPath, maxPreviewSize);
    } catch (error) {
      console.error('Failed to get archive file preview:', error);
      throw error;
    }
  }

  /**
   * 检查文件是否为支持的压缩格式
   */
  async isSupportedArchive(filename: string): Promise<boolean> {
    return await CompressionService.isSupportedArchive(filename);
  }

  /**
   * 通过存储客户端分析压缩文件（用于本地文件）
   */
  protected async analyzeArchiveWithClient(
    path: string,
    filename: string,
    maxSize?: number
  ): Promise<ArchiveInfo> {
    // 通过Tauri命令调用后端的存储客户端接口
    return await invoke('analyze_archive_with_client', {
      protocol: this.protocol,
      filePath: path,
      filename,
      maxSize
    });
  }

  /**
   * 通过存储客户端获取压缩文件预览（用于本地文件）
   */
  protected async getArchiveFilePreviewWithClient(
    path: string,
    filename: string,
    entryPath: string,
    maxPreviewSize?: number
  ): Promise<FilePreview> {
    // 通过Tauri命令调用后端的存储客户端接口
    return await invoke('get_archive_preview_with_client', {
      protocol: this.protocol,
      filePath: path,
      filename,
      entryPath,
      maxPreviewSize
    });
  }

  /**
   * 构建文件URL（子类实现）
   */
  protected abstract buildFileUrl(path: string): string;

  /**
   * 获取认证头（子类实现）
   */
  protected abstract getAuthHeaders(): Record<string, string>;

	// 抽象方法，由具体实现定义
  abstract connect(config: ConnectionConfig): Promise<boolean>;
  abstract disconnect(): void;
  abstract listDirectory(path: string, options?: ListOptions): Promise<DirectoryResult>;
  abstract getFileContent(path: string, options?: ReadOptions): Promise<FileContent>;
  abstract getFileSize(path: string): Promise<number>;
  abstract downloadFile(path: string): Promise<Blob>;

  isConnected(): boolean {
    return this.connected;
  }

  // 可选的带进度下载方法，由子类实现
  downloadFileWithProgress?(_path: string, _filename: string): Promise<string>;
}
