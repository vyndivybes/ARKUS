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
# Isolated runtime: stdlib, its own DLL directory, then the adjacent packaged app.
@('python313.zip', '.', '../app') | Set-Content -LiteralPath (Join-Path $taskRuntime 'python313._pth') -Encoding Ascii
Write-Output 'Pinned embedded Python 3.13.16 verified and prepared.'
