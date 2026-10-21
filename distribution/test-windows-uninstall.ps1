param([string]$InnoCompiler = (Join-Path (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)) 'tools\inno-setup\ISCC.exe'))
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$testParent = [IO.Path]::GetFullPath((Join-Path $root 'temp'))
$testRoot = [IO.Path]::GetFullPath((Join-Path $testParent ('uninstall-choices-' + [guid]::NewGuid().ToString('N'))))
if (-not $testRoot.StartsWith($testParent + '\', [StringComparison]::OrdinalIgnoreCase)) { throw '测试目录越界。' }
$app = Join-Path $testRoot 'app'
$userData = Join-Path $testRoot 'isolated-profile\Classmate Lilith'
$outside = Join-Path $testRoot 'separate-backup'
$payload = Join-Path $testRoot 'payload'
$output = Join-Path $testRoot 'compiler-output'
$key = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\{63217C39-F1A7-48D1-9BC3-366859B24099}_is1'
if (Test-Path -LiteralPath $key) { throw '检测到用户已安装版本，停止测试以保护其卸载登记。' }
foreach ($directory in @((Join-Path $payload 'assets'), $output, (Join-Path $userData 'data'), (Join-Path $userData 'updates'), $outside)) {
  New-Item -ItemType Directory -Force -Path $directory | Out-Null
}
Copy-Item -LiteralPath (Join-Path $root 'assets\app.ico') -Destination (Join-Path $payload 'assets\app.ico')
'synthetic program payload, never executable' | Set-Content -LiteralPath (Join-Path $payload 'fixture.txt')
'synthetic personal data' | Set-Content -LiteralPath (Join-Path $userData 'data\settings.json')
'synthetic update backup' | Set-Content -LiteralPath (Join-Path $userData 'updates\backup.txt')
'independent backup must survive' | Set-Content -LiteralPath (Join-Path $outside 'keep.txt')
New-Item -ItemType Junction -Path (Join-Path $userData 'linked-backup') -Value $outside | Out-Null
$before = (Get-FileHash -LiteralPath (Join-Path $userData 'data\settings.json')).Hash
$version = (Get-Content -LiteralPath (Join-Path $root 'package.json') -Raw | ConvertFrom-Json).version
& $InnoCompiler '/Q' "/DAppVersion=$version" "/DPackageRoot=$payload" "/DOutputRoot=$output" '/DBuildCompression=none' '/DUninstallTestBuild=1' "/DTestUserDataRoot=$userData" (Join-Path $PSScriptRoot 'windows-installer.iss')
if ($LASTEXITCODE -ne 0) { throw '卸载隔离测试编译失败。' }
$installer = Join-Path $output "Classmate-Lilith-Setup-$version.exe"
function Install-Fixture {
  $run = Start-Process -FilePath $installer -ArgumentList @('/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART','/NOICONS','/TASKS=!desktopicon',('/DIR="'+$app+'"')) -WindowStyle Hidden -PassThru -Wait
  if ($run.ExitCode -ne 0) { throw "隔离安装失败：$($run.ExitCode)" }
}
function Uninstall-Fixture([string]$choice) {
  $run = Start-Process -FilePath (Join-Path $app 'unins000.exe') -ArgumentList @('/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART',('/TESTCHOICE='+$choice),('/LOG="'+(Join-Path $testRoot ('uninstall-'+$choice+'.log'))+'"')) -WindowStyle Hidden -PassThru -Wait
  return $run.ExitCode
}
try {
  Install-Fixture
  if ((Uninstall-Fixture 'cancel') -eq 0 -or -not (Test-Path -LiteralPath (Join-Path $app 'fixture.txt'))) { throw '取消卸载没有保留程序。' }
  if ((Get-FileHash -LiteralPath (Join-Path $userData 'data\settings.json')).Hash -ne $before) { throw '取消卸载改变了测试数据。' }
  if ((Uninstall-Fixture 'keep') -ne 0) { throw '保留数据卸载失败。' }
  if ((Get-FileHash -LiteralPath (Join-Path $userData 'data\settings.json')).Hash -ne $before) { throw '保留模式删除或修改了测试数据。' }
  Install-Fixture
  if ((Uninstall-Fixture 'delete') -ne 0) { throw '删除数据卸载失败。' }
  if (Test-Path -LiteralPath $userData) { throw '删除模式没有清理隔离数据目录。' }
  if (-not (Test-Path -LiteralPath (Join-Path $outside 'keep.txt'))) { throw '删除模式越界删除了独立备份。' }
  if (Test-Path -LiteralPath $key) { throw '测试卸载登记未清理。' }
  [pscustomobject]@{CancelKeepsProgram=$true;KeepRetainsData=$true;DeleteRemovesData=$true;IndependentBackupRetained=$true;JunctionTargetRetained=$true;TestDirectory=$testRoot}
} finally {
  if (Test-Path -LiteralPath (Join-Path $app 'unins000.exe')) {
    $registered = Get-ItemProperty -LiteralPath $key -ErrorAction SilentlyContinue
    if ($registered -and ([string]$registered.InstallLocation).TrimEnd('\') -eq $app.TrimEnd('\')) { Uninstall-Fixture 'keep' | Out-Null }
  }
}
