# Create Chrome Web Store zip (manifest without "key"; include key.pem for stable ID on first upload)
$ErrorActionPreference = "Stop"

$ROOT = Resolve-Path (Join-Path $PSScriptRoot "..")
$EXT = Join-Path $ROOT "extension"
$OUT_DIR = Join-Path $ROOT "dist"
$ZIP = Join-Path $OUT_DIR "danime-discord-presence-plus-store.zip"
$PEM = Join-Path $EXT "key.pem"

if (-not (Test-Path $PEM)) {
    Write-Host "[Error] extension/key.pem not found. Needed for stable store ID on first upload." -ForegroundColor Red
    exit 1
}

New-Item -Path $OUT_DIR -ItemType Directory -Force | Out-Null
if (Test-Path $ZIP) { Remove-Item $ZIP -Force }

$stage = Join-Path $OUT_DIR "store-stage"
if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
New-Item -Path $stage -ItemType Directory -Force | Out-Null

Copy-Item (Join-Path $EXT "*") $stage -Recurse -Force
Remove-Item (Join-Path $stage "key.pem") -Force -ErrorAction SilentlyContinue
Remove-Item (Join-Path $stage "pub.der") -Force -ErrorAction SilentlyContinue
Remove-Item (Join-Path $stage "extension_id.txt") -Force -ErrorAction SilentlyContinue

$manifestPath = Join-Path $stage "manifest.json"
$manifest = Get-Content $manifestPath -Raw | ConvertFrom-Json
$manifest.PSObject.Properties.Remove("key")
# homepage_url should point to your privacy policy / repo after you fork
$manifest | ConvertTo-Json -Depth 10 | Set-Content -Path $manifestPath -Encoding utf8

Copy-Item $PEM (Join-Path $stage "key.pem") -Force

Compress-Archive -Path (Join-Path $stage "*") -DestinationPath $ZIP -Force
Remove-Item $stage -Recurse -Force

Write-Host "Created: $ZIP" -ForegroundColor Green
Write-Host "Upload this zip to Chrome Developer Dashboard."
Write-Host "After first upload, copy Item ID and run installer with -ExtensionId <id>"
