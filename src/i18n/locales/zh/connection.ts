export const connection = {
  // 应用标题和描述
  'webdav.browser': 'WebDAV 浏览器',
  'connect.server': '连接到您的 WebDAV 服务器来浏览文件',
  'connect.storage': '连接到存储服务或本地文件系统',

  // 存储类型
  'storage.type.select': '选择存储类型',
  'storage.type.webdav': 'WebDAV',
  'storage.type.webdav.description': '连接到 WebDAV 服务器',
  'storage.type.local': '本机文件',
  'storage.type.local.description': '浏览本机文件系统',
  'storage.type.oss': 'OSS',
  'storage.type.oss.description': '连接到对象存储服务',

  // 连接名称格式
  'connection.name.webdav': 'WebDAV({{host}})',
  'connection.name.local': '本机文件({{path}})',
  'connection.name.oss': 'OSS({{host}}-{{bucket}})',

  // 表单字段
  'server.url': '服务器地址',
  'server.url.placeholder': 'https://your-webdav-server.com',
  'username': '用户名',
  'username.placeholder': '您的用户名',
  'password': '密码',
  'password.placeholder': '您的密码',
  'connecting': '连接中...',
  'connected.to': '已连接到',
  'connect': '连接',

  // OSS 特定字段
  'oss.endpoint': '端点地址',
  'oss.endpoint.placeholder': 'https://oss-cn-hangzhou.aliyuncs.com 或 https://s3.amazonaws.com',
  'oss.endpoint.description': '支持阿里云 OSS、AWS S3、MinIO 等兼容 S3 API 的对象存储服务',
  'oss.access.key': 'Access Key',
  'oss.access.key.placeholder': '访问密钥 ID',
  'oss.secret.key': 'Secret Key',
  'oss.secret.key.placeholder': '访问密钥密码',
  'oss.bucket': 'Bucket 名称',
  'oss.bucket.placeholder': '存储桶名称',
  'oss.region': '区域',
  'oss.region.placeholder': '例如：cn-hangzhou、us-east-1',
  'oss.region.optional': '区域 (可选)',

  // 表单验证错误
  'error.endpoint.required': '请输入 OSS 端点地址',
  'error.endpoint.invalid': '请输入有效的端点地址',
  'error.access.key.required': '请输入 Access Key',
  'error.secret.key.required': '请输入 Secret Key',
  'error.bucket.required': '请输入 Bucket 名称',

  // 连接管理
  'saved.connections': '已保存的连接',
  'no.saved.connections': '暂无已保存的连接',
  'save.connection.hint': '连接成功后可自动保存连接信息',
  'connection.select.saved': '选择已保存的连接',
  'or.new.connection': '或新建连接',
  'save.connection': '保存连接',
  'save.password': '保存密码',
  'save.password.warning': '密码将以明文形式保存在本地存储中，请谨慎使用',
  'connection.name.placeholder': '连接名称（可选）',
  'connection.name.hint': '留空将自动生成名称',
  'last.connected': '最后连接',
  'set.default': '设为默认',
  'unset.default': '取消默认',
  'confirm.delete.connection': '确定要删除这个连接吗？',
};
