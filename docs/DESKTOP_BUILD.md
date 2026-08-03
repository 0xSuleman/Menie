# Desktop build and release handoff

## Local Windows build

From the repository root:

```powershell
$env:WHISPER_DONT_GENERATE_BINDINGS = "1"
npm.cmd --prefix frontend run tauri:build:cpu
```

This produces `target/release/menie.exe` and Windows MSI/NSIS installers. The generated executable can be exercised directly before installing.

`WHISPER_DONT_GENERATE_BINDINGS=1` is used on machines where the pre-generated Whisper bindings are available but `libclang.dll` is not installed. A source environment that changes Whisper headers should install LLVM/libclang and omit this setting.

## Signing requirements

Local unsigned builds are useful for development and smoke testing. Production updater artifacts require both:

- `TAURI_SIGNING_PRIVATE_KEY` for Tauri update metadata and artifact signatures.
- `DIGICERT_KEYPAIR_ALIAS` (and the configured DigiCert tooling) for Windows Authenticode signing.

The Tauri configuration keeps a public updater key and the quality gate checks that it remains non-empty and HTTPS-only. Do not commit private keys, certificate material, or signing tokens. Without the private signing variables, Tauri may still produce the executable and installers but must report the release as unsigned.

## Runtime smoke check

```powershell
$proc = Start-Process -FilePath .\target\release\menie.exe -PassThru
Start-Sleep -Seconds 8
Get-Process -Id $proc.Id
```

A responsive `menie.exe` process confirms that the packaged desktop shell starts. Hardware permissions, microphone/system-audio devices, and local model readiness remain device-specific checks shown by the in-app health report.