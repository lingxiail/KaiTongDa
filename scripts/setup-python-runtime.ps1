$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$pythonRuntimeDir = Join-Path $repoRoot "src-tauri" "python-runtime"
$tempDir = Join-Path $repoRoot "tmp-python-download"

# 清理旧目录
if (Test-Path $pythonRuntimeDir) {
    Remove-Item -Recurse -Force $pythonRuntimeDir
}
if (Test-Path $tempDir) {
    Remove-Item -Recurse -Force $tempDir
}

New-Item -ItemType Directory -Force -Path $tempDir | Out-Null

$url = "https://github.com/indygreg/python-build-standalone/releases/download/20250106/cpython-3.12.8+20250106-x86_64-pc-windows-msvc-install_only.tar.gz"
$tarPath = Join-Path $tempDir "python.tar.gz"

Write-Host "[setup-python] Downloading Windows Python runtime..."
Invoke-WebRequest -Uri $url -OutFile $tarPath

Write-Host "[setup-python] Extracting..."
tar -xzf $tarPath -C $tempDir

$extractedPython = Join-Path $tempDir "python"
if (Test-Path $extractedPython) {
    Move-Item -Path $extractedPython -Destination $pythonRuntimeDir
} else {
    New-Item -ItemType Directory -Force -Path $pythonRuntimeDir | Out-Null
    Get-ChildItem -Path $tempDir -Exclude "python.tar.gz" | Move-Item -Destination $pythonRuntimeDir
}

Remove-Item -Recurse -Force $tempDir
Write-Host "[setup-python] Done. python-runtime is ready at: $pythonRuntimeDir"
