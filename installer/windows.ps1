# dアニメ Discord Presence+ 利用者向けインストーラ (Windows)
# Discord App ID / Chrome 拡張 ID は配布側で埋め込み済みです。
# 使い方:
#   iwr "https://raw.githubusercontent.com/MametaroGG/d_anime_discord_presence/main/installer/windows.ps1" | iex

$ErrorActionPreference = "Stop"

$NAME = "d_anime_discord_presence_plus"
$EXTENSION_DOMAIN = "com.danime.discord.presence.plus"
$DISCORD_APP_ID = "1530188395987599370"
$EXTENSION_ID = "adddlcolaippknakkcfpdldfmkndlome"
$REPO = "MametaroGG/d_anime_discord_presence"
$INSTALL_DIR = Join-Path $env:LOCALAPPDATA $NAME
$TEMP_DIR = Join-Path $env:TEMP $NAME

Write-Host "[Info] Installing $NAME ..."

if (Test-Path $TEMP_DIR) {
    Remove-Item $TEMP_DIR -Recurse -Force
}
New-Item -Path $TEMP_DIR -ItemType Directory -Force | Out-Null
New-Item -Path $INSTALL_DIR -ItemType Directory -Force | Out-Null

Write-Host "[Info] Downloading latest release ..."
$latest = Invoke-RestMethod -Uri "https://api.github.com/repos/$REPO/releases/latest"
$asset = $latest.assets | Where-Object { $_.name -like "*.exe" } | Select-Object -First 1
if (-not $asset) {
    Write-Host "[Error] No .exe asset found in the latest GitHub Release." -ForegroundColor Red
    Write-Host "Maintainers: publish a release that includes d_anime_discord_presence.exe" -ForegroundColor Yellow
    exit 1
}

$exeTemp = Join-Path $TEMP_DIR "d_anime_discord_presence.exe"
Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $exeTemp -UseBasicParsing

Stop-Process -Name "d_anime_discord_presence" -Force -ErrorAction SilentlyContinue
Start-Sleep -Milliseconds 300

$exeDst = Join-Path $INSTALL_DIR "d_anime_discord_presence.exe"
$exeBak = Join-Path $INSTALL_DIR "d_anime_discord_presence.exe.bak"
if (Test-Path $exeDst) {
    if (Test-Path $exeBak) { Remove-Item $exeBak -Force -ErrorAction SilentlyContinue }
    Move-Item $exeDst $exeBak -Force
}
Copy-Item $exeTemp $exeDst -Force
Stop-Process -Name "d_anime_discord_presence" -Force -ErrorAction SilentlyContinue

$config = @{ app_id = [int64]$DISCORD_APP_ID } | ConvertTo-Json
[System.IO.File]::WriteAllText((Join-Path $INSTALL_DIR "config.json"), $config)

$manifest = [ordered]@{
    name            = $EXTENSION_DOMAIN
    description     = "d-Anime Discord Presence+"
    path            = $exeDst
    type            = "stdio"
    allowed_origins = @("chrome-extension://$EXTENSION_ID/")
}
$jsonPath = Join-Path $INSTALL_DIR "main.json"
[System.IO.File]::WriteAllText($jsonPath, ($manifest | ConvertTo-Json))

$nmKey = "HKCU:\Software\Google\Chrome\NativeMessagingHosts\$EXTENSION_DOMAIN"
New-Item -Path $nmKey -Force | Out-Null
Set-ItemProperty -Path $nmKey -Name "(default)" -Value $jsonPath

# Encourage Chrome to pick up the store extension (same pattern as upstream)
$extKey = "HKCU:\Software\Google\Chrome\Extensions\$EXTENSION_ID"
New-Item -Path $extKey -Force | Out-Null
Set-ItemProperty -Path $extKey -Name "update_url" -Value "https://clients2.google.com/service/update2/crx"

Remove-Item $TEMP_DIR -Recurse -Force -ErrorAction SilentlyContinue

Write-Host ""
Write-Host "Installation completed successfully!" -ForegroundColor Green
Write-Host "1. Install / enable the Chrome extension (Chrome Web Store)"
Write-Host "2. Restart Chrome"
Write-Host "3. Launch Discord, play on dアニメストア"
Write-Host "4. Click the player time so it shows: current / total"
