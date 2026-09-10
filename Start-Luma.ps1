$ErrorActionPreference = 'Stop'
$lumaRoot = $PSScriptRoot
$lumaVersion = (Get-Content -LiteralPath (Join-Path $lumaRoot 'package.json') -Raw | ConvertFrom-Json).version
$lumaPortable = Join-Path $lumaRoot ('release\Luma-Studio-' + $lumaVersion + '-Windows.exe')
$lumaUnpacked = Join-Path $lumaRoot 'release\win-unpacked\Luma Studio.exe'
if (Test-Path -LiteralPath $lumaUnpacked) {
    Start-Process -FilePath $lumaUnpacked -WorkingDirectory (Split-Path $lumaUnpacked) -WindowStyle Hidden
} elseif (Test-Path -LiteralPath $lumaPortable) {
    Start-Process -FilePath $lumaPortable -WorkingDirectory $lumaRoot -WindowStyle Hidden
} else {
    Push-Location -LiteralPath $lumaRoot
    try {
        if (-not (Test-Path -LiteralPath 'node_modules\electron')) { npm.cmd ci }
        if (-not (Test-Path -LiteralPath 'dist\index.html')) { npm.cmd run build }
        Remove-Item -LiteralPath 'Env:\ELECTRON_RUN_AS_NODE' -ErrorAction SilentlyContinue
        Start-Process -FilePath (Join-Path $lumaRoot 'node_modules\electron\dist\electron.exe') -ArgumentList ('"' + $lumaRoot + '"') -WorkingDirectory $lumaRoot -WindowStyle Hidden
    } finally { Pop-Location }
}
