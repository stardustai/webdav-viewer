import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { ConnectionConfig } from '../services/storage/types';
import { StoredConnection } from '../services/connectionStorage';

interface OSSConnectionFormProps {
  onConnect: (config: ConnectionConfig) => Promise<void>;
  connecting: boolean;
  error?: string;
  selectedConnection?: StoredConnection | null;
}

/**
 * OSS 连接表单组件
 * 支持阿里云 OSS、AWS S3 等兼容的对象存储服务
 */
export const OSSConnectionForm: React.FC<OSSConnectionFormProps> = ({
  onConnect,
  connecting,
  error: externalError,
  selectedConnection
}) => {
  const { t } = useTranslation();
  const [config, setConfig] = useState({
    endpoint: '',
    accessKey: '',
    secretKey: '',
    bucket: '',
    region: '',
  });

  const [errors, setErrors] = useState<Record<string, string>>({});

  // 当选中连接变化时，更新表单
  useEffect(() => {
    if (selectedConnection && selectedConnection.url.startsWith('oss://')) {
      try {
        // 解析 OSS URL: oss://hostname/bucket
        const ossUrl = selectedConnection.url.replace('oss://', '');
        const [hostname, bucket] = ossUrl.split('/');

        // 从hostname推断region
        let region = '';
        if (hostname.includes('oss-')) {
          const regionMatch = hostname.match(/oss-([^.]+)/);
          region = regionMatch ? regionMatch[1] : '';
        }

        setConfig({
          endpoint: `https://${hostname}`,
          accessKey: selectedConnection.username,
          secretKey: selectedConnection.password ? '••••••••' : '',
          bucket: bucket || '',
          region: region,
        });
      } catch (error) {
        console.error('Failed to parse OSS connection:', error);
        // 如果解析失败，至少填充已知的字段
        setConfig({
          endpoint: selectedConnection.url.replace('oss://', 'https://'),
          accessKey: selectedConnection.username,
          secretKey: selectedConnection.password ? '••••••••' : '',
          bucket: '',
          region: '',
        });
      }
    } else if (!selectedConnection) {
      // 清空表单
      setConfig({
        endpoint: '',
        accessKey: '',
        secretKey: '',
        bucket: '',
        region: '',
      });
    }
  }, [selectedConnection]);

  const validateForm = () => {
    const newErrors: Record<string, string> = {};

    if (!config.endpoint.trim()) {
      newErrors.endpoint = t('error.endpoint.required');
    } else {
      try {
        new URL(config.endpoint);
      } catch {
        newErrors.endpoint = t('error.endpoint.invalid');
      }
    }

    if (!config.accessKey.trim()) {
      newErrors.accessKey = t('error.access.key.required');
    }

    if (!config.secretKey.trim()) {
      newErrors.secretKey = t('error.secret.key.required');
    }

    if (!config.bucket.trim()) {
      newErrors.bucket = t('error.bucket.required');
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!validateForm()) {
      return;
    }

    // 生成默认连接名称
    const hostname = new URL(config.endpoint).hostname;
    const defaultName = t('connection.name.oss', 'OSS({{host}}-{{bucket}})', {
      host: hostname,
      bucket: config.bucket
    });

    // 如果密码是占位符（来自已保存的连接），使用真实密码
    const actualSecretKey = config.secretKey === '••••••••' && selectedConnection?.password
      ? selectedConnection.password
      : config.secretKey;

    const connectionConfig: ConnectionConfig = {
      type: 'oss',
      name: selectedConnection?.name || defaultName,
      url: `oss://${new URL(config.endpoint).hostname}/${config.bucket}`, // 使用 oss:// 格式保存
      username: config.accessKey, // 使用 username 字段存储 accessKey
      password: actualSecretKey,  // 使用 password 字段存储 secretKey
      bucket: config.bucket,      // 添加 bucket 字段
      region: config.region || 'cn-hangzhou', // 添加 region 字段，有默认值
      endpoint: config.endpoint,  // 添加 endpoint 字段
    };

    try {
      await onConnect(connectionConfig);
    } catch (error) {
      // 错误由父组件处理，这里不需要设置本地错误状态
      console.error('OSS connection failed:', error);
    }
  };

  const handleInputChange = (field: string, value: string) => {
    setConfig(prev => ({ ...prev, [field]: value }));
    // 清除对应字段的错误
    if (errors[field]) {
      setErrors(prev => ({ ...prev, [field]: '' }));
    }
    // 如果用户修改了任何字段，清除选中的连接状态（除非是密码字段的特殊处理）
    if (selectedConnection && field !== 'secretKey') {
      // 不清除选中连接，但标记为已修改
    }
  };

  return (
    <>
      <form onSubmit={handleSubmit} className="space-y-6">
        {externalError && (
          <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-md p-3">
            <p className="text-sm text-red-600 dark:text-red-400">{externalError}</p>
          </div>
        )}

        <div>
          <label htmlFor="endpoint" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            {t('oss.endpoint')}
          </label>
          <input
            type="url"
            id="endpoint"
            value={config.endpoint}
            onChange={(e) => handleInputChange('endpoint', e.target.value)}
            className={`w-full px-3 py-2 border rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white ${
              errors.endpoint ? 'border-red-300 dark:border-red-600' : 'border-gray-300'
            }`}
            placeholder={t('oss.endpoint.placeholder')}
            disabled={connecting}
          />
          {errors.endpoint && (
            <p className="mt-1 text-sm text-red-600 dark:text-red-400">{errors.endpoint}</p>
          )}
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            {t('oss.endpoint.description')}
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label htmlFor="accessKey" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              {t('oss.access.key')}
            </label>
            <input
              type="text"
              id="accessKey"
              value={config.accessKey}
              onChange={(e) => handleInputChange('accessKey', e.target.value)}
              className={`w-full px-3 py-2 border rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white ${
                errors.accessKey ? 'border-red-300 dark:border-red-600' : 'border-gray-300'
              }`}
              placeholder={t('oss.access.key.placeholder')}
              disabled={connecting}
            />
            {errors.accessKey && (
              <p className="mt-1 text-sm text-red-600 dark:text-red-400">{errors.accessKey}</p>
            )}
          </div>

          <div>
            <label htmlFor="secretKey" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              {t('oss.secret.key')}
            </label>
            <input
              type="password"
              id="secretKey"
              value={config.secretKey}
              onChange={(e) => handleInputChange('secretKey', e.target.value)}
              className={`w-full px-3 py-2 border rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white ${
                errors.secretKey ? 'border-red-300 dark:border-red-600' : 'border-gray-300'
              }`}
              placeholder={t('oss.secret.key.placeholder')}
              disabled={connecting}
            />
            {errors.secretKey && (
              <p className="mt-1 text-sm text-red-600 dark:text-red-400">{errors.secretKey}</p>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label htmlFor="bucket" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              {t('oss.bucket')}
            </label>
            <input
              type="text"
              id="bucket"
              value={config.bucket}
              onChange={(e) => handleInputChange('bucket', e.target.value)}
              className={`w-full px-3 py-2 border rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white ${
                errors.bucket ? 'border-red-300 dark:border-red-600' : 'border-gray-300'
              }`}
              placeholder={t('oss.bucket.placeholder')}
              disabled={connecting}
            />
            {errors.bucket && (
              <p className="mt-1 text-sm text-red-600 dark:text-red-400">{errors.bucket}</p>
            )}
          </div>

          <div>
            <label htmlFor="region" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              {t('oss.region.optional')}
            </label>
            <input
              type="text"
              id="region"
              value={config.region}
              onChange={(e) => handleInputChange('region', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white"
              placeholder={t('oss.region.placeholder')}
              disabled={connecting}
            />
          </div>
        </div>

        <button
          type="submit"
          disabled={connecting}
          className="w-full bg-indigo-600 text-white py-2 px-4 rounded-lg hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center"
        >
          {connecting ? (
            <>
              <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
              {t('connecting')}
            </>
          ) : (
            t('connect')
          )}
        </button>
      </form>
    </>
  );
};
