//! Versioned, permission-declaring local extension contract.
//! Plugins are manifests only at this boundary; execution and outbound writes
//! remain approval-aware and cannot bypass the local-only AI policy.
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct PluginManifest {
    pub id: String,
    pub version: String,
    pub api_version: u32,
    #[serde(default)]
    pub data_types: Vec<String>,
    #[serde(default)]
    pub meetings: Vec<String>,
    #[serde(default)]
    pub network_destinations: Vec<String>,
    #[serde(default)]
    pub actions: Vec<String>,
}

fn valid_identifier(value: &str) -> bool {
    !value.is_empty()
        && value.chars().all(|character| {
            character.is_ascii_alphanumeric() || matches!(character, '-' | '_' | '.')
        })
}

pub fn validate_manifest(manifest: &PluginManifest) -> Result<(), String> {
    if !valid_identifier(&manifest.id) {
        return Err("Plugin id must contain only letters, numbers, '.', '-' or '_'".to_string());
    }
    if manifest.api_version != 1 {
        return Err(format!(
            "Unsupported plugin API version {}; expected 1",
            manifest.api_version
        ));
    }
    if manifest.actions.is_empty() {
        return Err("Plugin must declare at least one action".to_string());
    }
    if manifest
        .data_types
        .iter()
        .any(|value| value.trim().is_empty())
        || manifest
            .meetings
            .iter()
            .any(|value| value.trim().is_empty())
    {
        return Err("Plugin data and meeting declarations cannot be empty".to_string());
    }
    for destination in &manifest.network_destinations {
        let value = destination.trim();
        if value != "none" && !(value.starts_with("https://") && !value.contains("@")) {
            return Err(
                "Plugin network destinations must be 'none' or HTTPS URLs without credentials"
                    .to_string(),
            );
        }
        if value.to_ascii_lowercase().contains("openai")
            || value.to_ascii_lowercase().contains("anthropic")
            || value.to_ascii_lowercase().contains("ollama")
        {
            return Err("Plugins cannot declare external AI or Ollama destinations".to_string());
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn valid() -> PluginManifest {
        PluginManifest {
            id: "example.notes".to_string(),
            version: "1.0.0".to_string(),
            api_version: 1,
            data_types: vec!["approved_artifact".to_string()],
            meetings: vec!["selected".to_string()],
            network_destinations: vec!["none".to_string()],
            actions: vec!["export_markdown".to_string()],
        }
    }

    #[test]
    fn manifest_requires_explicit_permissions() {
        assert!(validate_manifest(&valid()).is_ok());
        let mut manifest = valid();
        manifest.actions.clear();
        assert!(validate_manifest(&manifest).is_err());
    }

    #[test]
    fn manifest_rejects_external_ai_destinations() {
        let mut manifest = valid();
        manifest.network_destinations = vec!["https://api.openai.com/v1".to_string()];
        assert!(validate_manifest(&manifest).is_err());
    }
}
