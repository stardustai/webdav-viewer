import { BaseStorageClient } from './BaseStorageClient';
import { WebDAVStorageClient } from './WebDAVStorageClient';
import { LocalStorageClient } from './LocalStorageClient';
import { OSSStorageClient } from './OSSStorageClient';
import { ConnectionConfig, StorageClientType } from './types';
import { connectionStorage } from '../connectionStorage';

/**
 * 存储客户端工厂
 * 负责创建和管理不同类型的存储客户端实例
 */
export class StorageClientFactory {
  private static instances: Map<string, BaseStorageClient> = new Map();

  /**
   * 创建存储客户端实例
   */
  static createClient(type: StorageClientType): BaseStorageClient {
    switch (type) {
      case 'webdav':
        return new WebDAVStorageClient();
      case 'local':
        return new LocalStorageClient();
      case 'oss':
        return new OSSStorageClient();
      default:
        throw new Error(`Unsupported storage type: ${type}`);
    }
  }

  /**
   * 获取或创建存储客户端实例（单例模式）
   */
  static getInstance(type: StorageClientType, key?: string): BaseStorageClient {
    const instanceKey = key || type;

    if (!this.instances.has(instanceKey)) {
      this.instances.set(instanceKey, this.createClient(type));
    }

    return this.instances.get(instanceKey)!;
  }

  /**
   * 连接到存储服务
   */
  static async connectToStorage(config: ConnectionConfig, key?: string): Promise<BaseStorageClient> {
    const client = this.getInstance(config.type, key);
    const connected = await client.connect(config);

    if (!connected) {
      throw new Error(`Failed to connect to ${config.type} storage`);
    }

    return client;
  }

  /**
   * 断开连接并清理实例
   */
  static disconnect(key?: string): void {
    if (key) {
      const client = this.instances.get(key);
      if (client) {
        client.disconnect();
        this.instances.delete(key);
      }
    } else {
      // 断开所有连接
      this.instances.forEach(client => client.disconnect());
      this.instances.clear();
    }
  }

  /**
   * 获取所有活跃的连接
   */
  static getActiveConnections(): Array<{ key: string; client: BaseStorageClient }> {
    return Array.from(this.instances.entries())
      .filter(([_, client]) => client.isConnected())
      .map(([key, client]) => ({ key, client }));
  }

  /**
   * 检查是否支持指定的存储类型
   */
  static isSupportedType(type: string): type is StorageClientType {
    return ['webdav', 'local', 'oss'].includes(type);
  }
}

/**
 * 统一存储服务管理器
 * 提供高级存储操作和缓存管理
 */
export class StorageServiceManager {
  private static currentClient: BaseStorageClient | null = null;
  private static currentConnection: ConnectionConfig | null = null;

  /**
   * 设置当前活跃的存储客户端
   */
  static async setCurrentStorage(config: ConnectionConfig): Promise<void> {
    // 断开现有连接
    if (this.currentClient) {
      this.currentClient.disconnect();
      this.currentClient = null;
      this.currentConnection = null;
    }

    // 如果切换到不同类型的存储，清理对应的单例实例
    if (this.currentConnection && this.currentConnection.type !== config.type) {
      StorageClientFactory.disconnect(this.currentConnection.type);
    }

    // 连接新的存储
    this.currentClient = await StorageClientFactory.connectToStorage(config);
    this.currentConnection = config;
  }

  /**
   * 获取当前连接的显示名称
   */
  static getConnectionDisplayName(): string {
    if (!this.currentClient) {
      return 'Unknown';
    }
    return this.currentClient.getDisplayName();
  }

  /**
   * 获取当前存储客户端
   */
  static getCurrentClient(): BaseStorageClient {
    if (!this.currentClient) {
      throw new Error('No storage client connected');
    }
    return this.currentClient;
  }

  /**
   * 获取当前连接配置
   */
  static getCurrentConnection(): ConnectionConfig {
    if (!this.currentConnection) {
      throw new Error('No storage connection active');
    }
    return this.currentConnection;
  }

  /**
   * 检查是否已连接
   */
  static isConnected(): boolean {
    return this.currentClient?.isConnected() || false;
  }

  /**
   * 断开当前连接
   */
  static disconnect(): void {
    if (this.currentClient) {
      this.currentClient.disconnect();
      this.currentClient = null;
      this.currentConnection = null;
    }
  }

  /**
   * 切换存储类型（如从 WebDAV 切换到 OSS）
   */
  static async switchStorage(config: ConnectionConfig): Promise<void> {
    const previousType = this.currentConnection?.type;

    try {
      await this.setCurrentStorage(config);
      console.log(`Switched from ${previousType || 'none'} to ${config.type}`);
    } catch (error) {
      console.error(`Failed to switch to ${config.type}:`, error);
      throw error;
    }
  }

