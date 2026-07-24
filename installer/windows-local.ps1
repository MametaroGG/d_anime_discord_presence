# Install local build with thumbnail support (user-local, no admin required)
$ErrorActionPreference = "Stop"

$NAME = "d_anime_discord_presence"
$EXTENSION_DOMAIN = "com.dadp.discord.presence"
$STORE_EXTENSION_ID = "ifenbhbjocjihjlmbbmdegolkpjmecag"
$LOCAL_EXTENSION_ID = "adddlcolaippknakkcfpdldfmkndlome"

$ROOT = Resolve-Path (Join-Path $PSScriptRoot "..")
Push-Location $ROOT
$targetDir = (cargo metadata --format-version 1 --no-deps | ConvertFrom-Json).target_directory
Pop-Location
$EXE_SRC = Join-Path $targetDir "release\d_anime_discord_presence.exe"
if (-not (Test-Path $EXE_SRC)) {
    Write-Host "[Error] Build the release binary first: cargo build --release" -ForegroundColor Red
    Write-Host "Looked for: $EXE_SRC"
    exit 1
}

$INSTALL_DIR = Join-Path $env:LOCALAPPDATA $NAME
New-Item -Path $INSTALL_DIR -ItemType Directory -Force | Out-Null
$EXE_DST = Join-Path $INSTALL_DIR "$NAME.exe"
Copy-Item $EXE_SRC $EXE_DST -Force

$manifest = [ordered]@{
    name = $EXTENSION_DOMAIN
    description = "d-Anime Discord Presence"
    path = $EXE_DST
    type = "stdio"
    allowed_origins = @(
        "chrome-extension://$LOCAL_EXTENSION_ID/"
        "chrome-extension://$STORE_EXTENSION_ID/"
    )
}
$jsonPath = Join-Path $INSTALL_DIR "main.json"
$manifest | ConvertTo-Json | Set-Content -Path $jsonPath -Encoding utf8

$nmKey = "HKCU:\Software\Google\Chrome\NativeMessagingHosts\$EXTENSION_DOMAIN"
New-Item -Path $nmKey -Force | Out-Null
Set-ItemProperty -Path $nmKey -Name "(default)" -Value $jsonPath

Write-Host "Installed host to: $INSTALL_DIR" -ForegroundColor Green
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Cyan
Write-Host "1. Open chrome://extensions"
Write-Host "2. Enable Developer mode"
Write-Host "3. Disable the Chrome Web Store version of danimediscordpresence (if installed)"
Write-Host "4. Load unpacked -> select:"
Write-Host "   $(Join-Path $ROOT 'extension')"
Write-Host "5. Confirm extension ID is: $LOCAL_EXTENSION_ID"
Write-Host "6. Restart Chrome, open Discord, play d-anime"
