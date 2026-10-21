param([Parameter(Mandatory=$true)][string]$PackageRoot)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$testParent = [IO.Path]::GetFullPath((Join-Path $root 'temp'))
$testRoot = [IO.Path]::GetFullPath((Join-Path $testParent ('launcher-storage-' + [guid]::NewGuid().ToString('N'))))
if (-not $testRoot.StartsWith($testParent + '\', [StringComparison]::OrdinalIgnoreCase)) { throw '测试目录越界。' }
New-Item -ItemType Directory -Path $testRoot | Out-Null
foreach ($file in @('Classmate Lilith.exe','Microsoft.Web.WebView2.Core.dll','Microsoft.Web.WebView2.WinForms.dll','WebView2Loader.dll')) {
  Copy-Item -LiteralPath (Join-Path $PackageRoot $file) -Destination (Join-Path $testRoot $file)
}
'{"mode":"installed"}' | Set-Content -LiteralPath (Join-Path $testRoot 'installation.json') -Encoding ascii
$compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
$probe = Join-Path $testRoot 'StorageProbe.exe'
& $compiler /nologo /target:exe "/out:$probe" /reference:System.dll (Join-Path $root 'test\fixtures\windows-storage-probe.cs')
if ($LASTEXITCODE -ne 0) { throw '原生存储路径探针编译失败。' }
$run = Start-Process -FilePath $probe -WorkingDirectory $testRoot -WindowStyle Hidden -PassThru -Wait -RedirectStandardOutput (Join-Path $testRoot 'probe-out.txt') -RedirectStandardError (Join-Path $testRoot 'probe-error.txt')
if ($run.ExitCode -ne 0) { throw (Get-Content -LiteralPath (Join-Path $testRoot 'probe-error.txt') -Raw) }
Get-Content -LiteralPath (Join-Path $testRoot 'probe-out.txt')
