param(
    [string]$OutputPath = (Join-Path (Split-Path $PSScriptRoot -Parent) "Classmate Lilith.exe")
)

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
& $compiler /nologo /target:winexe /optimize+ "/out:$OutputPath" "/win32icon:$icon" /reference:System.dll /reference:System.Drawing.dll /reference:System.Windows.Forms.dll $source
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
Write-Output "Built: $OutputPath"
