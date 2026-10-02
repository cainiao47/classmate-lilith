param(
    [string]$OutputPath = (Join-Path (Split-Path $PSScriptRoot -Parent) "Classmate Lilith.exe"),
    [string]$WebView2PackagePath = ""
)

$ErrorActionPreference = 'Stop'
$webView2Version = '1.0.4258.31'
$webView2Sha256 = '56f7f4b8bf9aee4b8efefbbdd4f67d5f74ebd1b100ed0806da71bf76af481aa9'
$cacheRoot = Join-Path $PSScriptRoot '.cache'
$packageFile = if ($WebView2PackagePath) { [IO.Path]::GetFullPath($WebView2PackagePath) } else { Join-Path $cacheRoot "Microsoft.Web.WebView2.$webView2Version.nupkg" }
$packageRoot = Join-Path $cacheRoot "Microsoft.Web.WebView2.$webView2Version"

New-Item -ItemType Directory -Force -Path $cacheRoot | Out-Null
if (-not (Test-Path -LiteralPath $packageFile)) {
    $url = "https://api.nuget.org/v3-flatcontainer/microsoft.web.webview2/$webView2Version/microsoft.web.webview2.$webView2Version.nupkg"
    try {
        Invoke-WebRequest -Uri $url -OutFile $packageFile
    } catch {
        $nodeCommand = Get-Command node -ErrorAction SilentlyContinue
        if (-not $nodeCommand) { throw }
        $downloadScript = 'const fs=require("node:fs");fetch(process.argv[1]).then(r=>{if(!r.ok)throw Error(String(r.status));return r.arrayBuffer()}).then(b=>fs.writeFileSync(process.argv[2],Buffer.from(b)))'
        & $nodeCommand.Source -e $downloadScript $url $packageFile
        if ($LASTEXITCODE -ne 0) { throw 'Unable to download the WebView2 SDK package.' }
    }
}
$actualHash = (Get-FileHash -LiteralPath $packageFile -Algorithm SHA256).Hash.ToLowerInvariant()
if ($actualHash -ne $webView2Sha256) { throw 'WebView2 SDK checksum verification failed.' }
if (-not (Test-Path -LiteralPath (Join-Path $packageRoot 'lib\net462\Microsoft.Web.WebView2.Core.dll'))) {
    if (Test-Path -LiteralPath $packageRoot) { Remove-Item -LiteralPath $packageRoot -Recurse -Force }
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    [IO.Compression.ZipFile]::ExtractToDirectory($packageFile, $packageRoot)
}

$compiler = Join-Path $env:WINDIR "Microsoft.NET\Framework64\v4.0.30319\csc.exe"
if (-not (Test-Path -LiteralPath $compiler)) {
    $compiler = Join-Path $env:WINDIR "Microsoft.NET\Framework\v4.0.30319\csc.exe"
}
if (-not (Test-Path -LiteralPath $compiler)) {
    throw "The .NET Framework C# compiler was not found."
}

$source = Join-Path $PSScriptRoot "Launcher.cs"
if (-not (Test-Path -LiteralPath $source)) {
    $source = Join-Path $PSScriptRoot "WorkbenchLauncher.cs"
}
$icon = Join-Path (Split-Path $PSScriptRoot -Parent) "assets\app.ico"
$core = Join-Path $packageRoot 'lib\net462\Microsoft.Web.WebView2.Core.dll'
$winForms = Join-Path $packageRoot 'lib\net462\Microsoft.Web.WebView2.WinForms.dll'
$loader = Join-Path $packageRoot 'runtimes\win-x64\native\WebView2Loader.dll'
$outputDirectory = Split-Path -Parent ([IO.Path]::GetFullPath($OutputPath))
New-Item -ItemType Directory -Force -Path $outputDirectory | Out-Null
& $compiler /nologo /target:winexe /optimize+ "/out:$OutputPath" "/win32icon:$icon" /reference:System.dll /reference:System.Drawing.dll /reference:System.Windows.Forms.dll "/reference:$core" "/reference:$winForms" $source
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
Copy-Item -LiteralPath $core -Destination (Join-Path $outputDirectory 'Microsoft.Web.WebView2.Core.dll') -Force
Copy-Item -LiteralPath $winForms -Destination (Join-Path $outputDirectory 'Microsoft.Web.WebView2.WinForms.dll') -Force
Copy-Item -LiteralPath $loader -Destination (Join-Path $outputDirectory 'WebView2Loader.dll') -Force
Copy-Item -LiteralPath (Join-Path $packageRoot 'LICENSE.txt') -Destination (Join-Path $outputDirectory 'THIRD_PARTY_WebView2_LICENSE.txt') -Force
Write-Output "Built: $OutputPath"