  /**
   * 获取存储类型特定的功能信息
   */
  static getStorageCapabilities(): {
    type: StorageClientType;
    supportsPagination: boolean;
    supportsRangeRequests: boolean;
    supportsSearch: boolean;
  } {
    if (!this.currentClient || !this.currentConnection) {
      throw new Error('No storage connection active');
    }

    // 根据存储类型返回不同的功能集
    switch (this.currentConnection.type) {
      case 'webdav':
        return {
          type: 'webdav',
          supportsPagination: false, // WebDAV 不原生支持分页
          supportsRangeRequests: true,
          supportsSearch: false, // 大多数 WebDAV 服务器不支持搜索
        };
      case 'local':
        return {
          type: 'local',
          supportsPagination: false, // 本机文件系统不需要分页
          supportsRangeRequests: true,
          supportsSearch: true, // 本机文件系统支持文件名搜索
        };
      default:
        throw new Error(`Unknown storage type: ${this.currentConnection.type}`);
    }
  }

  // ========== WebDAV 兼容方法 ==========

  /**
   * WebDAV 兼容：连接方法
   */
  static async connect(
    url: string,
    username: string,
    password: string,
    saveConnection: boolean = true,
    connectionName?: string,
    savePassword: boolean = false
  ): Promise<boolean> {
    try {
      const config: ConnectionConfig = {
        type: 'webdav',
        url,
        username,
        password,
        name: connectionName || `WebDAV(${new URL(url).hostname})`
      };

      await this.setCurrentStorage(config);

      // 保存连接信息
      if (saveConnection) {
        const existingConnection = connectionStorage.findConnection(url, username);
        if (existingConnection) {
          connectionStorage.updateLastConnected(existingConnection.id);
          if (savePassword) {
            connectionStorage.updatePassword(existingConnection.id, password);
          }
        } else {
          const connection = { url, username, password, connected: true };
          connectionStorage.saveConnection(connection, connectionName, savePassword);
        }
      }

      return true;
    } catch (error) {
      console.error('Connection failed:', error);
      return false;
    }
  }

  /**
   * WebDAV 兼容：自动连接
   */
  static async autoConnect(): Promise<boolean> {
    const defaultConnection = connectionStorage.getDefaultConnection();
    if (!defaultConnection) return false;

    try {
      // 根据连接类型进行不同的处理
      if (defaultConnection.url.startsWith('local://')) {
        // 本地文件系统连接
        const rootPath = defaultConnection.url.replace('local://', '');
        return await this.connectToLocal(rootPath, false, defaultConnection.name);
      } else if (defaultConnection.url.startsWith('oss://')) {
        // OSS 连接
        const ossUrl = defaultConnection.url.replace('oss://', '');
        const [host, bucket] = ossUrl.split('/');

        // 从存储的连接中获取访问密钥信息
        // 注意：OSS 连接的 username 是 accessKey，password 是 secretKey
        const config: ConnectionConfig = {
          type: 'oss',
          url: `https://${host}`, // OSS endpoint
          username: defaultConnection.username, // accessKey
          password: defaultConnection.password || '', // secretKey
          bucket: bucket || '', // bucket name
          region: '', // 可以从 host 中解析或设为空
          name: defaultConnection.name
        };

        await this.setCurrentStorage(config);
        return true;
      } else {
        // WebDAV 连接
        return await this.connect(
          defaultConnection.url,
          defaultConnection.username,
          defaultConnection.password || '',
          false // 不重复保存连接
        );
      }
    } catch (error) {
      console.warn('Auto connect failed:', error);
      return false;
    }
  }

  /**
   * WebDAV 兼容：列出目录
   */
  static async listDirectory(path: string = '') {
    const client = this.getCurrentClient();
    const result = await client.listDirectory(path);

    // 转换为原有的格式
    return result.files.map(file => ({
      filename: file.filename,
      basename: file.basename,
      lastmod: file.lastmod,
      size: file.size,
      type: file.type,
      mime: file.mime || '',
      etag: file.etag || ''
    }));
  }

  /**
   * WebDAV 兼容：获取文件内容
   */
  static async getFileContent(path: string, start?: number, length?: number) {
    const client = this.getCurrentClient();
    const options = start !== undefined && length !== undefined ? { start, length } : undefined;
    return await client.getFileContent(path, options);
  }

  /**
   * WebDAV 兼容：获取文件大小
   */
  static async getFileSize(path: string): Promise<number> {
    const client = this.getCurrentClient();
    return await client.getFileSize(path);
  }

  /**
   * WebDAV 兼容：下载文件
   */
  static async downloadFile(path: string): Promise<Blob> {
    const client = this.getCurrentClient();
    return await client.downloadFile(path);
  }

  /**
   * WebDAV 兼容：带进度下载文件
   */
  static async downloadFileWithProgress(path: string, filename: string): Promise<string> {
    const client = this.getCurrentClient();
    if (client.downloadFileWithProgress) {
      return await client.downloadFileWithProgress(path, filename);
    } else {
      throw new Error('Download with progress not supported');
    }
  }

  /**
   * WebDAV 兼容：获取文件二进制数据
   */
  static async getFileBlob(path: string): Promise<ArrayBuffer> {
    const blob = await this.downloadFile(path);
    return await blob.arrayBuffer();
  }

