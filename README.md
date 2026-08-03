<div align="center">

# 🎙️ Menie

### **100% Local-First AI Meeting & Audio Intelligence Desktop Assistant**

[![GitHub Release](https://img.shields.io/github/v/release/0xSuleman/Menie?include_prereleases&color=yellow)](https://github.com/0xSuleman/Menie/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE.md)
[![Supported OS](https://img.shields.io/badge/Supported_OS-macOS%20%7C%20Windows-white)](https://github.com/0xSuleman/Menie)
[![Privacy First](https://img.shields.io/badge/Privacy-100%25_Local_&_On--Device-success)](PRIVACY_POLICY.md)

[Key Features](#-key-features) • [Architecture](#-architecture) • [Upcoming Roadmap](#-upcoming-roadmap) • [Getting Started](#-getting-started) • [Contributing](#-contributing)

</div>

---

## 🌟 What is Menie?

**Menie** is an open-source, ultra-private, **100% local-first AI meeting assistant and audio intelligence desktop app**. Built with **Tauri v2**, **Next.js**, **Rust**, and native hardware-accelerated speech engines (**Whisper** & **Parakeet**), Menie captures, transcribes, speaker-diarizes, and summarizes your meetings entirely on your device.

No audio or transcript data ever leaves your computer. No cloud subscription fees, no mandatory API keys, and zero telemetry tracking.

---

## 🛠️ Core Workflow & Pipeline

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                           MENIE 100% LOCAL AI PIPELINE                          │
├──────────────────┬───────────────────────┬───────────────────┬──────────────────┤
│  1. Audio Input  │  2. Transcription     │  3. Diarization   │  4. Intelligence │
├──────────────────┼───────────────────────┼───────────────────┼──────────────────┤
│ • Mic / WebCam   │ • NVIDIA Parakeet TDT │ • Neural Speaker  │ • Local LLM      │
│ • System Audio   │ • Whisper ONNX        │   Embeddings      │   Summarization  │
│ • File Imports   │ • GPU Accelerated     │ • Auto-Clustering │ • SQLite FTS5    │
└──────────────────┴───────────────────────┴───────────────────┴──────────────────┘
```

---

## ✨ Key Features

### 🔒 100% On-Device Privacy & Offline First
- **Zero Cloud Dependence**: Transcriptions and AI summaries run 100% locally on your CPU/GPU.
- **Air-Gapped Operation**: Use Menie in confidential environments without internet connectivity.
- **SQLite Database with Encryption**: Your transcripts stay securely on your local file system.

### 🎙️ Real-Time & Batch Audio Intelligence
- **Dual Channel Capture**: Capture microphone input and system audio simultaneously.
- **Multi-Format Import**: Import existing audio files (`.mp3`, `.wav`, `.m4a`, `.flac`, `.ogg`, `.webm`).
- **Parakeet & Whisper ONNX Engines**: Sub-second fast transcription using NVIDIA Parakeet TDT or Whisper models.

### ⚡ Local Hardware Acceleration
- **Apple Silicon Metal**: Native Metal GPU and CoreML acceleration for macOS.
- **NVIDIA CUDA & Vulkan**: High-throughput GPU offloading on Windows and Linux.
- **OpenBLAS CPU Fallback**: Optimized multi-threaded execution for standard CPUs.

### 🧠 Local LLM Meeting Summarization
- **llama-helper & Ollama Integration**: Generate action items, meeting minutes, decision logs, and key takeaways using local GGUF models (LLaMA 3, Qwen, Mistral, Gemma).
- **Custom Summarization Templates**: Tailor summary structures for 1-on-1s, engineering standups, executive syncs, or sales calls.

### 👥 Speaker Diarization & Labeling
- **Speaker Attribution**: Track distinct speakers during real-time meetings or imported recordings.
- **Custom Speaker Profiles**: Assign names, roles, and colors to meeting participants.

### 🔍 Search & Export Flexibility
- **Full-Text SQLite FTS5 Search**: Instant full-text search across thousands of hours of historical meeting transcripts.
- **Rich Export Options**: Export meeting minutes to Markdown, PDF, JSON, or send payload webhooks to custom local endpoints.

---

## 🏗️ Architecture

```
                               ┌────────────────────────────────────────┐
                               │           Menie Frontend               │
                               │      Next.js 14 + React + Tailwind     │
                               └───────────────────┬────────────────────┘
                                                   │ IPC (Tauri Bridge)
                               ┌───────────────────▼────────────────────┐
                               │            Tauri Rust Core             │
                               │  CPAL Audio Engine + SQLite FTS5 Store │
                               └─────────┬──────────────────────┬───────┘
                                         │                      │
                   ┌─────────────────────▼──────┐        ┌──────▼─────────────────────┐
                   │    Whisper / Parakeet RS   │        │     llama-helper Engine    │
                   │ (Metal / CUDA / Vulkan GPU)│        │ (Local GGUF LLM Execution) │
                   └────────────────────────────┘        └────────────────────────────┘
```

---

## 🚀 Upcoming Roadmap

Here are the upcoming features planned for Menie's future releases:

- [ ] **🎯 Real-Time Acoustic Speaker Separation**: Live acoustic embedding extraction to automatically differentiate multi-speaker conversations without prior training.
- [ ] **📚 Local Vector RAG Knowledge Base**: Semantic vector search across your entire historical meeting archive to ask questions across months of meeting history offline.
- [ ] **📱 Mobile Companion Local Handoff**: Seamless peer-to-peer Wi-Fi transfer from mobile voice memos to your desktop workstation.
- [ ] **⚡ Automated Local Action Pipelines**: Direct integration with local note-taking apps like Obsidian, Logseq, and Notion Local.
- [ ] **🌐 Offline Live Streaming Translation**: Real-time cross-lingual translation stream during live international conference calls.

---

## 💻 Getting Started

### Installation

Download the latest pre-compiled desktop binary for your operating system from [Releases](https://github.com/0xSuleman/Menie/releases).

#### macOS
1. Download `Menie-aarch64.dmg` (Apple Silicon) or `Menie-x64.dmg` (Intel).
2. Drag `Menie.app` into your Applications folder.

#### Windows
1. Download `Menie-x64-setup.exe`.
2. Run the installer and launch Menie.

---

## 🛠️ Building from Source

### Prerequisites
- **Node.js** (v18+)
- **pnpm** (`npm install -g pnpm`)
- **Rust** (1.77+)

### Quick Build Instructions

```bash
# Clone the repository
git clone https://github.com/0xSuleman/Menie.git
cd Menie/frontend

# Install frontend dependencies
pnpm install

# Run desktop dev environment
pnpm tauri:dev
```

To build a standalone production release:
```bash
pnpm tauri:build
```

---

## 📄 License

Menie is open-source software licensed under the [MIT License](LICENSE.md).

---

<div align="center">
Made with ❤️ by <a href="https://github.com/0xSuleman">0xSuleman</a>
</div>
