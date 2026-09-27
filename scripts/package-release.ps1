param(
    [string]$SourceDirectory = (Join-Path $PSScriptRoot '../../strife/artifacts/release'),
    [Parameter(Mandatory)][string]$Version
)
$ErrorActionPreference = 'Stop'
& node (Join-Path $PSScriptRoot 'import-release.mjs') $SourceDirectory $Version
if ($LASTEXITCODE) { throw 'Release import failed.' }
