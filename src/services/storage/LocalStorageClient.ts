import { BaseStorageClient } from './BaseStorageClient';
import {
  ConnectionConfig,
  DirectoryResult,
  FileContent,
  ListOptions,
  ReadOptions,
  StorageFile
} from './types';
import { ArchiveInfo, FilePreview } from '../../types';

/**
 * 本机文件系统存储客户端
 * 通过 Tauri 的文件系统权限访问本机文件
 */
export class LocalStorageClient extends BaseStorageClient {
  protected protocol = 'local';
  private rootPath: string = '';
  private displayPath: string = '';

  /**
   * 获取连接的显示名称
   */
  getDisplayName(): string {
    return this.displayPath || '本机文件';
  }

  /**
   * 构建文件URL（本地文件路径）
   */
  protected buildFileUrl(path: string): string {
    // 对于本地文件，返回相对路径，让后端处理完整路径构建
    return path;
  }

  /**
   * 获取认证头（本地文件无需认证）
   */
  protected getAuthHeaders(): Record<string, string> {
    return {};
  }

  async connect(config: ConnectionConfig): Promise<boolean> {
    try {
      // 验证本机文件系统配置
      if (!config.url && !config.rootPath) {
        throw new Error('Root path is required for local file system');
      }

      const rootPath = config.url || config.rootPath!;

      // 通过 Tauri 后端验证路径是否存在且可访问
      const response = await this.makeRequest({
        method: 'CHECK_ACCESS',
        url: rootPath,
        options: {
          protocol: 'local'
        }
      });

      if (response.status !== 200) {
        throw new Error(`Cannot access path: ${rootPath}`);
      }

      // 保存根路径用于后续的路径构建
      this.displayPath = rootPath;
      this.rootPath = rootPath; // 保留完整路径，不要设置为空
      this.connected = true;
      return true;
    } catch (error) {
      console.error('Local storage connection failed:', error);
      this.connected = false;
      return false;
    }
  }

  disconnect(): void {
    this.connected = false;
    this.rootPath = '';
    this.displayPath = ''; // 清理显示路径
  }

  async listDirectory(path: string = '', options?: ListOptions): Promise<DirectoryResult> {
    if (!this.connected) {
      throw new Error('Local storage not connected');
    }

    // 对于本地文件系统，直接传递相对路径给后端
    // 后端会自动与根目录拼接
    const response = await this.makeRequest({
      method: 'LIST_DIRECTORY',
      url: path, // 直接传递路径，不需要构建完整路径
      options: {
        protocol: 'local',
        ...options
      }
    });

    if (response.status !== 200) {
      throw new Error(`Failed to list directory: ${response.body}`);
    }

    const data = JSON.parse(response.body);

    // 转换为统一的文件格式
    const files: StorageFile[] = data.files.map((file: any) => ({
      filename: file.filename || file.name || 'Unknown',
      basename: file.basename || file.filename || file.name || 'Unknown',
      lastmod: file.lastmod || file.modified || new Date().toISOString(),
      size: file.size || 0,
      type: file.type || (file.file_type === 'directory' || file.is_dir ? 'directory' : 'file'),
      mime: file.mime || file.mime_type,
      etag: file.etag
    }));

    return {
      files,
      hasMore: false, // 本机文件系统一次返回所有文件
      path: path,
      totalCount: files.length
    };
  }

  async getFileContent(path: string, options?: ReadOptions): Promise<FileContent> {
    if (!this.connected) {
      throw new Error('Local storage not connected');
    }

    const response = await this.makeRequest({
      method: 'READ_FILE',
      url: path, // 直接传递路径
      options: {
        protocol: 'local',
        start: options?.start,
        length: options?.length
      }
    });

    if (response.status !== 200) {
      throw new Error(`Failed to read file: ${response.body}`);
    }

    const data = JSON.parse(response.body);

    return {
      content: data.content,
      size: data.size,
      encoding: data.encoding || 'utf-8'
    };
  }

  async getFileSize(path: string): Promise<number> {
    if (!this.connected) {
      throw new Error('Local storage not connected');
    }

    const response = await this.makeRequest({
      method: 'GET_FILE_SIZE',
      url: path, // 直接传递路径
      options: {
        protocol: 'local'
      }
    });

    if (response.status !== 200) {
      throw new Error(`Failed to get file size: ${response.body}`);
    }

    const data = JSON.parse(response.body);
    return data.size;
  }

  async downloadFile(path: string): Promise<Blob> {
    if (!this.connected) {
      throw new Error('Local storage not connected');
    }

    // 对于本机文件，直接读取为二进制数据
    const arrayBuffer = await this.makeRequestBinary({
      method: 'READ_FILE_BINARY',
      url: path, // 直接传递路径
      options: {
        protocol: 'local'
      }
    });

    return new Blob([arrayBuffer]);
  }

  async downloadFileWithProgress(path: string, filename: string): Promise<string> {
    if (!this.connected) {
      throw new Error('Local storage not connected');
    }

    // 对于本机文件，可以直接复制而不需要下载
    return await this.downloadWithProgress(
      'COPY_FILE',
      path, // 直接传递路径
      filename,
      {}
    );
  }

  /**
   * 构建完整的文件路径
   */
  private buildFullPath(relativePath: string): string {
    // 防止路径遍历攻击
    if (relativePath.includes('..')) {
      throw new Error('Path traversal detected');
    }

    // 清理相对路径
    const cleanPath = relativePath.replace(/^\/+/, '').replace(/\/+/g, '/');

    // 如果是根路径，直接返回 rootPath
    if (!cleanPath) {
      return this.rootPath;
    }

    // 拼接完整路径
    const separator = this.rootPath.endsWith('/') || this.rootPath.endsWith('\\') ? '' : '/';
    return `${this.rootPath}${separator}${cleanPath}`;
  }

  /**
   * 分析压缩文件结构（本地文件统一流式实现）
   */
  async analyzeArchive(
    path: string,
    filename: string,
    maxSize?: number
  ): Promise<ArchiveInfo> {
    try {
      // 本地文件使用统一的StorageClient流式分析接口
      console.log('本地文件使用统一流式分析:', { path, filename });

      const result = await this.analyzeArchiveWithClient(path, filename, maxSize);

      return result;
    } catch (error) {
      console.error('Failed to analyze local archive:', error);
      throw error;
    }
  }

  /**
   * 获取压缩文件中的文件预览（本地文件特定实现）
   */
  async getArchiveFilePreview(
    path: string,
    filename: string,
    entryPath: string,
    maxPreviewSize?: number
  ): Promise<FilePreview> {
    try {
      // 对于本地文件，使用存储客户端接口进行流式预览
      console.log('本地文件获取压缩文件预览:', {
        path,
        filename,
        entryPath
      });

      // 使用流式预览接口，只读取需要的部分
      return await this.getArchiveFilePreviewWithClient(
        path,
        filename,
        entryPath,
        maxPreviewSize
      );
    } catch (error) {
      console.error('Failed to get local archive file preview:', error);
      throw error;
    }
  }

  /**
   * 获取根路径
   */
  getRootPath(): string {
    return this.rootPath;
  }

  /**
   * 获取文件的实际路径（用于压缩包处理等需要直接访问文件的场景）
   */
  getActualFilePath(relativePath: string): string {
    // 对于压缩包处理，我们需要返回完整路径
    return this.buildFullPath(relativePath);
  }
}
