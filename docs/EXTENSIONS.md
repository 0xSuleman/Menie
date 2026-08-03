# Local extension contract

Menie extensions must begin as a versioned JSON manifest and be validated by the native `api_validate_local_plugin_manifest` command before enablement. The manifest declares:

- `id`, `version`, and `api_version` (currently `1`)
- `data_types` and `meetings` scopes
- explicit `actions`
- `network_destinations`, using `none` or HTTPS URLs without embedded credentials

External AI providers and Ollama destinations are rejected by the validator. A manifest does not grant permission by itself: outbound writes still require the existing approval-aware delivery queue, and plugin failures must not affect capture or the core library.

Example:

```json
{
  "id": "example.notes",
  "version": "1.0.0",
  "api_version": 1,
  "data_types": ["approved_artifact"],
  "meetings": ["selected"],
  "network_destinations": ["none"],
  "actions": ["export_markdown"]
}
```