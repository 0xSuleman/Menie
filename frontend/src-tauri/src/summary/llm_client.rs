//! Local-only summary generation boundary.
//!
//! Meeting text must never be sent to a provider endpoint.  The legacy enum
//! variants remain temporarily so old persisted configuration can be reported
//! clearly by higher layers, but this module never constructs an HTTP request
//! for them.

use reqwest::Client;
use std::path::PathBuf;
use tokio_util::sync::CancellationToken;

pub const LOCAL_ONLY_PROVIDER_ERROR: &str =
    "External AI providers are disabled. Menie processes meeting content only with the packaged local model.";

/// Provider values retained for backward-compatible deserialization of legacy
/// settings. Only `BuiltInAI` is executable.
#[derive(Debug, Clone, PartialEq)]
pub enum LLMProvider {
    OpenAI,
    Claude,
    Groq,
    Ollama,
    OpenRouter,
    BuiltInAI,
    CustomOpenAI,
}

impl LLMProvider {
    /// Parse a configured provider. Remote selections are rejected before any
    /// transcript, prompt, or API key can reach a network client.
    pub fn from_str(value: &str) -> Result<Self, String> {
        match value.to_lowercase().as_str() {
            "builtin-ai" | "local-llama" | "localllama" | "local-gemma" => Ok(Self::BuiltInAI),
            "openai" | "claude" | "groq" | "ollama" | "openrouter" | "custom-openai" => {
                Err(LOCAL_ONLY_PROVIDER_ERROR.to_string())
            }
            _ => Err(format!("Unsupported LLM provider: {value}")),
        }
    }

    pub fn is_local_only(&self) -> bool {
        matches!(self, Self::BuiltInAI)
    }
}

/// Generates summary text with Menie's packaged local inference sidecar.
///
/// The retained arguments keep the processor API stable during migration from
/// the previous multi-provider implementation. None of the network-related
/// inputs are used or inspected.
#[allow(clippy::too_many_arguments)]
pub async fn generate_summary(
    _client: &Client,
    provider: &LLMProvider,
    model_name: &str,
    _api_key: &str,
    system_prompt: &str,
    user_prompt: &str,
    _ollama_endpoint: Option<&str>,
    _custom_openai_endpoint: Option<&str>,
    _max_tokens: Option<u32>,
    _temperature: Option<f32>,
    _top_p: Option<f32>,
    app_data_dir: Option<&PathBuf>,
    cancellation_token: Option<&CancellationToken>,
) -> Result<String, String> {
    if let Some(token) = cancellation_token {
        if token.is_cancelled() {
            return Err("Summary generation was cancelled".to_string());
        }
    }

    if !provider.is_local_only() {
        return Err(LOCAL_ONLY_PROVIDER_ERROR.to_string());
    }

    let app_data_dir = app_data_dir
        .ok_or_else(|| "app_data_dir is required for the packaged local model".to_string())?;

    crate::summary::summary_engine::generate_with_builtin(
        app_data_dir,
        model_name,
        system_prompt,
        user_prompt,
        cancellation_token,
    )
    .await
    .map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_only_the_packaged_local_provider() {
        assert_eq!(
            LLMProvider::from_str("builtin-ai"),
            Ok(LLMProvider::BuiltInAI)
        );
        assert_eq!(
            LLMProvider::from_str("local-gemma"),
            Ok(LLMProvider::BuiltInAI)
        );
    }

    #[test]
    fn rejects_legacy_remote_providers_before_inference() {
        for provider in [
            "openai",
            "claude",
            "groq",
            "ollama",
            "openrouter",
            "custom-openai",
        ] {
            assert_eq!(
                LLMProvider::from_str(provider),
                Err(LOCAL_ONLY_PROVIDER_ERROR.to_string())
            );
        }
    }

    #[test]
    fn only_builtin_variant_is_permitted_to_generate() {
        assert!(LLMProvider::BuiltInAI.is_local_only());
        assert!(!LLMProvider::OpenAI.is_local_only());
        assert!(!LLMProvider::Ollama.is_local_only());
    }
}
