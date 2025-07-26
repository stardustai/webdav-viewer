import { invoke } from '@tauri-apps/api/core';
import { BaseStorageClient } from './BaseStorageClient';
import {
  ConnectionConfig,
  DirectoryResult,
  FileContent,
  ListOptions,
  ReadOptions,
} from './types';
import { ArchiveInfo, FilePreview } from '../../types';

interface OSSConnection {
  endpoint: string;
  accessKey: string;
  secretKey: string;
  bucket: string;
  region?: string;
  connected: boolean;
}

/**
 * OSS (Object Storage Service) 客户端实现
 * 支持阿里云 OSS、AWS S3 兼容的对象存储服务
 */
export class OSSStorageClient extends BaseStorageClient {
  protected protocol = 'oss';
  private connection: OSSConnection | null = null;

  /**
   * 获取连接的显示名称
   */
  getDisplayName(): string {
    if (!this.connection?.endpoint) return 'OSS';

    try {
      const url = new URL(this.connection.endpoint);
      return `${this.connection.bucket}.${url.hostname}`;
    } catch {
      return `${this.connection.bucket} (OSS)`;
    }
  }

  async connect(config: ConnectionConfig): Promise<boolean> {
    if (config.type !== 'oss') {
      throw new Error('Invalid connection type for OSS client');
    }

    // 验证必需的配置
    if (!config.url || !config.username || !config.password) {
      throw new Error('OSS requires endpoint (url), accessKey (username), and secretKey (password)');
    }

    // 解析配置：url作为endpoint，username作为accessKey，password作为secretKey
    const rawUrl = config.url;
    const accessKey = config.username;
    const secretKey = config.password;

    // 优先使用配置中的 bucket、region 和 endpoint
    let endpoint: string = config.endpoint || '';
    let bucket: string = config.bucket || '';
    let region: string = config.region || 'cn-hangzhou';

    // 如果没有直接配置，则从 URL 解析
    if (!bucket || !endpoint) {
      if (rawUrl.startsWith('oss://')) {
        // 解析 oss://hostname/bucket 格式
        const ossUrl = rawUrl.replace('oss://', '');
        const [hostname, bucketPath] = ossUrl.split('/');

        if (!bucket) {
          bucket = bucketPath || '';
        }

        if (!endpoint) {
          endpoint = `https://${hostname}`;
        }

        // 从hostname推断region（如果没有配置）
        if (!config.region && hostname.includes('oss-')) {
          const regionMatch = hostname.match(/oss-([^.]+)/);
          region = regionMatch ? regionMatch[1] : 'cn-hangzhou';
        }
      } else {
        // 如果已经是HTTP(S)格式，直接使用
        if (!endpoint) {
          endpoint = rawUrl;
        }

        // 尝试从URL提取bucket信息（虚拟主机格式）
        if (!bucket) {
          try {
            const url = new URL(endpoint);
            const hostname = url.hostname;

            if (hostname.includes('.oss-')) {
              // 虚拟主机格式：bucket.oss-region.aliyuncs.com
              const parts = hostname.split('.');
              bucket = parts[0];

              // 从hostname推断region（如果没有配置）
              if (!config.region) {
                const regionMatch = hostname.match(/oss-([^.]+)/);
                region = regionMatch ? regionMatch[1] : 'cn-hangzhou';
              }
            }
          } catch {
            // 解析失败，使用默认值
          }
        }
      }
    }

    // 验证必需的 OSS 配置
    if (!bucket) {
      throw new Error('OSS bucket is required');
    }

    // 统一端点格式为虚拟主机风格
    const normalizedEndpoint = this.normalizeOSSEndpoint(endpoint, bucket, region);

    try {
      // 通过 Tauri 命令测试连接
      const response = await invoke('storage_connect', {
        config: {
          protocol: 'oss',
          url: normalizedEndpoint,
          access_key: accessKey,
          secret_key: secretKey,
          bucket: bucket,
          region: region,
          username: null,
          password: null,
          extra_options: null,
        }
      });

      if (response) {
        this.connection = {
          endpoint: normalizedEndpoint,
          accessKey,
          secretKey,
          bucket,
          region,
          connected: true,
        };
        this.connected = true;
        return true;
      }

      return false;
    } catch (error) {
      console.error('OSS connection failed:', error);
      throw new Error(`OSS connection failed: ${error}`);
    }
  }

