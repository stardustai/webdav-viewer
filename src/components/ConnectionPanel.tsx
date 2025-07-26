import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { User, Lock } from 'lucide-react';
import { StorageServiceManager } from '../services/storage';
import { StorageClientType, ConnectionConfig } from '../services/storage/types';
import { LanguageSwitcher } from './LanguageSwitcher';
import { ConnectionSelector } from './ConnectionSelector';
import { StorageTypeSelector } from './StorageTypeSelector';
import { LocalConnectionForm } from './LocalConnectionForm';
import { OSSConnectionForm } from './OSSConnectionForm';
import { StoredConnection } from '../services/connectionStorage';

interface ConnectionPanelProps {
  onConnect: () => void;
}

export const ConnectionPanel: React.FC<ConnectionPanelProps> = ({ onConnect }) => {
  const { t } = useTranslation();

  // 存储类型选择
  const [storageType, setStorageType] = useState<StorageClientType>('webdav');

  // WebDAV 连接状态
  const [url, setUrl] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState('');
  const [selectedStoredConnection, setSelectedStoredConnection] = useState<StoredConnection | null>(null);
  const [isPasswordFromStorage, setIsPasswordFromStorage] = useState(false); // 密码是否来自存储
  const savePassword = true; // 默认保存密码

  // 本地文件系统连接状态
  const [defaultLocalPath, setDefaultLocalPath] = useState('');

  // 获取最近的本地连接路径
  const getRecentLocalPath = () => {
    const connections = StorageServiceManager.getStoredConnections();
    const localConnections = connections.filter(conn => conn.url.startsWith('local://'));

    if (localConnections.length > 0) {
      // 按最后连接时间排序，获取最近的连接
      const sorted = localConnections.sort((a, b) => {
        const aTime = new Date(a.lastConnected || 0).getTime();
        const bTime = new Date(b.lastConnected || 0).getTime();
        return bTime - aTime;
      });

      return sorted[0].url.replace('local://', '');
    }

    return '';
  };

  useEffect(() => {
    // 检查用户是否主动断开了连接
    const wasDisconnected = localStorage.getItem('userDisconnected') === 'true';

    // 只有在用户没有主动断开连接的情况下才自动加载默认连接
    if (!wasDisconnected) {
      const defaultConnection = StorageServiceManager.getDefaultConnection();
      if (defaultConnection) {
        // 根据连接类型设置存储类型
        if (defaultConnection.url.startsWith('local://')) {
          setStorageType('local');
          // 提取本地路径（移除 local:// 前缀）
          const localPath = defaultConnection.url.replace('local://', '');
          setDefaultLocalPath(localPath);
        } else if (defaultConnection.url.startsWith('oss://')) {
          setStorageType('oss');
          handleSelectStoredConnection(defaultConnection);
        } else {
          setStorageType('webdav');
          handleSelectStoredConnection(defaultConnection);
        }
      }
    }

    // 清除断开连接标记，因为用户现在在连接页面
    localStorage.removeItem('userDisconnected');
  }, []);

  const handleSelectStoredConnection = (connection: StoredConnection) => {
    setSelectedStoredConnection(connection);
    setError(''); // 清除之前的错误

    // 根据连接类型切换存储类型
    if (connection.url.startsWith('local://')) {
      setStorageType('local');
      // 提取本地路径（移除 local:// 前缀）
      const localPath = connection.url.replace('local://', '');
      setDefaultLocalPath(localPath);
    } else if (connection.url.startsWith('oss://')) {
      setStorageType('oss');
      // OSS 连接的处理将在 OSSConnectionForm 中进行
    } else {
      // WebDAV 连接
      setStorageType('webdav');
      setUrl(connection.url);
      setUsername(connection.username);
      if (connection.password) {
        setPassword('••••••••'); // 显示占位符而不是真实密码
        setIsPasswordFromStorage(true);
      } else {
        setPassword('');
        setIsPasswordFromStorage(false);
      }
    }
  };

  const handleConnect = async (e: React.FormEvent) => {
    e.preventDefault();
    setConnecting(true);
    setError('');

    try {
      if (storageType === 'webdav') {
        // WebDAV 连接逻辑
        const connectionName = selectedStoredConnection ?
          selectedStoredConnection.name :
          t('connection.name.webdav', 'WebDAV({{host}})', { host: new URL(url).hostname });

        // 如果密码来自存储，使用存储的真实密码；否则使用输入的密码
        const actualPassword = isPasswordFromStorage && selectedStoredConnection?.password
          ? selectedStoredConnection.password
          : password;

        // 默认保存连接，如果勾选了保存密码则同时保存密码
        const success = await StorageServiceManager.connect(url, username, actualPassword, true, connectionName, savePassword);
        if (success) {
          // 如果是从存储的连接连接成功，设置为默认连接
          if (selectedStoredConnection) {
            StorageServiceManager.setDefaultConnection(selectedStoredConnection.id);
          }
          onConnect();
        } else {
          setError(t('error.credentials'));
        }
      }
    } catch (err) {
      setError(t('error.connection.failed'));
    } finally {
      setConnecting(false);
    }
  };

  const handleLocalConnect = async (rootPath: string) => {
    setConnecting(true);
    setError('');

    try {
      // 先断开任何现有连接
      if (StorageServiceManager.isConnected()) {
        StorageServiceManager.disconnect();
      }

      // 对于本机文件系统，直接使用用户输入的路径
      // 路径展开应该在后端处理
      const success = await StorageServiceManager.connectToLocal(
        rootPath,
        true,
        t('connection.name.local', '本机文件({{path}})', { path: rootPath })
      );

      if (success) {
        // 本地连接成功后，查找并设置为默认连接
        const connections = StorageServiceManager.getStoredConnections();
        const localConnection = connections.find(conn =>
          conn.url.startsWith('local://') && conn.url.includes(rootPath)
        );
        if (localConnection) {
          StorageServiceManager.setDefaultConnection(localConnection.id);
        }
        onConnect();
      } else {
        setError(t('local.error.access', '无法访问指定路径，请检查路径是否存在且有权限访问'));
      }
    } catch (err) {
      console.error('Local connection error:', err);
      setError(t('local.error.connection', '连接本机文件系统失败'));
    } finally {
      setConnecting(false);
    }
  };

  const handleOSSConnect = async (config: ConnectionConfig) => {
    setConnecting(true);
    setError('');

    try {
      // 断开任何现有连接
      if (StorageServiceManager.isConnected()) {
        StorageServiceManager.disconnect();
      }

      // 使用 StorageServiceManager 连接到 OSS
      const success = await StorageServiceManager.connectToOSS(config);

      if (success) {
        // OSS 连接成功后，查找并设置为默认连接
        // 需要根据 oss:// 格式的 URL 来查找连接
        const connections = StorageServiceManager.getStoredConnections();
        const ossConnection = connections.find(conn =>
          conn.url.startsWith('oss://') && conn.username === config.username
        );
        if (ossConnection) {
          StorageServiceManager.setDefaultConnection(ossConnection.id);
        }
        onConnect();
      } else {
        setError(t('error.oss.connection.failed', 'OSS 连接失败'));
      }
    } catch (err) {
      console.error('OSS connection error:', err);
      setError(err instanceof Error ? err.message : t('error.connection.failed'));
    } finally {
      setConnecting(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 dark:from-gray-900 dark:to-gray-800 flex items-center justify-center p-4">
      {/* 语言切换器和主题切换器 - 右上角 */}
      <div className="absolute top-4 right-4 flex items-center space-x-3">
        <LanguageSwitcher />
      </div>

      <div className="w-full max-w-md lg:max-w-lg">
        {/* 连接表单 */}
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl p-6 w-full">
          <div className="text-center mb-6">
            <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100 mb-1">{t('webdav.browser')}</h1>
            <p className="text-sm text-gray-600 dark:text-gray-300">{t('connect.storage')}</p>
          </div>

          <div className="space-y-4">
            {/* 已保存的连接 - 独立于存储类型 */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                {t('saved.connections')}
              </label>
              <ConnectionSelector
                onSelect={handleSelectStoredConnection}
                selectedConnection={selectedStoredConnection}
              />
            </div>

            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-gray-300 dark:border-gray-600" />
              </div>
              <div className="relative flex justify-center text-sm">
                <span className="bg-white dark:bg-gray-800 px-2 text-gray-500 dark:text-gray-400">{t('or.new.connection')}</span>
              </div>
            </div>

            {/* 存储类型选择器 */}
            <StorageTypeSelector
              selectedType={storageType}
              onTypeChange={(type) => {
                setStorageType(type);
                setError(''); // 清除错误
                // 切换类型时重置表单
                if (type === 'webdav') {
                  // 切换到 WebDAV 时保持选中的连接（如果是 WebDAV 类型）
                  if (selectedStoredConnection && !selectedStoredConnection.url.startsWith('local://') && !selectedStoredConnection.url.startsWith('oss://')) {
                    // 保持 WebDAV 连接选择
                  } else {
                    setSelectedStoredConnection(null);
                    setUrl('');
                    setUsername('');
                    setPassword('');
                    setIsPasswordFromStorage(false);
                  }
                } else if (type === 'local') {
                  // 切换到本地存储时
                  if (selectedStoredConnection && selectedStoredConnection.url.startsWith('local://')) {
                    // 保持本地连接选择
                    const localPath = selectedStoredConnection.url.replace('local://', '');
                    setDefaultLocalPath(localPath);
                  } else {
                    setSelectedStoredConnection(null);
                    // 尝试填充最近使用的路径
                    if (!defaultLocalPath) {
                      const recentPath = getRecentLocalPath();
                      if (recentPath) {
                        setDefaultLocalPath(recentPath);
                      }
                    }
                  }
                } else if (type === 'oss') {
                  // 切换到 OSS 时
                  if (!selectedStoredConnection || !selectedStoredConnection.url.startsWith('oss://')) {
                    setSelectedStoredConnection(null);
                  }
                  // OSS 表单会根据 selectedStoredConnection 自动填充
                }

                // 清除非当前类型的表单状态
                if (type !== 'webdav') {
                  setUrl('');
                  setUsername('');
                  setPassword('');
                  setIsPasswordFromStorage(false);
                }
              }}
            />

            {storageType === 'webdav' ? (
              // WebDAV 连接表单
              <form onSubmit={handleConnect} className="space-y-4">

                <div>
                  <label htmlFor="url" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    {t('server.url')}
                  </label>
                  <input
                    id="url"
                    type="url"
                    value={url}
                    onChange={(e) => {
                      setUrl(e.target.value);
                      setSelectedStoredConnection(null); // 清除选中的连接
                      if (isPasswordFromStorage) {
                        setPassword(''); // 如果之前是存储的密码，清除它
                        setIsPasswordFromStorage(false);
                      }
                    }}
                    placeholder={t('server.url.placeholder')}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-500 dark:placeholder-gray-400 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                    required
                  />
                </div>

                <div>
                  <label htmlFor="username" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    {t('username')}
                  </label>
                  <div className="relative">
                    <User className="absolute left-3 top-2.5 w-4 h-4 text-gray-400 dark:text-gray-500" />
                    <input
                      id="username"
                      type="text"
                      value={username}
                      onChange={(e) => {
                        setUsername(e.target.value);
                        setSelectedStoredConnection(null); // 清除选中的连接
                        if (isPasswordFromStorage) {
                          setPassword(''); // 如果之前是存储的密码，清除它
                          setIsPasswordFromStorage(false);
                        }
                      }}
                      placeholder={t('username.placeholder')}
                      className="w-full pl-10 pr-3 py-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-500 dark:placeholder-gray-400 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                      required
                    />
                  </div>
                </div>

                <div>
                  <label htmlFor="password" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    {t('password')}
                    {isPasswordFromStorage && (
                      <span className="text-xs text-gray-500 dark:text-gray-400 ml-2">({t('password.saved', '使用已保存的密码')})</span>
                    )}
                  </label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-2.5 w-4 h-4 text-gray-400 dark:text-gray-500" />
                    <input
                      id="password"
                      type="password"
                      value={password}
                      onChange={(e) => {
                        if (!isPasswordFromStorage) {
                          setPassword(e.target.value);
                        }
                      }}
                      onFocus={() => {
                        if (isPasswordFromStorage) {
                          // 如果点击已保存的密码字段，清除并允许输入新密码
                          setPassword('');
                          setIsPasswordFromStorage(false);
                        }
                      }}
                      placeholder={isPasswordFromStorage ? t('password.click.new', '点击输入新密码') : t('password.placeholder')}
                      className={`w-full pl-10 pr-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent ${
                        isPasswordFromStorage
                          ? 'bg-gray-50 dark:bg-gray-600 text-gray-600 dark:text-gray-300'
                          : 'bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100'
                      } placeholder-gray-500 dark:placeholder-gray-400`}
                      required
                    />
                  </div>
                </div>

                {error && (
                  <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
                    <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={connecting}
                  className="w-full bg-indigo-600 text-white py-2 px-4 rounded-lg hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {connecting ? t('connecting') : t('connect')}
                </button>
              </form>
            ) : storageType === 'local' ? (
              // 本机文件系统连接表单
              <LocalConnectionForm
                onConnect={handleLocalConnect}
                connecting={connecting}
                error={error}
                defaultPath={selectedStoredConnection?.url.startsWith('local://')
                  ? selectedStoredConnection.url.replace('local://', '')
                  : defaultLocalPath}
              />
            ) : storageType === 'oss' ? (
              // OSS 连接表单
              <OSSConnectionForm
                onConnect={handleOSSConnect}
                connecting={connecting}
                error={error}
                selectedConnection={selectedStoredConnection}
              />
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
};