  /**
   * WebDAV 兼容：获取文件URL
   */
  static getFileUrl(path: string): string {
    const connection = this.getCurrentConnection();
    if (!connection || !connection.url) throw new Error('Not connected');

    // 处理本地文件系统
    if (connection.url.startsWith('local://')) {
      // 对于本地文件，通过 client 获取实际文件路径
      const client = this.getCurrentClient();
      if (client instanceof LocalStorageClient) {
        return client.getActualFilePath(path);
      }
      // 降级处理：构建文件系统路径
      const rootPath = connection.url.replace('local://', '');
      const cleanPath = path.replace(/^\/+/, '').replace(/\/+/g, '/');

      if (!cleanPath) {
        return rootPath;
      }

      const separator = rootPath.endsWith('/') || rootPath.endsWith('\\') ? '' : '/';
      return `${rootPath}${separator}${cleanPath}`;
    }

    // WebDAV URL 处理
    const baseUrl = connection.url.replace(/\/$/, '');
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    return `${baseUrl}${normalizedPath}`;
  }

  /**
   * WebDAV 兼容：获取请求headers
   */
  static getHeaders(): Record<string, string> {
    const connection = this.getCurrentConnection();
    if (!connection || !connection.username || !connection.password) return {};

    return {
      'Authorization': `Basic ${btoa(`${connection.username}:${connection.password}`)}`
    };
  }

  /**
   * WebDAV 兼容：获取连接信息
   */
  static getConnection() {
    try {
      const config = this.getCurrentConnection();
      return {
        url: config.url!,
        username: config.username!,
        password: config.password!,
        connected: true
      };
    } catch {
      return null;
    }
  }

  // 连接管理便捷方法
  static getStoredConnections() {
    return connectionStorage.getStoredConnections();
  }

  static getDefaultConnection() {
    return connectionStorage.getDefaultConnection();
  }

  static deleteConnection(id: string) {
    connectionStorage.deleteConnection(id);
  }

  static deleteStoredConnection(id: string) {
    connectionStorage.deleteConnection(id);
  }

  static renameStoredConnection(id: string, newName: string) {
    connectionStorage.renameConnection(id, newName);
  }

  static setDefaultConnection(id: string) {
    connectionStorage.setDefaultConnection(id);
  }

  // ========== 本机文件系统连接方法 ==========

  /**
   * 连接到本机文件系统
   */
  static async connectToLocal(
    rootPath: string,
    saveConnection: boolean = true,
    connectionName?: string
  ): Promise<boolean> {
    try {
      console.log('StorageServiceManager: Connecting to local storage:', rootPath);

      const config: ConnectionConfig = {
        type: 'local',
        url: rootPath, // 使用 url 字段传递根路径
        rootPath, // 保留 rootPath 字段用于前端显示
        name: connectionName || `Local Files(${rootPath})`
      };

      console.log('StorageServiceManager: Using config:', config);
      await this.setCurrentStorage(config);
      console.log('StorageServiceManager: Successfully connected to local storage');

      // 保存连接信息（如果需要）
      if (saveConnection) {
        // 为本机文件系统创建特殊的连接记录
        // 对于本地路径，使用 local:// 协议而不是 file://，避免 URL 解析问题
        const connection = {
          url: `local://${rootPath}`,
          username: 'local',
          password: '',
          connected: true
        };
        connectionStorage.saveConnection(connection, config.name, false);
      }

      return true;
    } catch (error) {
      console.error('Local storage connection failed:', error);
      return false;
    }
  }

  // ========== OSS 连接方法 ==========

  /**
   * 连接到 OSS 对象存储
   */
  static async connectToOSS(config: ConnectionConfig): Promise<boolean> {
    try {
      console.log('StorageServiceManager: Connecting to OSS storage');

      // 验证配置
      if (!config.url || !config.username || !config.password) {
        throw new Error('OSS connection requires endpoint, access key, and secret key');
      }

      await this.setCurrentStorage(config);
      console.log('StorageServiceManager: Successfully connected to OSS storage');

      // 保存连接信息 - 使用 oss:// 协议格式
      try {
        const endpointUrl = new URL(config.url);
        const ossUrl = `oss://${endpointUrl.hostname}${config.bucket ? '/' + config.bucket : ''}`;

        const connection = {
          url: ossUrl, // 使用 oss:// 协议格式
          username: config.username,
          password: config.password,
          connected: true
        };
        connectionStorage.saveConnection(connection, config.name || 'OSS(Unknown)', true);
      } catch (urlError) {
        // 如果 URL 解析失败，使用备选格式
        const ossUrl = `oss://${config.url.replace(/^https?:\/\//, '')}${config.bucket ? '/' + config.bucket : ''}`;
        const connection = {
          url: ossUrl,
          username: config.username,
          password: config.password,
          connected: true
        };
        connectionStorage.saveConnection(connection, config.name || 'OSS(Unknown)', true);
      }

      return true;
    } catch (error) {
      console.error('OSS storage connection failed:', error);
      return false;
    }
  }
}
