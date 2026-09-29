param(
  [string]$SourceRoot = (Split-Path -Parent $PSScriptRoot),
  [string]$RuntimeSeed = $env:CLASSMATE_RUNTIME_SEED,
  [string]$OutputRoot = (Join-Path (Split-Path -Parent $PSScriptRoot) 'dist')
)

$ErrorActionPreference = 'Stop'
$source = [IO.Path]::GetFullPath($SourceRoot)
$output = [IO.Path]::GetFullPath($OutputRoot)
$target = [IO.Path]::GetFullPath((Join-Path $output 'Classmate-Lilith-Windows-x64'))
$archive = [IO.Path]::GetFullPath((Join-Path $output 'Classmate-Lilith-Windows-x64.zip'))

if (-not $RuntimeSeed) { throw '请通过 -RuntimeSeed 或 CLASSMATE_RUNTIME_SEED 指定一个包含 runtime\node 和 FFmpeg 的本机构建种子目录。' }
$seed = [IO.Path]::GetFullPath($RuntimeSeed)
$node = Join-Path $seed 'runtime\node\node.exe'
$ffmpeg = Join-Path $seed 'runtime\ffmpeg\ffmpeg.exe'
if (-not (Test-Path -LiteralPath $node)) { throw "缺少 Windows Node 运行时：$node" }
if (-not (Test-Path -LiteralPath $ffmpeg)) { throw "构建种子中没有找到在线转写需要的 FFmpeg：$ffmpeg" }
if (-not $target.StartsWith($output, [StringComparison]::OrdinalIgnoreCase)) { throw '输出目录越界。' }

New-Item -ItemType Directory -Force -Path $output | Out-Null
if (Test-Path -LiteralPath $target) { Remove-Item -LiteralPath $target -Recurse -Force }
if (Test-Path -LiteralPath $archive) { Remove-Item -LiteralPath $archive -Force }
New-Item -ItemType Directory -Force -Path $target | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $target 'runtime') | Out-Null

$files = @(
  'server.mjs', 'settings-store.mjs', 'transcription-worker.mjs', 'package.json', 'package-lock.json',
  'README.md', 'Classmate Lilith 使用说明.txt', 'WORKBENCH_INFO.txt',
  'THIRD_PARTY_NOTICES.txt', 'PRIVACY.md'
)
foreach ($relative in $files) {
  $from = Join-Path $source $relative
  if (-not (Test-Path -LiteralPath $from)) { throw "发布文件不存在：$relative" }
  Copy-Item -LiteralPath $from -Destination (Join-Path $target $relative) -Force
}
foreach ($directory in @('public', 'lib')) {
  Copy-Item -LiteralPath (Join-Path $source $directory) -Destination (Join-Path $target $directory) -Recurse -Force
}
$launcherBuild = Join-Path $source 'launcher\build.ps1'
& $launcherBuild -OutputPath (Join-Path $target 'Classmate Lilith.exe')
if ($LASTEXITCODE -ne 0) { throw 'Windows 启动器编译失败。' }
New-Item -ItemType Directory -Force -Path (Join-Path $target 'node_modules') | Out-Null
Copy-Item -LiteralPath (Join-Path $source 'node_modules\ws') -Destination (Join-Path $target 'node_modules\ws') -Recurse -Force
New-Item -ItemType Directory -Force -Path (Join-Path $target 'assets') | Out-Null
Copy-Item -LiteralPath (Join-Path $source 'assets\app.ico') -Destination (Join-Path $target 'assets\app.ico') -Force
Copy-Item -LiteralPath (Join-Path $seed 'runtime\node') -Destination (Join-Path $target 'runtime\node') -Recurse -Force
New-Item -ItemType Directory -Force -Path (Join-Path $target 'runtime\ffmpeg') | Out-Null
Copy-Item -LiteralPath $ffmpeg -Destination (Join-Path $target 'runtime\ffmpeg\ffmpeg.exe') -Force
foreach ($directory in @('data\tasks','data\versions','data\recovery','data\transcriptions\uploads','data\transcriptions\jobs','logs')) {
  New-Item -ItemType Directory -Force -Path (Join-Path $target $directory) | Out-Null
}

$forbidden = @('data\settings.json','data\terminology.json','engines','models','components','downloads','runtime\tools')
foreach ($relative in $forbidden) {
  if (Test-Path -LiteralPath (Join-Path $target $relative)) { throw "发布包包含不应出现的私人数据或旧组件：$relative" }
}

$manifest = @('# Classmate Lilith 0.16.0 Windows x64 online-only package', '')
Get-ChildItem -LiteralPath $target -File -Recurse | Where-Object { $_.Name -ne 'SHA256SUMS.txt' } | Sort-Object FullName | ForEach-Object {
  $relative = $_.FullName.Substring($target.Length + 1)
  $hash = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
  $manifest += "$hash  $relative"
}
Set-Content -LiteralPath (Join-Path $target 'SHA256SUMS.txt') -Value $manifest -Encoding utf8
Compress-Archive -LiteralPath $target -DestinationPath $archive -CompressionLevel Optimal

$privateFiles = Get-ChildItem -LiteralPath $target -File -Recurse | Where-Object { $_.FullName -match '\\data\\(settings|tasks|transcriptions).+\.(json|mp3|wav|m4a|aac|flac|ogg|mp4|mkv|webm)$' }
if ($privateFiles) { throw '隐私检查失败：发布包中出现了用户数据。' }

[pscustomobject]@{
  Version = '0.16.0'
  Folder = $target
  Archive = $archive
  ArchiveMiB = [math]::Round((Get-Item -LiteralPath $archive).Length / 1MB, 1)
  Files = @(Get-ChildItem -LiteralPath $target -File -Recurse).Count
}
