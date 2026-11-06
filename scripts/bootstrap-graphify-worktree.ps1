[CmdletBinding()]
param(
  [string]$Query = "agent worktree provisioning"
)

$ErrorActionPreference = "Stop"

$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$requiredFiles = @(
  "AGENTS.md"
)

Push-Location $repositoryRoot
try {
  foreach ($relativePath in $requiredFiles) {
    if (-not (Test-Path -LiteralPath $relativePath -PathType Leaf)) {
      throw "Required worktree provisioning file is missing: $relativePath"
    }
  }

  $graphifyCommand = Get-Command graphify -ErrorAction Stop
  & $graphifyCommand.Source update .
  if ($LASTEXITCODE -ne 0) {
    throw "Graphify update failed with exit code $LASTEXITCODE."
  }

  $graphPath = Join-Path $repositoryRoot "graphify-out/graph.json"
  if (-not (Test-Path -LiteralPath $graphPath -PathType Leaf)) {
    throw "Graphify did not create graphify-out/graph.json."
  }

  & $graphifyCommand.Source query $Query --graph $graphPath --budget 500
  if ($LASTEXITCODE -ne 0) {
    throw "Graphify query failed with exit code $LASTEXITCODE."
  }
}
finally {
  Pop-Location
}
