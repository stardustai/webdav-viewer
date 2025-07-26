import React, { useState, useEffect } from 'react';
import { Archive, Search, Copy, AlertCircle, Folder } from 'lucide-react';
import { ArchiveInfo, ArchiveEntry, FilePreview } from '../types';
import { CompressionService } from '../services/compression';
import { copyToClipboard, showCopyToast } from '../utils/clipboard';

import { VirtualizedArchiveList } from './VirtualizedArchiveList';
import { LoadingDisplay, ErrorDisplay, StatusDisplay } from './common';
import { useTranslation } from 'react-i18next';

// 文件大小格式化工具函数
const formatFileSize = (bytes: number): string => {
  if (bytes === 0) return '0 B';

  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

// 安全的日期格式化函数
const formatModifiedTime = (timeString: string | undefined): string | null => {
  if (!timeString) return null;

  try {
    // 尝试解析日期
    const date = new Date(timeString);

    // 检查日期是否有效
    if (isNaN(date.getTime())) {
      return null;
    }

    return date.toLocaleString();
  } catch {
    return null;
  }
};

// 错误信息翻译辅助函数
const translateError = (error: string, t: (key: string) => string): string => {
  // 检查是否是翻译键（以字母开头，包含点号）
  if (error.match(/^[a-zA-Z][a-zA-Z0-9.]+$/)) {
    return t(error);
  }
  // 否则返回原始错误信息
  return error;
};

// 从错误对象中提取错误信息的辅助函数
const extractErrorMessage = (err: unknown, fallbackKey: string, t: (key: string) => string): string => {
  if (err instanceof Error) {
    return err.message;
  } else if (typeof err === 'string') {
    return err;
  } else if (err && typeof err === 'object' && 'message' in err) {
    return String(err.message);
  } else {
    return t(fallbackKey);
  }
};

interface ArchiveViewerProps {
  url: string;
  headers: Record<string, string>;
  filename: string;
  // 新增：可选的存储客户端，用于本地文件处理
  storageClient?: any;
}

interface LoadMoreProgress {
  currentChunk: number;
  totalSize: number;
  loadedSize: number;
}

export const ArchiveViewer: React.FC<ArchiveViewerProps> = ({
  url,
  headers,
  filename,
  storageClient
}) => {
  const { t } = useTranslation();
  const [archiveInfo, setArchiveInfo] = useState<ArchiveInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedEntry, setSelectedEntry] = useState<ArchiveEntry | null>(null);
  const [filePreview, setFilePreview] = useState<FilePreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null); // 新增：专门用于预览错误
  const [searchTerm, setSearchTerm] = useState('');
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [loadMoreProgress, setLoadMoreProgress] = useState<LoadMoreProgress>({
    currentChunk: 0,
    totalSize: 0,
    loadedSize: 0
  });
  const [currentLoadedSize, setCurrentLoadedSize] = useState(128 * 1024); // 已加载的内容大小，初始为128KB

  useEffect(() => {
    loadArchiveInfo();
  }, [url, filename]);

  const loadArchiveInfo = async () => {
    try {
      setLoading(true);
      setError(null);

      let info: ArchiveInfo;

      // 检查是否有存储客户端，如果有则优先使用存储客户端接口
      if (storageClient && storageClient.analyzeArchive) {
        // 使用存储客户端的统一接口
        const maxSize = 10 * 1024 * 1024; // 10MB
        info = await storageClient.analyzeArchive(url, filename, maxSize);
      } else {
        // 回退到直接的压缩服务接口
        const maxSize = 10 * 1024 * 1024; // 10MB
        info = await CompressionService.analyzeArchive(
          url,
          headers,
          filename,
          maxSize
        );
      }

      setArchiveInfo(info);
    } catch (err) {
      const errorMessage = extractErrorMessage(err, 'error.load.archive', t);
      setError(translateError(errorMessage, t));
    } finally {
      setLoading(false);
    }
  };

  const loadDetailedArchiveInfo = async () => {
    if (!filename.toLowerCase().endsWith('.zip')) {
      return;
    }

    try {
      setLoading(true);
      setError(null);

      let detailedInfo: ArchiveInfo;

      if (storageClient && storageClient.analyzeArchive) {
        // 使用存储客户端的统一接口，不限制大小以获取详细信息
        detailedInfo = await storageClient.analyzeArchive(url, filename);
      } else {
        // 回退到直接的压缩服务接口
        detailedInfo = await CompressionService.analyzeArchive(
          url,
          headers,
          filename
        );
      }

      setArchiveInfo(detailedInfo);
    } catch (err) {
      const errorMessage = extractErrorMessage(err, 'error.load.details', t);
      setError(translateError(errorMessage, t));
    } finally {
      setLoading(false);
    }
  };

  const previewFile = async (entry: ArchiveEntry) => {
    // 检查是否为占位符条目（大文件的流式处理条目）
    // 占位符条目特征：is_dir=true, size=0, 且分析状态为Streaming
    if (entry.is_dir && entry.size === 0 && archiveInfo?.analysis_status?.Streaming !== undefined) {
      await loadDetailedArchiveInfo();
      return;
    }

    // 设置选中状态，即使是文件夹也要显示信息
    setSelectedEntry(entry);

    if (entry.is_dir) {
      // 对于文件夹，显示文件夹信息而不是内容预览
      setFilePreview(null);
      setPreviewError(null);
      setPreviewLoading(false);
      return;
    }

    try {
      setPreviewLoading(true);
      setFilePreview(null);
      setPreviewError(null); // 清除之前的预览错误
      setCurrentLoadedSize(128 * 1024); // 重置为初始加载大小

      let preview: FilePreview;

      if (storageClient && storageClient.getArchiveFilePreview) {
        // 使用存储客户端的统一接口
        preview = await storageClient.getArchiveFilePreview(
          url,
          filename,
          entry.path,
          currentLoadedSize
        );
      } else {
        // 简化预览策略：直接尝试获取预览，后端会智能处理
        preview = await CompressionService.extractFilePreview(
          url,
          headers,
          filename,
          entry.path,
          128 * 1024 // 128KB预览
        );
      }

      setFilePreview(preview);

    } catch (err) {
      const errorMessage = extractErrorMessage(err, 'error.preview.file', t);
      setPreviewError(translateError(errorMessage, t));
    } finally {
      setPreviewLoading(false);
    }
  };

  const loadMoreContent = async (entry: ArchiveEntry) => {
    if (!filePreview || isLoadingMore) return;

    try {
      setIsLoadingMore(true);

      // 计算下一块要加载的大小（每次加载512KB或剩余大小）
      const chunkSize = 512 * 1024; // 512KB
      const nextLoadSize = Math.min(currentLoadedSize + chunkSize, entry.size);

      setLoadMoreProgress({
        currentChunk: 0,
        totalSize: entry.size,
        loadedSize: currentLoadedSize
      });

      // 模拟加载进度
      const startSize = currentLoadedSize;
      let currentProgress = startSize;
      const targetSize = nextLoadSize;

      const interval = setInterval(() => {
        currentProgress += (targetSize - startSize) * 0.1;
        if (currentProgress >= targetSize) {
          currentProgress = targetSize;
          clearInterval(interval);
        }
        setLoadMoreProgress(prev => ({
          ...prev,
          loadedSize: currentProgress
        }));
      }, 100);

      // 加载更多内容
      const expandedPreview = await CompressionService.extractFilePreview(
        url,
        headers,
        filename,
        entry.path,
        nextLoadSize // 加载到新的大小
      );

      clearInterval(interval);
      setFilePreview(expandedPreview);
      setCurrentLoadedSize(nextLoadSize);
      setPreviewError(null); // 清除预览错误

      setLoadMoreProgress(prev => ({
        ...prev,
        loadedSize: nextLoadSize
      }));

    } catch (err) {
      const errorMessage = extractErrorMessage(err, 'error.load.more.content', t);
      setPreviewError(translateError(errorMessage, t));
    } finally {
      setIsLoadingMore(false);
      // 延迟重置进度，让用户看到加载完成状态
      setTimeout(() => {
        setLoadMoreProgress({
          currentChunk: 0,
          totalSize: 0,
          loadedSize: 0
        });
      }, 1000);
    }
  };

  // 复制压缩包内文件路径到剪贴板
  const copyFilePath = async (entry: ArchiveEntry) => {
    try {
      const fullPath = `${filename}:/${entry.path}`;
      const success = await copyToClipboard(fullPath);
      if (success) {
        showCopyToast(t('copied.to.clipboard'));
      } else {
        showCopyToast(t('copy.failed'));
      }
    } catch (err) {
      console.error('Failed to copy path:', err);
      showCopyToast(t('copy.failed'));
    }
  };

  const filteredEntries = archiveInfo?.entries.filter(entry =>
    entry.path.toLowerCase().includes(searchTerm.toLowerCase())
  ) || [];

  if (loading) {
    return (
      <LoadingDisplay
        message={t('loading.analyzing.archive')}
        icon={Archive}
      />
    );
  }

  if (error) {
    return (
      <ErrorDisplay
        message={error}
        onRetry={loadArchiveInfo}
      />
    );
  }

  return (
    <div className="h-full flex flex-col">
      <div className="flex-1 flex min-h-0">
        {/* 文件列表 */}
        <div className="w-1/2 border-r border-gray-200 dark:border-gray-700 flex flex-col min-h-0">
          <div className="p-4 border-b border-gray-200 dark:border-gray-700 flex-shrink-0">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={16} />
              <input
                type="text"
                placeholder={t('search.files.placeholder')}
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-10 pr-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700"
              />
            </div>
          </div>

          <div className="flex-1 overflow-hidden min-h-0">
            {filteredEntries.length > 0 ? (
              <VirtualizedArchiveList
                entries={filteredEntries}
                onSelectEntry={previewFile}
                selectedPath={selectedEntry?.path}
                searchTerm={searchTerm}
                height={600}
              />
            ) : searchTerm ? (
              <StatusDisplay
                type="noSearchResults"
                message={t('no.matching.files')}
                secondaryMessage={`${t('try.different.keywords')} "${searchTerm}"`}
              />
            ) : (
              <StatusDisplay
                type="archiveEmpty"
                message={t('archive.empty')}
              />
            )}
          </div>
        </div>

        {/* 文件预览 */}
        <div className="w-1/2 flex flex-col min-h-0">
          {previewLoading ? (
            <LoadingDisplay message={t('loading.preview')} />
          ) : selectedEntry ? (
            <div className="flex-1 flex flex-col min-h-0">
              <div className="p-4 -my-0.5 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 flex-shrink-0">
                <div className="flex items-center justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center space-x-2">
                      <h3 className="font-medium truncate">{selectedEntry.path}</h3>
                      {/* 复制文件路径按钮 */}
                      <button
                        onClick={() => copyFilePath(selectedEntry)}
                        className="p-1 hover:bg-gray-200 dark:hover:bg-gray-600 rounded transition-colors"
                        title={t('copy.full.path')}
                      >
                        <Copy className="w-4 h-4 text-gray-500 dark:text-gray-400" />
                      </button>
                    </div>
                    <p className="text-sm text-gray-600 dark:text-gray-400">
                      {t('file.size.label')}: {formatFileSize(selectedEntry.size)}
                      {(() => {
                        const formattedTime = formatModifiedTime(selectedEntry.modified_time);
                        return formattedTime ? (
                          <span className="ml-4">
                            {t('file.modified.time')}: {formattedTime}
                          </span>
                        ) : null;
                      })()}
                    </p>
                  </div>
                </div>
              </div>

              <div className="flex-1 overflow-auto p-4 min-h-0">
                {previewError ? (
                  <div className="h-full flex items-center justify-center">
                    <div className="text-center">
                      <div className="mb-4">
                        <div className="w-16 h-16 mx-auto mb-4 bg-red-100 dark:bg-red-900/30 rounded-full flex items-center justify-center">
                          <AlertCircle className="w-8 h-8 text-red-500 dark:text-red-400" />
                        </div>
                        <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100 mb-2">
                          {t('preview.failed')}
                        </h3>
                        <p className="text-sm text-gray-600 dark:text-gray-400 max-w-md">
                          {previewError}
                        </p>
                      </div>
                      <button
                        onClick={() => {
                          setPreviewError(null);
                          if (selectedEntry) {
                            previewFile(selectedEntry);
                          }
                        }}
                        className="px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-lg text-sm transition-colors"
                      >
                        {t('retry.preview')}
                      </button>
                    </div>
                  </div>
                ) : selectedEntry?.is_dir ? (
                  <div className="h-full flex items-center justify-center">
                    <div className="text-center">
                      <div className="w-16 h-16 mx-auto mb-4 bg-blue-100 dark:bg-blue-900/30 rounded-full flex items-center justify-center">
                        <Folder className="w-8 h-8 text-blue-500 dark:text-blue-400" />
                      </div>
                      <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100 mb-2">
                        {t('folder.selected')}
                      </h3>
                      <p className="text-sm text-gray-600 dark:text-gray-400 max-w-md">
                        {t('folder.info.message')}
                      </p>
                    </div>
                  </div>
                ) : filePreview ? (
                  <div className="h-full flex flex-col min-h-0">
                    <div className="flex-1 overflow-auto min-h-0">
                      <pre className="whitespace-pre-wrap text-sm font-mono p-4 bg-gray-50 dark:bg-gray-900 rounded border border-gray-200 dark:border-gray-700">
                        {filePreview.content}
                      </pre>
                    </div>

                    {selectedEntry && currentLoadedSize < selectedEntry.size && (
                      <div className="p-3 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 flex-shrink-0">
                        {isLoadingMore && (
                          <div className="mb-3">
                            <div className="flex items-center justify-between mb-2">
                              <span className="text-sm font-medium text-blue-600 dark:text-blue-400">{t('loading.more.content')}</span>
                              <span className="text-sm text-gray-600 dark:text-gray-400">
                                {formatFileSize(loadMoreProgress.loadedSize)} / {formatFileSize(loadMoreProgress.totalSize)}
                              </span>
                            </div>
                            <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                              <div
                                className="bg-blue-500 h-2 rounded-full transition-all duration-300"
                                style={{
                                  width: `${loadMoreProgress.totalSize > 0 ? Math.min(100, (loadMoreProgress.loadedSize / loadMoreProgress.totalSize) * 100) : 0}%`
                                }}
                              />
                            </div>
                          </div>
                        )}
                        <div className="flex items-center justify-between">
                          <span className="text-sm text-gray-600 dark:text-gray-400">
                            {t('file.shown')} {formatFileSize(currentLoadedSize)}，{t('file.complete')} {formatFileSize(selectedEntry.size)}
                            {currentLoadedSize < selectedEntry.size && (
                              <span className="text-gray-500">
                                {' '}（{t('file.remaining')} {formatFileSize(selectedEntry.size - currentLoadedSize)}）
                              </span>
                            )}
                          </span>
                          <button
                            onClick={() => loadMoreContent(selectedEntry)}
                            className="px-3 py-1 bg-blue-500 text-white rounded text-sm hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed"
                            disabled={isLoadingMore}
                          >
                            {isLoadingMore ? t('loading.text') :
                             (selectedEntry.size - currentLoadedSize > 512 * 1024 ? t('load.more.chunk') : t('load.complete.content'))}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <StatusDisplay
                    type="previewEmpty"
                    message={t('preparing.preview')}
                  />
                )}
              </div>
            </div>
          ) : (
            <StatusDisplay
              type="previewEmpty"
              message={t('select.file.for.preview')}
            />
          )}
        </div>
      </div>
    </div>
  );
};
