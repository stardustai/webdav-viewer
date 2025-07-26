export const connection = {
  // App title and description
  'webdav.browser': 'WebDAV Browser',
  'connect.server': 'Connect to your WebDAV server to browse files',
  'connect.storage': 'Connect to storage service or local file system',

  // Storage types
  'storage.type.select': 'Select Storage Type',
  'storage.type.webdav': 'WebDAV',
  'storage.type.webdav.description': 'Connect to WebDAV server',
  'storage.type.local': 'Local Files',
  'storage.type.local.description': 'Browse local file system',
  'storage.type.oss': 'OSS',
  'storage.type.oss.description': 'Connect to object storage service',

  // Connection name formats
  'connection.name.webdav': 'WebDAV({{host}})',
  'connection.name.local': 'Local Files({{path}})',
  'connection.name.oss': 'OSS({{host}}-{{bucket}})',

  // Form fields
  'server.url': 'Server URL',
  'server.url.placeholder': 'https://your-webdav-server.com',
  'username': 'Username',
  'username.placeholder': 'Your username',
  'password': 'Password',
  'password.placeholder': 'Your password',
  'connecting': 'Connecting...',
  'connected.to': 'Connected to',
  'connect': 'Connect',

  // OSS specific fields
  'oss.endpoint': 'Endpoint',
  'oss.endpoint.placeholder': 'https://oss-cn-hangzhou.aliyuncs.com or https://s3.amazonaws.com',
  'oss.endpoint.description': 'Supports Alibaba Cloud OSS, AWS S3, MinIO and other S3 API compatible object storage services',
  'oss.access.key': 'Access Key',
  'oss.access.key.placeholder': 'Access Key ID',
  'oss.secret.key': 'Secret Key',
  'oss.secret.key.placeholder': 'Access Key Secret',
  'oss.bucket': 'Bucket Name',
  'oss.bucket.placeholder': 'Bucket name',
  'oss.region': 'Region',
  'oss.region.placeholder': 'e.g., cn-hangzhou, us-east-1',
  'oss.region.optional': 'Region (Optional)',

  // Form validation errors
  'error.endpoint.required': 'Please enter OSS endpoint',
  'error.endpoint.invalid': 'Please enter a valid endpoint URL',
  'error.access.key.required': 'Please enter Access Key',
  'error.secret.key.required': 'Please enter Secret Key',
  'error.bucket.required': 'Please enter Bucket name',

  // Connection management
  'saved.connections': 'Saved Connections',
  'no.saved.connections': 'No saved connections yet',
  'save.connection.hint': 'Connection information will be saved automatically after successful connection',
  'connection.select.saved': 'Select a saved connection',
  'or.new.connection': 'or create new connection',
  'save.connection': 'Save connection',
  'save.password': 'Save password',
  'save.password.warning': 'Password will be stored in plain text in local storage, use with caution',
  'connection.name.placeholder': 'Connection name (optional)',
  'connection.name.hint': 'Leave empty to auto-generate name',
  'last.connected': 'Last connected',
  'set.default': 'Set as default',
  'unset.default': 'Remove default',
  'confirm.delete.connection': 'Are you sure you want to delete this connection?',
};
