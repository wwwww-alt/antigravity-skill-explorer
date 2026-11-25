$ErrorActionPreference = "Stop"

$RepoDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$TargetDir = Join-Path $HOME ".gemini\config\plugins\skill-explorer"

Write-Host "Installing Antigravity Skill Explorer to $TargetDir ..."

New-Item -ItemType Directory -Force `
  (Join-Path $TargetDir "assets"), `
  (Join-Path $TargetDir "skills\skill-explorer"), `
  (Join-Path $TargetDir "ui\src") | Out-Null

Copy-Item (Join-Path $RepoDir "plugin.json") (Join-Path $TargetDir "plugin.json") -Force
Copy-Item (Join-Path $RepoDir "server.py") (Join-Path $TargetDir "server.py") -Force
Copy-Item (Join-Path $RepoDir "requirements.txt") (Join-Path $TargetDir "requirements.txt") -Force
Copy-Item (Join-Path $RepoDir "assets\logo.svg") (Join-Path $TargetDir "assets\logo.svg") -Force
Copy-Item (Join-Path $RepoDir "skills\skill-explorer\SKILL.md") (Join-Path $TargetDir "skills\skill-explorer\SKILL.md") -Force
Copy-Item (Join-Path $RepoDir "ui\app.html") (Join-Path $TargetDir "ui\app.html") -Force
Copy-Item (Join-Path $RepoDir "ui\src\app.ts") (Join-Path $TargetDir "ui\src\app.ts") -Force

$VenvDir = Join-Path $TargetDir ".venv"
$PythonExe = Join-Path $VenvDir "Scripts\python.exe"

if (Get-Command uv -ErrorAction SilentlyContinue) {
  Write-Host "Creating Python venv with uv..."
  uv venv $VenvDir --python 3.12
  uv pip install --python $PythonExe -r (Join-Path $TargetDir "requirements.txt")
} elseif (Get-Command python -ErrorAction SilentlyContinue) {
  Write-Host "Creating Python venv with python..."
  python -m venv $VenvDir
  & $PythonExe -m pip install -r (Join-Path $TargetDir "requirements.txt")
} else {
  throw "Neither 'uv' nor 'python' was found in PATH. Please install Python 3.10+ or uv first."
}

$PythonPosix = ($PythonExe -replace '\\', '/')
$ServerPosix = ((Join-Path $TargetDir "server.py") -replace '\\', '/')

$McpConfig = @{
  mcpServers = @{
    explorer = @{
      command = $PythonPosix
      args = @($ServerPosix)
    }
  }
} | ConvertTo-Json -Depth 5

Set-Content -Path (Join-Path $TargetDir "mcp_config.json") -Value $McpConfig -Encoding UTF8

Write-Host ""
Write-Host "Installed successfully!"
Write-Host "Open Antigravity -> side pane '+' menu or left sidebar -> Skill Explorer."
