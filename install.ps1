# Quiet Tab for Windows: builds the small helper exe with the C# compiler that ships
# with Windows, and registers it so the extension can read your wallpaper.
param([switch]$Uninstall)
$ErrorActionPreference = 'Stop'

$dest = Join-Path $env:LOCALAPPDATA 'QuietTab'
$exe  = Join-Path $dest 'QuietTabHelper.exe'
$ext  = Join-Path $PSScriptRoot 'extension'

if ($Uninstall) {
    if (Test-Path $exe) { & $exe --uninstall }
    Write-Host "Helper unregistered. Remove the extension from helium://extensions to finish."
    return
}

$csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path $csc)) { $csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319\csc.exe' }
if (-not (Test-Path $csc)) { throw ".NET Framework 4 compiler not found (it ships with Windows 10/11)." }

New-Item -ItemType Directory -Force $dest | Out-Null
$tmp = Join-Path $dest 'QuietTabHelper.new.exe'
& $csc -nologo -optimize -target:exe "-out:$tmp" -r:System.Drawing.dll -r:System.Management.dll `
    -r:System.Web.Extensions.dll (Join-Path $PSScriptRoot 'helper\QuietTabHelper.cs') | Where-Object { $_ -notmatch 'C# 5|language versions|go.microsoft' }
if ($LASTEXITCODE -ne 0) { throw "Compiling the helper failed." }

# The browser may be running the old helper right now; a running exe can be renamed but not overwritten.
if (Test-Path $exe) {
    Remove-Item "$exe.old" -Force -ErrorAction SilentlyContinue
    try { Remove-Item $exe -Force } catch { Rename-Item $exe "$exe.old" }
}
Move-Item $tmp $exe
& $exe --install

Write-Host ""
Write-Host "Helper installed. One manual step left, in Helium:" -ForegroundColor Cyan
Write-Host "  1. Open helium://extensions and turn on Developer mode (top right)."
Write-Host "  2. Click 'Load unpacked' and choose:  $ext"
Write-Host "  3. Open a new tab. Click the palette button (top right) for colour options."
Write-Host "If it was already loaded, press its reload button (or restart Helium) so it reconnects."
