import React, { useMemo } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  Folder,
  FileText,
  Download,
  File,
  Image,
  Film,
  Music,
  FileImage,
  FileSpreadsheet,
  Archive
} from 'lucide-react';
import { WebDAVFile } from '../types';
import { getFileType } from '../utils/fileTypes';

interface VirtualizedFileListProps {
  files: WebDAVFile[];
  onFileClick: (file: WebDAVFile) => void;
  showHidden: boolean;
  sortField: 'name' | 'size' | 'modified';
  sortDirection: 'asc' | 'desc';
  height: number;
  searchTerm?: string;
}

export const VirtualizedFileList: React.FC<VirtualizedFileListProps> = ({
  files,
  onFileClick,
  showHidden,
  sortField,
  sortDirection,
  height,
  searchTerm = ''
}) => {

  // 过滤和排序文件
  const processedFiles = useMemo(() => {
    // 首先过滤掉空文件名和无效条目
    let filteredFiles = files.filter(file =>
      file.basename && file.basename.trim() !== ''
    );

    // 过滤隐藏文件
    filteredFiles = showHidden
      ? filteredFiles
      : filteredFiles.filter(file => !file.basename.startsWith('.'));

    // 根据搜索词过滤文件名
    if (searchTerm.trim()) {
      filteredFiles = filteredFiles.filter(file =>
        file.basename.toLowerCase().includes(searchTerm.toLowerCase())
      );
    }

    // 排序
    const sortedFiles = [...filteredFiles].sort((a, b) => {
      // 目录总是排在文件前面
      if (a.type === 'directory' && b.type !== 'directory') return -1;
      if (a.type !== 'directory' && b.type === 'directory') return 1;

      let compareValue = 0;

      switch (sortField) {
        case 'name':
          compareValue = a.basename.toLowerCase().localeCompare(b.basename.toLowerCase());
          break;
        case 'size':
          compareValue = a.size - b.size;
          break;
        case 'modified':
          compareValue = new Date(a.lastmod).getTime() - new Date(b.lastmod).getTime();
          break;
      }

      return sortDirection === 'asc' ? compareValue : -compareValue;
    });

    return sortedFiles;
  }, [files, showHidden, sortField, sortDirection, searchTerm]);

  // 创建虚拟化容器引用
  const parentRef = React.useRef<HTMLDivElement>(null);

  // 虚拟化配置
  const virtualizer = useVirtualizer({
    count: processedFiles.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 60, // 每行高度
    overscan: 10, // 预渲染的行数
  });

  // 渲染文件图标
  const renderFileIcon = (file: WebDAVFile) => {
    if (file.type === 'directory') {
      return <Folder className="w-5 h-5 text-blue-500 mr-3 flex-shrink-0" />;
    }

    const fileType = getFileType(file.filename);
    switch (fileType) {
      case 'image':
        return <Image className="w-5 h-5 text-green-500 mr-3 flex-shrink-0" />;
      case 'video':
        return <Film className="w-5 h-5 text-purple-500 mr-3 flex-shrink-0" />;
      case 'audio':
        return <Music className="w-5 h-5 text-pink-500 mr-3 flex-shrink-0" />;
      case 'pdf':
        return <FileImage className="w-5 h-5 text-red-500 mr-3 flex-shrink-0" />;
      case 'spreadsheet':
        return <FileSpreadsheet className="w-5 h-5 text-emerald-500 mr-3 flex-shrink-0" />;
      case 'archive':
        return <Archive className="w-5 h-5 text-orange-500 mr-3 flex-shrink-0" />;
      case 'text':
        return <FileText className="w-5 h-5 text-blue-500 mr-3 flex-shrink-0" />;
      default:
        return <File className="w-5 h-5 text-gray-400 mr-3 flex-shrink-0" />;
    }
  };

  // 格式化文件大小
  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  // 格式化日期
  const formatDate = (dateString: string): string => {
    return new Date(dateString).toLocaleString();
  };

  return (
    <div
      ref={parentRef}
      style={{ height: `${height}px` }}
      className="overflow-auto"
    >
      <div
        style={{
          height: `${virtualizer.getTotalSize()}px`,
          width: '100%',
          position: 'relative',
        }}
      >
        {virtualizer.getVirtualItems().map((virtualItem) => {
          const file = processedFiles[virtualItem.index];

          return (
            <div
              key={virtualItem.key}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                height: `${virtualItem.size}px`,
                transform: `translateY(${virtualItem.start}px)`,
              }}
              className="border-b border-gray-200 dark:border-gray-700"
            >
              <div
                onClick={() => onFileClick(file)}
                className="flex items-center px-6 py-3 hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer transition-colors h-full"
              >
                {/* 文件图标和名称 */}
                <div className="flex items-center flex-1 min-w-0 pr-4">
                  {renderFileIcon(file)}
                  <span
                    className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate max-w-md"
                    title={file.basename}
                  >
                    {file.basename}
                  </span>
                  {file.type === 'file' && getFileType(file.filename) === 'unknown' && (
                    <Download className="w-4 h-4 text-gray-400 dark:text-gray-500 ml-2 flex-shrink-0" />
                  )}
                </div>

                {/* 文件大小 */}
                <div className="w-24 text-sm text-gray-500 dark:text-gray-400 text-right pr-4 flex-shrink-0">
                  {file.type === 'file' ? formatFileSize(file.size) : '—'}
                </div>

                {/* 修改时间 */}
                <div className="w-48 text-sm text-gray-500 dark:text-gray-400 text-right flex-shrink-0">
                  {formatDate(file.lastmod)}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
