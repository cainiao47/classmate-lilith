param(
  [Parameter(Mandatory=$true)][string]$PackageRoot,
  [string]$OutputRoot = (Join-Path (Split-Path -Parent $PSScriptRoot) 'dist'),
  [string]$InnoCompiler = $env:INNO_COMPILER,
  [switch]$FastTestBuild
)
$ErrorActionPreference = 'Stop'
$source = Split-Path -Parent $PSScriptRoot
$version = (Get-Content -LiteralPath (Join-Path $source 'package.json') -Raw | ConvertFrom-Json).version
$package = [IO.Path]::GetFullPath($PackageRoot)
$output = [IO.Path]::GetFullPath($OutputRoot)
if (-not $InnoCompiler) {
  $candidates = @((Join-Path (Split-Path -Parent $source) 'tools\inno-setup\ISCC.exe'), (Join-Path ${env:ProgramFiles(x86)} 'Inno Setup 6\ISCC.exe'), (Join-Path $env:ProgramFiles 'Inno Setup 7\ISCC.exe'))
  $InnoCompiler = $candidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
}
if (-not $InnoCompiler -or -not (Test-Path -LiteralPath $InnoCompiler)) { throw '请安装 Inno Setup，或通过 -InnoCompiler 指定 ISCC.exe。' }
foreach ($file in @('Classmate Lilith.exe','UpdateHelper.exe','runtime\node\node.exe','distribution\windows-update-public.pem')) {
  if (-not (Test-Path -LiteralPath (Join-Path $package $file))) { throw "安装文件不完整：$file" }
}
New-Item -ItemType Directory -Force -Path $output | Out-Null
$stage = Join-Path $output ('installer-payload-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $stage | Out-Null
Copy-Item -Path (Join-Path $package '*') -Destination $stage -Recurse -Force
foreach ($name in @('data','logs')) {
  $target = [IO.Path]::GetFullPath((Join-Path $stage $name))
  if (-not $target.StartsWith($stage + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw '安装暂存目录越界。' }
  if (Test-Path -LiteralPath $target) { Remove-Item -LiteralPath $target -Recurse -Force }
}
@{format=1; platform='win32'; mode='installed'; version=$version} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $stage 'installation.json') -Encoding ascii
$compilerArgs = @('/Qp', "/DAppVersion=$version", "/DPackageRoot=$stage", "/DOutputRoot=$output")
if ($FastTestBuild) { $compilerArgs += '/DBuildCompression=none' }
& $InnoCompiler @compilerArgs (Join-Path $PSScriptRoot 'windows-installer.iss')
if ($LASTEXITCODE -ne 0) { throw 'Windows 安装包编译失败。' }
$installer = Join-Path $output "Classmate-Lilith-Setup-$version.exe"
& node (Join-Path $PSScriptRoot 'sign-windows-update.mjs') --installer $installer --output (Join-Path $output 'windows-update.json')
if ($LASTEXITCODE -ne 0) { throw 'Windows 更新清单签名失败，请配置发布签名私钥。' }
[pscustomobject]@{Version=$version;Installer=$installer;MiB=[math]::Round((Get-Item -LiteralPath $installer).Length/1MB,1);UpdateManifest=(Join-Path $output 'windows-update.json')}
