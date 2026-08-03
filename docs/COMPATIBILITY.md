# Menie compatibility matrix

This matrix describes the local-only desktop build in this repository. “Build” means the source compiles; device-specific audio and accelerator behavior still requires the corresponding hardware smoke test.

| Area | Windows x64 | macOS | Linux | Notes |
|---|---|---|---|---|
| Tauri desktop shell | Build verified in CI/local quality gate | Supported target | Supported target | Native permissions remain OS-specific. |
| Microphone capture | Supported | Supported | Supported | Device availability and permissions are checked at runtime. |
| System audio capture | Supported where the selected backend/permission is available | Supported where the selected backend/permission is available | Backend/device dependent | Menie does not silently substitute a missing device. |
| Whisper transcription | Supported; CPU default, optional CUDA/Vulkan/OpenBLAS builds | Supported; optional Metal/CoreML builds | Supported; optional CUDA/Vulkan/ROCm/OpenBLAS builds | Models are local GGUF artifacts with integrity sidecars. |
| Parakeet transcription | Supported when the bundled ONNX runtime/device prerequisites are available | Supported when prerequisites are available | Supported when prerequisites are available | Runtime library compatibility is checked by the health report. |
| Embedded local summaries | Supported through the packaged local runtime; profile/model naming may vary by release | Supported through the packaged local runtime; profile/model naming may vary by release | Supported through the packaged local runtime; profile/model naming may vary by release | No Ollama or external AI endpoint is required. |
| Local search, embeddings, and grounded Q&A | Supported | Supported | Supported | Retrieval and answer generation remain on-device. |
| Zoom/Teams/Webex process detection | Supported | Supported target | Supported target | Detection uses process names only; it never inspects call content. |
| Browser-based Google Meet detection | Not supported | Not supported | Not supported | Browser tabs are intentionally not inspected; use manual recording or the prompt. |
| Encrypted local handoff | Supported | Supported | Supported | PBKDF2-HMAC-SHA256 + AES-256-GCM; media is not included in a portable bundle. |

## Model and hardware guidance

The first-run hardware assessment remains authoritative for choosing the Efficient, Balanced, or High Accuracy local summary profile. The profiles are packaged local runtimes (currently including Qwen and legacy Gemma-compatible options), not cloud providers. GPU/NPU acceleration is optional; the CPU path is the compatibility fallback. Model downloads are explicit, HTTPS-restricted, and integrity-checked before activation.

## Support evidence

Run the repository quality gate from the workspace root:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/check-quality-gates.ps1
```

The local health report is the authoritative runtime check for database, storage, transcription models, summary model readiness, search indexes, and exclusions on a specific device.
