import React from 'react';
import { useTranslation } from 'react-i18next';
import { Server, Folder, Cloud } from 'lucide-react';
import { StorageClientType } from '../services/storage/types';

interface StorageTypeSelectorProps {
  selectedType: StorageClientType;
  onTypeChange: (type: StorageClientType) => void;
}

export const StorageTypeSelector: React.FC<StorageTypeSelectorProps> = ({
  selectedType,
  onTypeChange
}) => {
  const { t } = useTranslation();

  const storageTypes = [
    {
      type: 'webdav' as StorageClientType,
      label: t('storage.type.webdav', 'WebDAV'),
      icon: Server,
      description: t('storage.type.webdav.description', '连接到 WebDAV 服务器')
    },
    {
      type: 'local' as StorageClientType,
      label: t('storage.type.local', '本机文件'),
      icon: Folder,
      description: t('storage.type.local.description', '浏览本机文件系统')
    },
    {
      type: 'oss' as StorageClientType,
      label: t('storage.type.oss', 'OSS 存储'),
      icon: Cloud,
      description: t('storage.type.oss.description', '连接到对象存储服务')
    }
  ];

  return (
    <div className="space-y-2">
      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
        {t('storage.type.select', '选择存储类型')}
      </label>
      <div className="grid grid-cols-3 gap-2">
        {storageTypes.map(({ type, label, icon: Icon, description }) => (
          <button
            key={type}
            type="button"
            onClick={() => onTypeChange(type)}
            className={`relative p-3 border rounded-lg text-left transition-all hover:shadow-sm group ${
              selectedType === type
                ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-900/20 ring-1 ring-indigo-500'
                : 'border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 hover:border-gray-400 dark:hover:border-gray-500'
            }`}
            title={description}
          >
            <div className="flex items-center space-x-3">
              <div className={`p-1.5 rounded ${
                selectedType === type
                  ? 'bg-indigo-100 dark:bg-indigo-800/30'
                  : 'bg-gray-100 dark:bg-gray-600'
              }`}>
                <Icon className={`w-4 h-4 ${
                  selectedType === type
                    ? 'text-indigo-600 dark:text-indigo-400'
                    : 'text-gray-600 dark:text-gray-300'
                }`} />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className={`text-sm font-medium ${
                  selectedType === type
                    ? 'text-indigo-900 dark:text-indigo-100'
                    : 'text-gray-900 dark:text-gray-100'
                }`}>
                  {label}
                </h3>
                <p className={`text-xs mt-0.5 truncate ${
                  selectedType === type
                    ? 'text-indigo-700 dark:text-indigo-300'
                    : 'text-gray-600 dark:text-gray-400'
                }`}>
                  {description}
                </p>
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
};
