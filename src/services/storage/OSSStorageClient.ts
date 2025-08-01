import { invoke } from '@tauri-apps/api/core';
import { BaseStorageClient } from './BaseStorageClient';
import {
  ConnectionConfig,
  DirectoryResult,
  FileContent,
  ListOptions,
  ReadOptions,
  StorageResponse
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
      const hostname = url.hostname;

      // 如果hostname已经包含bucket名称（虚拟主机格式），直接使用hostname
      if (hostname.startsWith(`${this.connection.bucket}.`)) {
        return hostname;
      }

      // 否则添加bucket前缀
      return `${this.connection.bucket}.${hostname}`;
    } catch {
      return `${this.connection.bucket} (OSS)`;
    }
  }

  /**
   * 根据连接配置生成连接名称
   */
  generateConnectionName(config: ConnectionConfig): string {
    try {
      const url = config.url;

      if (!url) {
        return 'OSS';
      }

      // 处理 oss:// 协议
      if (url.startsWith('oss://')) {
        const ossUrl = url.replace('oss://', '');
        const [host, bucket] = ossUrl.split('/');

        if (bucket && host) {
          // 提取顶级域名 (最后两部分: domain.com)
          const hostParts = host.split('.');
          const topLevelDomain = hostParts.slice(-2).join('.');
          return `OSS(${bucket}-${topLevelDomain})`;
        } else {
          return `OSS(${host})`;
        }
      }

      // 处理 HTTPS 格式的 OSS 端点
      const urlObj = new URL(url);
      const hostname = urlObj.hostname;

      // 检测 OSS 服务 (格式如: bucket.oss-region.domain.com 或 bucket.s3.region.amazonaws.com)
      if (hostname.includes('.oss') || hostname.includes('.s3.')) {
        // 尝试提取bucket名称和顶级域名
        const parts = hostname.split('.');

        if (parts.length >= 3) {
          const bucket = parts[0]; // 第一部分通常是bucket名称

          // 提取顶级域名 (最后两部分: domain.com)
          const topLevelDomain = parts.slice(-2).join('.');

          // 检查是否为有效的bucket格式 (bucket.service.*)
          if (parts[1].includes('oss') || parts[1].includes('s3')) {
            return `OSS(${bucket}-${topLevelDomain})`;
          }
        }

        // 如果无法解析bucket，使用简化格式
        const topLevelDomain = hostname.split('.').slice(-2).join('.');
        return `OSS(${topLevelDomain})`;
      }

      // 默认格式
      return `OSS(${hostname})`;
    } catch (error) {
      return 'OSS';
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
        // 如果已经是HTTP(S)格式，需要区分虚拟主机和路径格式
        if (!endpoint || !bucket) {
          try {
            const url = new URL(rawUrl);
            const hostname = url.hostname;
            const pathname = url.pathname;

            if (hostname.includes('.oss-')) {
              // 虚拟主机格式：bucket.oss-region.aliyuncs.com
              if (!endpoint) {
                endpoint = `${url.protocol}//${hostname}`;
              }
              if (!bucket) {
                const parts = hostname.split('.');
                bucket = parts[0];
              }

              // 从hostname推断region（如果没有配置）
              if (!config.region) {
                const regionMatch = hostname.match(/oss-([^.]+)/);
                region = regionMatch ? regionMatch[1] : 'cn-hangzhou';
              }
            } else if (hostname.startsWith('oss-') || hostname.includes('aliyuncs.com')) {
              // 路径格式：oss-region.aliyuncs.com/bucket/object-key
              if (!endpoint) {
                endpoint = `${url.protocol}//${hostname}`;
              }

              if (!bucket && pathname && pathname.length > 1) {
                // 从路径中提取bucket名称（第一个路径段）
                const pathParts = pathname.split('/').filter(part => part.length > 0);
                if (pathParts.length > 0) {
                  bucket = pathParts[0];
                }
              }

              // 从hostname推断region（如果没有配置）
              if (!config.region && hostname.includes('oss-')) {
                const regionMatch = hostname.match(/oss-([^.]+)/);
                region = regionMatch ? regionMatch[1] : 'cn-hangzhou';
              }
            } else {
              // 其他格式，直接使用原URL作为endpoint
              if (!endpoint) {
                endpoint = rawUrl;
              }
            }
          } catch {
            // 解析失败，使用原URL作为endpoint
            if (!endpoint) {
              endpoint = rawUrl;
            }
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
      // 使用基类的通用连接方法
      const success = await this.connectToBackend({
        protocol: 'oss',
        url: normalizedEndpoint,
        accessKey: accessKey,
        secretKey: secretKey,
        bucket: bucket,
        region: region,
        username: null,
        password: null,
        extraOptions: null,
      });

      if (success) {
        this.connection = {
          endpoint: normalizedEndpoint,
          accessKey,
          secretKey,
          bucket,
          region,
          connected: true,
        };

        return true;
      }

      return false;
    } catch (error) {
      console.error('OSS connection failed:', error);
      throw new Error(`OSS connection failed: ${error}`);
    }
  }

  disconnect(): void {
    // 使用基类的通用断开连接方法
    this.disconnectFromBackend();
    this.connection = null;
  }

  async listDirectory(path: string, options: ListOptions = {}): Promise<DirectoryResult> {
    if (!this.connection) {
      throw new Error('Not connected to OSS');
    }

    // 使用统一的路径转换方法
    const objectKeyPrefix = this.getObjectKey(path);

    try {
      // 直接调用后端的 list_directory 方法，而不是通用的 request 方法
      const result = await invoke('storage_list_directory', {
        path: objectKeyPrefix,
        options: {
          page_size: options.pageSize || 1000,
          marker: options.marker,
          // 只有用户明确指定prefix时才使用，否则让后端根据path自动处理
          prefix: options.prefix,
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

      // 使用统一的协议URL格式
      const response = await invoke<StorageResponse>('storage_request', {
        protocol: this.protocol,
        method: 'GET',
        url: this.toProtocolUrl(path),
        headers,
        body: undefined,
        options: undefined
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

    try {
      const response = await invoke<StorageResponse>('storage_request', {
        protocol: this.protocol,
        method: 'HEAD',
        url: this.toProtocolUrl(path),
        headers: this.getAuthHeaders(),
        body: undefined,
        options: undefined
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

    try {
      const response = await invoke<number[]>('storage_request_binary', {
        protocol: this.protocol,
        method: 'GET',
        url: this.toProtocolUrl(path),
        headers: this.getAuthHeaders(),
        options: undefined
      });

      // 直接使用返回的二进制数据创建 Blob
      const uint8Array = new Uint8Array(response);
      return new Blob([uint8Array]);
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

    try {
      return await this.downloadWithProgress(
        'GET',
        this.toProtocolUrl(path),
        filename,
        this.getAuthHeaders()
      );
    } catch (error) {
      console.error('Failed to download OSS file with progress:', error);
      throw new Error(`Failed to download file: ${error}`);
    }
  }

  /**
   * 将前端路径转换为协议统一的地址格式
   * OSS 协议格式：oss://bucket/path/to/file
   */
  toProtocolUrl(path: string): string {
    if (!this.connection) {
      throw new Error('Not connected to OSS');
    }

    const objectKey = this.getObjectKey(path);

    // 构建标准的 OSS URL 格式：oss://bucket/path/to/file
    if (objectKey) {
      return `oss://${this.connection.bucket}/${objectKey}`;
    } else {
      return `oss://${this.connection.bucket}`;
    }
  }

  /**
   * 提取对象键（移除开头斜杠，清理重复斜杠）
   */
  private getObjectKey(path: string): string {
    return path.replace(/^\/+/, '').replace(/\/+/g, '/');
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
      console.log('OSS使用统一流式分析:', { originalPath: path, filename });

      // 直接传递path，因为它已经是协议URL格式
      const result = await this.analyzeArchiveWithClient(path, filename, maxSize);

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
      console.log('OSS获取压缩文件预览（流式）:', {
        originalPath: path,
        filename,
        entryPath
      });

      // 直接传递path，因为它已经是协议URL格式
      return await this.getArchiveFilePreviewWithClient(
        path,
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
  protected normalizePath(path: string): string {
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

    // 如果路径是完整的 HTTPS OSS URL，提取对象键部分
    if (path.startsWith('http')) {
      try {
        const url = new URL(path);
        const hostname = url.hostname;
        const pathname = url.pathname;

        // 检查是否为OSS URL
        if (hostname.includes('oss-') || hostname.includes('aliyuncs.com')) {
          if (hostname.includes('.oss-')) {
            // 虚拟主机格式：bucket.oss-region.aliyuncs.com/object-key
            return pathname.replace(/^\/+/, ''); // 直接使用pathname作为object key
          } else if (hostname.startsWith('oss-') || hostname.includes('aliyuncs.com')) {
            // 路径格式：oss-region.aliyuncs.com/bucket/object-key
            const pathParts = pathname.split('/').filter(part => part.length > 0);
            if (pathParts.length > 1) {
              // 跳过bucket（第一个部分），获取object key
              return pathParts.slice(1).join('/');
            }
          }
        }
      } catch (error) {
        console.warn('Failed to parse HTTPS OSS URL:', path, error);
      }
    }

    // 移除开头的斜杠，OSS 对象键不应该以斜杠开头
    return path.replace(/^\/+/, '');
  }

}
