$ErrorActionPreference = 'Stop'
$taskRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$taskWork = Join-Path $taskRoot 'work'
$taskRuntime = Join-Path $taskWork 'python-runtime'
$taskZip = Join-Path $taskWork 'python-3.13.16-embed-amd64.zip'
# Official PSF release checksum: https://www.python.org/downloads/release/python-31316/
$expected = '97dae5274cc54867065e8d5a3226e48c35017ed332a0fdb0e27d5b5821961297'
New-Item -ItemType Directory -Force -Path $taskWork | Out-Null
if (-not (Test-Path -LiteralPath $taskZip)) {
    Invoke-WebRequest -Uri 'https://www.python.org/ftp/python/3.13.16/python-3.13.16-embed-amd64.zip' -OutFile $taskZip
}
$sha = [Security.Cryptography.SHA256]::Create()
try { $actual = [BitConverter]::ToString($sha.ComputeHash([IO.File]::ReadAllBytes($taskZip))).Replace('-', '').ToLowerInvariant() } finally { $sha.Dispose() }
if ($actual -ne $expected) {
    throw 'Embedded Python checksum mismatch. No runtime was extracted.'
}
if (-not (Test-Path -LiteralPath (Join-Path $taskRuntime 'python.exe'))) {
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    [IO.Compression.ZipFile]::ExtractToDirectory($taskZip, $taskRuntime)
}
# BSD-3-Clause pypdf (pure Python): vendor the exact wheel after checksum
# verification so packaged Windows users can index real text-based PDFs.
$wheelName = 'pypdf-6.0.0-py3-none-any.whl'
$wheelFile = Join-Path $taskWork $wheelName
$wheelHash = '56ea60100ce9f11fc3eec4f359da15e9aec3821b036c1f06d2b660d35683abb8'
if (-not (Test-Path -LiteralPath $wheelFile)) {
    & python -m pip download --only-binary=:all: --no-deps 'pypdf==6.0.0' -d $taskWork
    if ($LASTEXITCODE -ne 0) { throw 'Could not download pinned PDF parsing dependency.' }
}
$actualWheel = (Get-FileHash -LiteralPath $wheelFile -Algorithm SHA256).Hash.ToLowerInvariant()
if ($actualWheel -ne $wheelHash) { throw 'pypdf wheel checksum mismatch.' }
$vendor = Join-Path $taskRuntime 'vendor'
if (-not (Test-Path -LiteralPath (Join-Path $vendor 'pypdf'))) {
    New-Item -ItemType Directory -Force -Path $vendor | Out-Null
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    [IO.Compression.ZipFile]::ExtractToDirectory($wheelFile, $vendor)
}
# Isolated runtime: stdlib, bundled and checksum-verified PDF parser, app code.
@('python313.zip', '.', 'vendor', '../app') | Set-Content -LiteralPath (Join-Path $taskRuntime 'python313._pth') -Encoding Ascii
& (Join-Path $taskRuntime 'python.exe') -c 'import pypdf; print("Bundled PDF text parser import PASS")'
if ($LASTEXITCODE -ne 0) { throw 'Bundled PDF text parser unavailable.' }
Write-Output 'Pinned embedded Python and pypdf verified and prepared.'
