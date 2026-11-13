$ErrorActionPreference = 'Stop'
$projectDir = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectDir
$goCommand = Get-Command go -ErrorAction SilentlyContinue
if ($goCommand) { $goExe = $goCommand.Source }
elseif (Test-Path -LiteralPath '.tools\go\bin\go.exe') { $goExe = (Resolve-Path '.tools\go\bin\go.exe').Path }
else { throw '请先安装 Go 1.25 或更新版本。' }
$env:CGO_ENABLED = '0'
& $goExe run github.com/tc-hib/go-winres@v0.3.3 make --arch amd64
if ($LASTEXITCODE -ne 0) { throw '图标与窗口清单生成失败' }
New-Item -ItemType Directory -Force -Path 'dist' | Out-Null
& $goExe build -trimpath -tags 'desktop,production' -ldflags '-s -w -H=windowsgui' -o 'dist\Shiyin-NCM-2.0.0.exe' .
if ($LASTEXITCODE -ne 0) { throw 'Go 编译失败' }
Copy-Item -LiteralPath 'dist\Shiyin-NCM-2.0.0.exe' -Destination 'Shiyin-NCM.exe' -Force
Get-Item -LiteralPath 'Shiyin-NCM.exe' | Select-Object Name,Length
