# Install host for dアニメ Discord Presence+ (user-local, no admin required)
param(
    [Parameter(Mandatory = $false)]
    [string]$DiscordAppId = "",

    [Parameter(Mandatory = $false)]
    [string]$ExtensionId = "adddlcolaippknakkcfpdldfmkndlome",

    [switch]$UseFallback
)

$ErrorActionPreference = "Stop"

$NAME = "d_anime_discord_presence_plus"
$EXTENSION_DOMAIN = "com.danime.discord.presence.plus"
$ROOT = Resolve-Path (Join-Path $PSScriptRoot "..")

Push-Location $ROOT
$targetDir = (cargo metadata --format-version 1 --no-deps | ConvertFrom-Json).target_directory
Pop-Location
$EXE_SRC = Join-Path $targetDir "release\d_anime_discord_presence.exe"
if (-not (Test-Path $EXE_SRC)) {
    Write-Host "[Error] Build first: cargo build --release" -ForegroundColor Red
    Write-Host "Looked for: $EXE_SRC"
    exit 1
}

if ($UseFallback) {
    $DiscordAppId = ""
} elseif (-not $DiscordAppId) {
    $DiscordAppId = Read-Host "Discord Application ID (EnterでフォールバックIDを使用 / 公開前は必ず自分のIDを指定)"
}
if ([string]::IsNullOrWhiteSpace($DiscordAppId)) {
    Write-Host "[Warn] Using built-in fallback Discord App ID. Replace before public release." -ForegroundColor Yellow
    $writeConfig = $false
} elseif ($DiscordAppId -notmatch '^\d{17,20}$') {
    Write-Host "[Error] Invalid Discord Application ID: $DiscordAppId" -ForegroundColor Red
    exit 1
} else {
    $writeConfig = $true
}

$INSTALL_DIR = Join-Path $env:LOCALAPPDATA $NAME
New-Item -Path $INSTALL_DIR -ItemType Directory -Force | Out-Null

Stop-Process -Name "d_anime_discord_presence" -Force -ErrorAction SilentlyContinue
Start-Sleep -Milliseconds 500

$EXE_DST = Join-Path $INSTALL_DIR "d_anime_discord_presence.exe"
Copy-Item $EXE_SRC $EXE_DST -Force

$configPath = Join-Path $INSTALL_DIR "config.json"
if ($writeConfig) {
    $config = @{ app_id = [int64]$DiscordAppId } | ConvertTo-Json
    [System.IO.File]::WriteAllText($configPath, $config)
} elseif (Test-Path $configPath) {
    Remove-Item $configPath -Force
}

$manifest = [ordered]@{
    name            = $EXTENSION_DOMAIN
    description     = "d-Anime Discord Presence+"
    path            = $EXE_DST
    type            = "stdio"
    allowed_origins = @("chrome-extension://$ExtensionId/")
}
$jsonPath = Join-Path $INSTALL_DIR "main.json"
[System.IO.File]::WriteAllText($jsonPath, ($manifest | ConvertTo-Json))

$nmKey = "HKCU:\Software\Google\Chrome\NativeMessagingHosts\$EXTENSION_DOMAIN"
New-Item -Path $nmKey -Force | Out-Null
Set-ItemProperty -Path $nmKey -Name "(default)" -Value $jsonPath

Write-Host "Installed host to: $INSTALL_DIR" -ForegroundColor Green
Write-Host "Native host: $EXTENSION_DOMAIN"
Write-Host "Extension ID: $ExtensionId"
if ($writeConfig) {
    Write-Host "Discord App ID: $DiscordAppId"
} else {
    Write-Host "Discord App ID: (fallback)"
}
Write-Host ""
Write-Host "If this is for Chrome Web Store, re-run with -ExtensionId <store-item-id> after publish."
