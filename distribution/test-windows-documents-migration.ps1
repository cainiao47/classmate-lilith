param(
  [Parameter(Mandatory=$true)][string]$PackageRoot,
  [string]$InnoCompiler = (Join-Path (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)) 'tools\inno-setup\ISCC.exe')
)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$testParent = [IO.Path]::GetFullPath((Join-Path $root 'temp'))
$testRoot = [IO.Path]::GetFullPath((Join-Path $testParent ('documents-migration-' + [guid]::NewGuid().ToString('N'))))
if (-not $testRoot.StartsWith($testParent + '\', [StringComparison]::OrdinalIgnoreCase)) { throw '测试目录越界。' }
$app = Join-Path $testRoot 'app'
$legacy = Join-Path $testRoot 'legacy-profile\Classmate Lilith'
$destination = Join-Path $testRoot 'redirected-documents\Classmate Lilith'
$payload = Join-Path $testRoot 'payload'
$output = Join-Path $testRoot 'compiler-output'
$key = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\{63217C39-F1A7-48D1-9BC3-366859B24099}_is1'
if (Test-Path -LiteralPath $key) { throw '检测到用户已安装版本，停止隔离测试。' }
foreach ($directory in @((Join-Path $payload 'assets'),(Join-Path $payload 'runtime\node'),(Join-Path $payload 'lib'),(Join-Path $payload 'distribution'),$output,(Join-Path $legacy 'data\tasks'),(Join-Path $legacy 'data\transcriptions\jobs\legacy-job'),(Join-Path $legacy 'data\webview2'))) {
  New-Item -ItemType Directory -Path $directory -Force | Out-Null
}
Copy-Item -LiteralPath (Join-Path $root 'assets\app.ico') -Destination (Join-Path $payload 'assets\app.ico')
Copy-Item -LiteralPath (Join-Path $PackageRoot 'runtime\node\node.exe') -Destination (Join-Path $payload 'runtime\node\node.exe')
foreach ($name in @('portable-migration.mjs','json-file.mjs')) {
  Copy-Item -LiteralPath (Join-Path $root "lib\$name") -Destination (Join-Path $payload "lib\$name")
}
Copy-Item -LiteralPath (Join-Path $root 'distribution\migrate-portable.mjs') -Destination (Join-Path $payload 'distribution\migrate-portable.mjs')
$version = (Get-Content -LiteralPath (Join-Path $root 'package.json') -Raw | ConvertFrom-Json).version
@{format=1;mode='installed';version=$version} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $payload 'installation.json') -Encoding ascii
'{"format":"portable-light-encryption-v3","deepseek_api_key":"test-only-never-a-real-key"}' | Set-Content -LiteralPath (Join-Path $legacy 'data\settings.json') -Encoding utf8NoBOM
@{id='task-documents-test';title='迁移测试';workingText='保留原始工程';prosePlan='保留整理规划'} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $legacy 'data\tasks\task-documents-test.json') -Encoding utf8NoBOM
$oldAudio = Join-Path $legacy 'data\transcriptions\jobs\legacy-job\audio.mp3'
[IO.File]::WriteAllBytes($oldAudio, [byte[]](0,1,2,3,240,241))
@{normalizedPath=$oldAudio;sourcePath=$oldAudio} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $legacy 'data\transcriptions\jobs\legacy-job\job-meta.json') -Encoding utf8NoBOM
'old-shutdown-credential' | Set-Content -LiteralPath (Join-Path $legacy 'data\.launcher-token')
'invalid browser cache JSON' | Set-Content -LiteralPath (Join-Path $legacy 'data\webview2\cache.json')
$before = (Get-FileHash -LiteralPath (Join-Path $legacy 'data\settings.json')).Hash
& $InnoCompiler '/Q' "/DAppVersion=$version" "/DPackageRoot=$payload" "/DOutputRoot=$output" '/DBuildCompression=none' '/DUninstallTestBuild=1' "/DTestUserDataRoot=$destination" "/DTestLegacyDataRoot=$legacy" (Join-Path $PSScriptRoot 'windows-installer.iss')
if ($LASTEXITCODE -ne 0) { throw '隔离迁移安装器编译失败。' }
$installer = Join-Path $output "Classmate-Lilith-Setup-$version.exe"
function Install-Fixture {
  $run = Start-Process -FilePath $installer -ArgumentList @('/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART','/NOICONS','/TASKS=!desktopicon',('/DIR="'+$app+'"'),('/LOG="'+(Join-Path $testRoot 'install.log')+'"')) -WindowStyle Hidden -PassThru -Wait
  if ($run.ExitCode -ne 0) { throw "隔离安装或迁移失败：$($run.ExitCode)" }
}
try {
  Install-Fixture
  $newData = Join-Path $destination 'data'
  foreach ($settingsFile in @((Join-Path $legacy 'data\settings.json'),(Join-Path $newData 'settings.json'))) {
    if ((Get-FileHash -LiteralPath $settingsFile).Hash -ne $before) { throw '迁移改变了配置字节。' }
  }
  $meta = Get-Content -LiteralPath (Join-Path $newData 'transcriptions\jobs\legacy-job\job-meta.json') -Raw | ConvertFrom-Json
  $newAudio = Join-Path $newData 'transcriptions\jobs\legacy-job\audio.mp3'
  if ($meta.normalizedPath -ne $newAudio -or (Get-FileHash -LiteralPath $newAudio).Hash -ne (Get-FileHash -LiteralPath $oldAudio).Hash) { throw '录音路径迁移失败。' }
  if ((Test-Path -LiteralPath (Join-Path $newData '.launcher-token')) -or (Test-Path -LiteralPath (Join-Path $newData 'webview2'))) { throw '不应迁移运行期令牌或窗口缓存。' }
  $taskFile = Join-Path $newData 'tasks\task-documents-test.json'
  $taskBefore = (Get-FileHash -LiteralPath $taskFile).Hash
  '{"title":"另一个旧副本，不得覆盖新文档数据"}' | Set-Content -LiteralPath (Join-Path $legacy 'data\tasks\task-documents-test.json') -Encoding utf8NoBOM
  Install-Fixture
  if ((Get-FileHash -LiteralPath $taskFile).Hash -ne $taskBefore) { throw '重装覆盖了文档目录的已有数据。' }
  [pscustomobject]@{LegacyAutoDetected=$true;DocumentsMigration=$true;CredentialsBytesRetained=$true;AudioPathRemapped=$true;OriginalPreserved=$true;ExistingDocumentsNotOverwritten=$true;TestDirectory=$testRoot}
} finally {
  $uninstaller = Join-Path $app 'unins000.exe'
  if (Test-Path -LiteralPath $uninstaller) {
    $registered = Get-ItemProperty -LiteralPath $key -ErrorAction SilentlyContinue
    if ($registered -and ([string]$registered.InstallLocation).TrimEnd('\') -eq $app.TrimEnd('\')) {
      Start-Process -FilePath $uninstaller -ArgumentList @('/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART') -WindowStyle Hidden -PassThru -Wait | Out-Null
    }
  }
}