  disconnect(): void {
    this.connection = null;
    this.connected = false;
  }

  async listDirectory(path: string, options: ListOptions = {}): Promise<DirectoryResult> {
    if (!this.connection) {
      throw new Error('Not connected to OSS');
    }

    // 标准化路径
    const prefix = this.normalizePath(path);

    try {
      // 直接调用后端的 list_directory 方法，而不是通用的 request 方法
      const result = await invoke('storage_list_directory', {
        path: prefix,
        options: {
          page_size: options.pageSize || 1000,
          marker: options.marker,
          prefix: prefix,
          recursive: options.recursive || false,
          sort_by: options.sortBy || 'name',
          sort_order: options.sortOrder || 'asc',
        }
      });

      return result as DirectoryResult;
    } catch (error) {
      console.error('Failed to list OSS directory:', error);
      throw new Error(`Failed to list directory: ${error}`);
    }
  }

  async getFileContent(path: string, options: ReadOptions = {}): Promise<FileContent> {
    if (!this.connection) {
      throw new Error('Not connected to OSS');
    }

    const objectKey = this.normalizePath(path);

    try {
      const headers: Record<string, string> = {
        ...this.getAuthHeaders(),
      };

      // 添加范围请求头（如果指定）
      if (options.start !== undefined || options.length !== undefined) {
        const start = options.start || 0;
        const end = options.length ? start + options.length - 1 : '';
        headers['Range'] = `bytes=${start}-${end}`;
      }

      const response = await this.makeRequest({
        method: 'GET',
        url: this.buildObjectUrl(objectKey),
        headers,
      });

      return {
        content: response.body || '',
        size: parseInt(response.headers['content-length'] || '0'),
        encoding: 'utf-8',
      };
    } catch (error) {
      console.error('Failed to get OSS file content:', error);
      throw new Error(`Failed to get file content: ${error}`);
    }
  }

  async getFileSize(path: string): Promise<number> {
    if (!this.connection) {
      throw new Error('Not connected to OSS');
    }

    const objectKey = this.normalizePath(path);

    try {
      const response = await this.makeRequest({
        method: 'HEAD',
        url: this.buildObjectUrl(objectKey),
        headers: this.getAuthHeaders(),
      });

      return parseInt(response.headers['content-length'] || '0');
    } catch (error) {
      console.error('Failed to get OSS file size:', error);
      throw new Error(`Failed to get file size: ${error}`);
    }
  }

  async downloadFile(path: string): Promise<Blob> {
    if (!this.connection) {
      throw new Error('Not connected to OSS');
    }

    const objectKey = this.normalizePath(path);

    try {
      const arrayBuffer = await this.makeRequestBinary({
        method: 'GET',
        url: this.buildObjectUrl(objectKey),
        headers: this.getAuthHeaders(),
      });

      return new Blob([arrayBuffer]);
    } catch (error) {
      console.error('Failed to download OSS file:', error);
      throw new Error(`Failed to download file: ${error}`);
    }
  }

  /**
   * 带进度的下载方法
   */
  async downloadFileWithProgress(path: string, filename: string): Promise<string> {
    if (!this.connection) {
      throw new Error('Not connected to OSS');
    }

    const objectKey = this.normalizePath(path);

    try {
      return await this.downloadWithProgress(
        'GET',
        this.buildObjectUrl(objectKey),
        filename,
        this.getAuthHeaders()
      );
    } catch (error) {
      console.error('Failed to download OSS file with progress:', error);
      throw new Error(`Failed to download file: ${error}`);
    }
  }

  /**
   * 构建文件 URL
   */
  protected buildFileUrl(path: string): string {
    if (!this.connection) {
      throw new Error('Not connected to OSS');
    }

    const objectKey = this.normalizePath(path);
    return this.buildObjectUrl(objectKey);
  }

  /**
   * 获取认证头
   */
  protected getAuthHeaders(): Record<string, string> {
    if (!this.connection) {
      return {};
    }

    // OSS 认证将在后端处理，不需要在前端添加任何认证头部
    return {};
  }

  /**
   * 分析压缩文件结构（OSS统一流式实现）
   */
  async analyzeArchive(
    path: string,
    filename: string,
    maxSize?: number
  ): Promise<ArchiveInfo> {
    try {
      // OSS使用统一的StorageClient流式分析接口
      const objectKey = this.extractObjectKeyFromUrl(path);

      console.log('OSS使用统一流式分析:', { originalPath: path, extractedObjectKey: objectKey, filename });

      // 使用统一的流式分析接口
      const result = await this.analyzeArchiveWithClient(objectKey, filename, maxSize);

      return result;
    } catch (error) {
      console.error('Failed to analyze OSS archive:', error);
      throw error;
    }
  }

