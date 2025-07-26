import { Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

interface SplashScreenProps {
  message?: string;
}

export const SplashScreen: React.FC<SplashScreenProps> = ({ message }) => {
  const { t } = useTranslation();

  return (
    <div className="min-h-screen bg-white dark:bg-gray-900 flex items-center justify-center transition-all duration-300">
      <div className="text-center space-y-4">
        {/* Logo 或应用图标 */}
        <div className="w-16 h-16 mx-auto mb-6 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-2xl flex items-center justify-center shadow-lg">
          <span className="text-2xl text-white font-bold">🐝</span>
        </div>

        {/* 加载动画 */}
        <div className="flex items-center justify-center space-x-2">
          <Loader2 className="w-6 h-6 animate-spin text-indigo-600 dark:text-indigo-400" />
          <span className="text-gray-600 dark:text-gray-300 text-sm font-medium">
            {message || t('app.initializing', '正在初始化...')}
          </span>
        </div>

        {/* 进度条 */}
        <div className="w-48 h-1 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden mx-auto">
          <div className="h-full bg-gradient-to-r from-indigo-500 to-purple-600 rounded-full animate-pulse"></div>
        </div>
      </div>
    </div>
  );
};
