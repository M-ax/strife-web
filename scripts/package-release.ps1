param(
    [string]$SourceDirectory = (Join-Path $PSScriptRoot '../../strife/artifacts/Strife-updated'),
    [ValidatePattern('^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.]+)?$')][string]$Version = '0.1.0-preview.1'
)
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$source = (Resolve-Path -LiteralPath $SourceDirectory).Path
foreach ($file in @('Strife.exe', 'voice/strife-voice.exe', 'voice/rnnoise.dll', 'THIRD-PARTY-NOTICES.md')) {
    if (!(Test-Path -LiteralPath (Join-Path $source $file))) { throw "Incomplete published build: missing $file" }
}
$destination = Join-Path $root 'releases'
New-Item -ItemType Directory -Force $destination | Out-Null
$filename = "strife-$Version-windows-x64.zip"
$archive = Join-Path $destination $filename
if (Test-Path -LiteralPath $archive) { throw 'This release already exists. Choose a new version to keep download URLs immutable.' }
Add-Type -AssemblyName System.IO.Compression.FileSystem
[IO.Compression.ZipFile]::CreateFromDirectory($source, $archive, [IO.Compression.CompressionLevel]::Optimal, $false)
$hash = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant()
$release = [ordered]@{
    version = $Version
    platform = 'Windows x64'
    filename = $filename
    key = "releases/$Version/$filename"
    bytes = (Get-Item -LiteralPath $archive).Length
    sha256 = $hash
    publishedAt = [DateTime]::UtcNow.ToString('yyyy-MM-dd')
}
[IO.File]::WriteAllText((Join-Path $root 'release.json'), ($release | ConvertTo-Json) + [Environment]::NewLine)
[IO.File]::WriteAllText("$archive.sha256", "$hash  $filename" + [Environment]::NewLine)
Write-Host "Packaged $filename; metadata and SHA-256 written. No remote files were uploaded."
