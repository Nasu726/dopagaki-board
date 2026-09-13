$ErrorActionPreference = 'Stop'
$src = Join-Path $PSScriptRoot '..\src-tauri\icons\icon.ico.b64'
$dst = Join-Path $PSScriptRoot '..\src-tauri\icons\icon.ico'
[IO.File]::WriteAllBytes($dst, [Convert]::FromBase64String((Get-Content $src -Raw).Trim()))
