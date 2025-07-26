use std::collections::HashMap;
use tokio::sync::Mutex;
use std::sync::Arc;
use super::traits::{StorageClient, StorageRequest, StorageResponse, StorageError, ConnectionConfig, StorageCapabilities, DirectoryResult, ListOptions};
use super::webdav_client::WebDAVClient;
use super::local_client::LocalFileSystemClient;
use super::oss_client::OSSClient;

pub struct StorageManager {
    clients: HashMap<String, Arc<dyn StorageClient + Send + Sync>>,
    active_client: Option<String>,
}

impl StorageManager {
    pub fn new() -> Self {
        Self {
            clients: HashMap::new(),
            active_client: None,
        }
    }

    pub async fn connect(&mut self, config: &ConnectionConfig) -> Result<(), StorageError> {
        let client: Arc<dyn StorageClient + Send + Sync> = match config.protocol.as_str() {
            "webdav" => {
                let mut client = WebDAVClient::new(config.clone())?;
                client.connect(config).await?;
                Arc::new(client)
            },
            "local" => {
                let mut client = LocalFileSystemClient::new();
                client.connect(config).await?;
                Arc::new(client)
            },
            "oss" => {
                let mut client = OSSClient::new(config.clone())?;
                client.connect(config).await?;
                Arc::new(client)
            },
            _ => return Err(StorageError::UnsupportedProtocol(config.protocol.clone())),
        };

        let client_id = format!("{}_{}", config.protocol, chrono::Utc::now().timestamp());

        self.clients.insert(client_id.clone(), client);
        self.active_client = Some(client_id);

        Ok(())
    }

    pub async fn disconnect(&mut self) -> Result<(), StorageError> {
        if let Some(client_id) = &self.active_client {
            if let Some(client) = self.clients.remove(client_id) {
                client.disconnect().await;
            }
            self.active_client = None;
        }
        Ok(())
    }

    pub fn is_connected(&self) -> bool {
        self.active_client.is_some()
    }

    pub async fn request(&self, request: &StorageRequest) -> Result<StorageResponse, StorageError> {
        let client_id = self.active_client.as_ref()
            .ok_or(StorageError::NotConnected)?;
        let client = self.clients.get(client_id)
            .ok_or(StorageError::NotConnected)?;

        client.request(request).await
    }

    pub async fn request_binary(&self, request: &StorageRequest) -> Result<Vec<u8>, StorageError> {
        let client_id = self.active_client.as_ref()
            .ok_or(StorageError::NotConnected)?;
        let client = self.clients.get(client_id)
            .ok_or(StorageError::NotConnected)?;

        client.request_binary(request).await
    }

    pub async fn list_directory(&self, path: &str, options: Option<&ListOptions>) -> Result<DirectoryResult, StorageError> {
        let client_id = self.active_client.as_ref()
            .ok_or(StorageError::NotConnected)?;
        let client = self.clients.get(client_id)
            .ok_or(StorageError::NotConnected)?;

        client.list_directory(path, options).await
    }

    pub fn current_capabilities(&self) -> Option<StorageCapabilities> {
        let client_id = self.active_client.as_ref()?;
        let client = self.clients.get(client_id)?;
        Some(client.capabilities())
    }

    pub fn get_current_client(&self) -> Option<Arc<dyn StorageClient>> {
        let client_id = self.active_client.as_ref()?;
        let client = self.clients.get(client_id)?;
        Some(client.clone())
    }

    pub fn get_download_url(&self, path: &str) -> Result<String, StorageError> {
        let client_id = self.active_client.as_ref()
            .ok_or(StorageError::NotConnected)?;
        let client = self.clients.get(client_id)
            .ok_or(StorageError::NotConnected)?;

        client.get_download_url(path)
    }

    pub fn supported_protocols(&self) -> Vec<&str> {
        vec!["webdav", "local", "oss"] // 支持 WebDAV、本机文件系统和 OSS
    }
}

// 全局存储管理器
static STORAGE_MANAGER: tokio::sync::OnceCell<Arc<Mutex<StorageManager>>> = tokio::sync::OnceCell::const_new();

pub async fn get_storage_manager() -> Arc<Mutex<StorageManager>> {
    STORAGE_MANAGER.get_or_init(|| async {
        Arc::new(Mutex::new(StorageManager::new()))
    }).await.clone()
}
