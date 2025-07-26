pub mod traits;
pub mod manager;
pub mod webdav_client;
pub mod local_client;
pub mod oss_client;

#[allow(unused_imports)] // 这些类型通过Serde序列化在Tauri命令中使用
pub use traits::{StorageRequest, ConnectionConfig, ListOptions, DirectoryResult, StorageFile};
pub use manager::get_storage_manager;
