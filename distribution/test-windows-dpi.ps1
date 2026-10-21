param([Parameter(Mandatory=$true)][string]$PackageRoot)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$testParent = [IO.Path]::GetFullPath((Join-Path $root 'temp'))
$testRoot = [IO.Path]::GetFullPath((Join-Path $testParent ('dpi-probe-' + [guid]::NewGuid().ToString('N'))))
if (-not $testRoot.StartsWith($testParent + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'DPI 测试目录越界。' }
New-Item -ItemType Directory -Path $testRoot | Out-Null
foreach ($file in @('Classmate Lilith.exe','Microsoft.Web.WebView2.Core.dll','Microsoft.Web.WebView2.WinForms.dll','WebView2Loader.dll')) {
  Copy-Item -LiteralPath (Join-Path $PackageRoot $file) -Destination (Join-Path $testRoot $file)
}
$compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
$probe = Join-Path $testRoot 'DpiProbe.exe'
Copy-Item -LiteralPath (Join-Path $PackageRoot 'Classmate Lilith.exe.config') -Destination ($probe + '.config')
& $compiler /nologo /target:exe "/out:$probe" "/win32manifest:$(Join-Path $root 'launcher\app.manifest')" /reference:System.dll /reference:System.Drawing.dll /reference:System.Windows.Forms.dll "/reference:$(Join-Path $testRoot 'Microsoft.Web.WebView2.Core.dll')" "/reference:$(Join-Path $testRoot 'Microsoft.Web.WebView2.WinForms.dll')" (Join-Path $root 'test\fixtures\windows-dpi-probe.cs')
if ($LASTEXITCODE -ne 0) { throw 'DPI 测试程序编译失败。' }
$run = Start-Process -FilePath $probe -WorkingDirectory $testRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $testRoot 'probe-out.txt') -RedirectStandardError (Join-Path $testRoot 'probe-error.txt')
if (-not $run.WaitForExit(45000)) {
  Stop-Process -Id $run.Id
  throw "DPI 测试超时，仅终止了隔离探针。测试目录：$testRoot"
}
if ($run.ExitCode -ne 0) { throw (Get-Content -LiteralPath (Join-Path $testRoot 'probe-error.txt') -Raw) }
Get-Content -LiteralPath (Join-Path $testRoot 'probe-out.txt')