  /**
   * 获取压缩文件中的文件预览（OSS特定实现）
   */
  async getArchiveFilePreview(
    path: string,
    filename: string,
    entryPath: string,
    maxPreviewSize?: number
  ): Promise<FilePreview> {
    try {
      // 对于OSS，使用存储客户端接口而不是HTTP接口进行流式预览
      const objectKey = this.extractObjectKeyFromUrl(path);

      console.log('OSS获取压缩文件预览（流式）:', {
        originalPath: path,
        extractedObjectKey: objectKey,
        filename,
        entryPath
      });

      // 使用流式预览接口，只读取需要的部分
      return await this.getArchiveFilePreviewWithClient(
        objectKey,
        filename,
        entryPath,
        maxPreviewSize
      );
    } catch (error) {
      console.error('Failed to get OSS archive file preview:', error);
      throw error;
    }
  }

  /**
   * 从 OSS URL 或路径中提取对象 key
   * @param path OSS 路径或 URL
   * @returns 对象 key 或原始 path
   */
  private extractObjectKeyFromUrl(path: string): string {
    let objectKey = path;

    // 如果传入的是完整URL，提取对象键
    if (path.startsWith('http')) {
      try {
        const url = new URL(path);
        objectKey = decodeURIComponent(url.pathname.substring(1)); // 去掉开头的'/'并解码

        // 如果对象键还包含另一个URL，进一步提取
        if (objectKey.startsWith('http')) {
          const innerUrl = new URL(objectKey);
          objectKey = decodeURIComponent(innerUrl.pathname.substring(1));
        }
      } catch (error) {
        console.warn('Failed to parse URL, using as-is:', path);
        objectKey = path;
      }
    }

    return objectKey;
  }

  /**
   * 将 OSS 端点标准化为虚拟主机风格
   * 输入：https://oss-cn-hangzhou.aliyuncs.com 或 oss://hostname/bucket
   * 输出：https://bucket-name.oss-cn-hangzhou.aliyuncs.com
   */
  private normalizeOSSEndpoint(rawEndpoint: string, bucket: string, region: string): string {
    try {
      // 如果是 oss:// 协议，先转换为 https://
      let endpoint = rawEndpoint;
      if (rawEndpoint.startsWith('oss://')) {
        endpoint = rawEndpoint.replace('oss://', 'https://');
      }

      const url = new URL(endpoint);

      // 如果已经是虚拟主机风格（包含 bucket），直接返回
      if (url.hostname.startsWith(`${bucket}.`)) {
        return endpoint;
      }

      // 如果是区域端点格式，转换为虚拟主机风格
      if (url.hostname.startsWith('oss-')) {
        return `${url.protocol}//${bucket}.${url.hostname}${url.pathname !== '/' ? url.pathname : ''}`;
      }

      // 如果是其他格式，尝试构建标准的阿里云 OSS 端点
      return `https://${bucket}.oss-${region}.aliyuncs.com`;
    } catch (error) {
      // 如果解析失败，构建默认端点
      return `https://${bucket}.oss-${region}.aliyuncs.com`;
    }
  }

  /**
   * 标准化路径
   */
  private normalizePath(path: string): string {
    // 如果路径是完整的 oss:// URL，提取对象键部分
    if (path.startsWith('oss://')) {
      try {
        // 解析 oss://hostname/bucket/object-key 格式
        const ossUrl = path.replace('oss://', '');
        const parts = ossUrl.split('/');
        if (parts.length >= 3) {
          // 跳过 hostname 和 bucket，获取 object key
          return parts.slice(2).join('/');
        }
      } catch (error) {
        console.warn('Failed to parse OSS URL:', path, error);
      }
    }

    // 移除开头的斜杠，OSS 对象键不应该以斜杠开头
    return path.replace(/^\/+/, '');
  }

  /**
   * 构建对象的 URL
   */
  private buildObjectUrl(objectKey: string): string {
    if (!this.connection) {
      throw new Error('Not connected');
    }

    return `${this.connection.endpoint}/${encodeURIComponent(objectKey)}`;
  }
}
