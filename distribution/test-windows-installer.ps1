param([Parameter(Mandatory=$true)][string]$Installer)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$testRoot = Join-Path (Join-Path $root 'temp') ('installer-smoke-' + [guid]::NewGuid().ToString('N'))
$app = Join-Path $testRoot 'app'
$data = Join-Path $testRoot 'profile\data'
$key = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\{63217C39-F1A7-48D1-9BC3-366859B24099}_is1'
if (Test-Path -LiteralPath $key) { throw '检测到用户已安装的版本；为避免改动其卸载信息，本测试停止。' }
$installerPath = [IO.Path]::GetFullPath($Installer)
New-Item -ItemType Directory -Force -Path $testRoot | Out-Null
$oldData = $env:CLASSMATE_DATA_DIR
$oldLogs = $env:CLASSMATE_LOG_DIR
$oldPort = $env:PORT
$oldToken = $env:TRANSCRIPT_POLISHER_LAUNCH_TOKEN
$serverProcess = $null
$web = New-Object System.Net.WebClient
$web.Proxy = $null
$port = 0
function Stop-TestServer {
  if ($serverProcess -and -not $serverProcess.HasExited) {
    try { $web.Headers['X-Launcher-Token'] = 'installer-smoke'; $web.UploadString("http://127.0.0.1:$port/api/shutdown", 'POST', '') | Out-Null } catch { }
    if (-not $serverProcess.WaitForExit(4000)) { Stop-Process -Id $serverProcess.Id; $serverProcess.WaitForExit() }
  }
}
function Start-TestServer {
  $listener = New-Object System.Net.Sockets.TcpListener([Net.IPAddress]::Loopback, 0)
  $listener.Start(); $script:port = $listener.LocalEndpoint.Port; $listener.Stop()
  $env:PORT = "$port"; $env:CLASSMATE_DATA_DIR = $data; $env:CLASSMATE_LOG_DIR = Join-Path $testRoot 'logs'; $env:TRANSCRIPT_POLISHER_LAUNCH_TOKEN = 'installer-smoke'
  $script:serverProcess = Start-Process -FilePath (Join-Path $app 'runtime\node\node.exe') -ArgumentList 'server.mjs' -WorkingDirectory $app -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $testRoot 'server-out.txt') -RedirectStandardError (Join-Path $testRoot 'server-error.txt')
  for ($attempt=0; $attempt -lt 60; $attempt++) {
    if ($serverProcess.HasExited) { throw '测试服务启动失败。' }
    try {
      $health = $web.DownloadString("http://127.0.0.1:$port/api/health") | ConvertFrom-Json
      if ($health.app -eq 'classmate-lilith') {
        $web.DownloadString("http://127.0.0.1:$port/") | Out-Null
        $web.Headers['Cookie'] = ($web.ResponseHeaders['Set-Cookie'] -split ';')[0]
        return
      }
    } catch { }
    Start-Sleep -Milliseconds 100
  }
  throw '测试服务启动超时。'
}
function Install-TestPackage {
  $parameters = @('/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART','/NOICONS','/TASKS=!desktopicon',('/DIR="'+$app+'"'),('/LOG="'+(Join-Path $testRoot 'install.log')+'"'))
  $result = Start-Process -FilePath $installerPath -ArgumentList $parameters -WindowStyle Hidden -PassThru -Wait
  if ($result.ExitCode -ne 0) { throw "测试安装失败：$($result.ExitCode)" }
  if (-not (Test-Path -LiteralPath (Join-Path $app 'installation.json'))) { throw '安装标记缺失。' }
  if (Select-String -LiteralPath (Join-Path $testRoot 'install.log') -SimpleMatch '-- Icon entry --' -Quiet) { throw '隔离测试意外创建了快捷方式。' }
}
function Post-TestJson([string]$route, $value) {
  $web.Headers['Content-Type'] = 'application/json'
  return $web.UploadString("http://127.0.0.1:$port$route", 'POST', ($value | ConvertTo-Json -Depth 10 -Compress)) | ConvertFrom-Json
}
try {
  Install-TestPackage
  Start-TestServer
  Post-TestJson '/api/settings' @{deepseekApiKey='installer-smoke-fake-key'} | Out-Null
  Post-TestJson '/api/tasks/task-installer-smoke' @{title='安装升级数据保留测试';sourceText='测试正文';workingText='测试校订稿';proseText='测试书面稿'} | Out-Null
  $audio = Join-Path $data 'transcriptions\jobs\smoke\audio-normalized.mp3'
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $audio) | Out-Null
  [IO.File]::WriteAllBytes($audio, [byte[]](0,1,2,3,240,241))
  $beforeSettings = (Get-FileHash -LiteralPath (Join-Path $data 'settings.json')).Hash
  $beforeTask = (Get-FileHash -LiteralPath (Join-Path $data 'tasks\task-installer-smoke.json')).Hash
  $beforeAudio = (Get-FileHash -LiteralPath $audio).Hash
  Stop-TestServer
  Install-TestPackage
  Start-TestServer
  $settings = $web.DownloadString("http://127.0.0.1:$port/api/settings") | ConvertFrom-Json
  $task = $web.DownloadString("http://127.0.0.1:$port/api/tasks/task-installer-smoke") | ConvertFrom-Json
  if (-not $settings.saved.deepseekApiKey -or $task.workingText -ne '测试校订稿') { throw '覆盖安装后历史数据不可用。' }
  Stop-TestServer
  foreach ($pair in @(@((Join-Path $data 'settings.json'),$beforeSettings),@((Join-Path $data 'tasks\task-installer-smoke.json'),$beforeTask),@($audio,$beforeAudio))) {
    if ((Get-FileHash -LiteralPath $pair[0]).Hash -ne $pair[1]) { throw '覆盖安装改变了用户数据。' }
  }
  $uninstall = Start-Process -FilePath (Join-Path $app 'unins000.exe') -ArgumentList @('/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART') -WindowStyle Hidden -PassThru -Wait
  if ($uninstall.ExitCode -ne 0) { throw '卸载测试失败。' }
  if (-not (Test-Path -LiteralPath $audio) -or (Get-FileHash -LiteralPath $audio).Hash -ne $beforeAudio) { throw '卸载移除了用户录音。' }
  if (Test-Path -LiteralPath $key) { throw '卸载信息没有清理完成。' }
  [pscustomobject]@{Install=$true;Reinstall=$true;HistoryRetained=$true;CredentialsRetained=$true;AudioRetained=$true;UninstallRetainsData=$true;TestDirectory=$testRoot}
} finally {
  Stop-TestServer
  $cleanup = Join-Path $app 'unins000.exe'
  if (Test-Path -LiteralPath $cleanup) {
    $registered = Get-ItemProperty -LiteralPath $key -ErrorAction SilentlyContinue
    if ($registered -and ([string]$registered.InstallLocation).TrimEnd('\') -eq $app.TrimEnd('\')) {
      Start-Process -FilePath $cleanup -ArgumentList @('/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART') -WindowStyle Hidden -PassThru -Wait | Out-Null
    }
  }
  $web.Dispose()
  $env:CLASSMATE_DATA_DIR=$oldData; $env:CLASSMATE_LOG_DIR=$oldLogs; $env:PORT=$oldPort; $env:TRANSCRIPT_POLISHER_LAUNCH_TOKEN=$oldToken
}
