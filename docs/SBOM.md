# Software bill of materials

The local quality gate generates `target/menie-sbom.json` from the Rust workspace metadata and the frontend `package.json`. It records the dependency ecosystem, package name, version, and source information without including meeting content or local paths from the user library.

Generate it directly with:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/generate-sbom.ps1
```

The artifact is intended as release evidence and should be archived with a packaged build. It is a dependency inventory, not a vulnerability verdict; dependency and license review remain release responsibilities.
