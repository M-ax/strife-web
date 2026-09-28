param(
    [string]$SourceDirectory = (Join-Path $PSScriptRoot '../../strife/artifacts/release'),
    [Parameter(Mandatory)][string]$Version,
    [string]$SourceRef
)
$ErrorActionPreference = 'Stop'
$importArguments = @($SourceDirectory, $Version)
if ($SourceRef) { $importArguments += $SourceRef }
& node (Join-Path $PSScriptRoot 'import-release.mjs') @importArguments
if ($LASTEXITCODE) { throw 'Release import failed.' }
