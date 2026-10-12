# JobPilot installer for Windows. One command does everything. Open PowerShell (Start menu, type
# PowerShell) and paste:
#
#   irm https://raw.githubusercontent.com/Jperonamadrid/Irish-JobAutoPilot/main/install/install.ps1 | iex
#
# It installs only what is missing:
#   1. JobPilot itself, in your user folder\JobPilot (an existing copy is updated; your data in users\ is kept)
#   2. Node.js, inside that folder (runtime\node), if this computer does not have Node 20 or newer
#   3. Git for Windows, which Claude Code needs (Windows may ask you to allow it)
#   4. JobPilot's parts and its PDF/browser engine
#   5. Claude Code (the AI JobPilot uses), then helps you sign in
#   6. Desktop and Start menu shortcuts, then it starts JobPilot
# Running it again is safe: it repairs or updates whatever is there.
#
# Options, set before running it (e.g. $env:JOBPILOT_NO_START = '1'):
#   JOBPILOT_DIR        where to install (default: your user folder\JobPilot)
#   JOBPILOT_REF        which version of the repository to install (default main)
#   JOBPILOT_NO_START   do not start JobPilot at the end
#   JOBPILOT_LOCAL_NODE always use JobPilot's own Node.js, even if the computer has one
#   JOBPILOT_SKIP_CLAUDE / JOBPILOT_SKIP_GIT   skip those steps
#
# Everything is inside Install-JobPilot so nothing runs unless the whole script has downloaded.
function Install-JobPilot {
  $ErrorActionPreference = 'Stop'
  $ProgressPreference = 'SilentlyContinue'   # the progress bar makes downloads very slow in Windows PowerShell
  [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

  $Repo = 'Jperonamadrid/Irish-JobAutoPilot'
  $Ref = if ($env:JOBPILOT_REF) { $env:JOBPILOT_REF } else { 'main' }
  $Dir = if ($env:JOBPILOT_DIR) { $env:JOBPILOT_DIR } else { Join-Path $HOME 'JobPilot' }
  $NodeLine = '22'
  $Tmp = Join-Path ([IO.Path]::GetTempPath()) ("jobpilot-" + [guid]::NewGuid())
  New-Item -ItemType Directory -Path $Tmp | Out-Null

  function Say($m) { Write-Host "`n==> $m" -ForegroundColor Cyan }
  function Fail($m) { Write-Host "`nJobPilot could not be installed: $m" -ForegroundColor Red; throw $m }
  function Has($cmd) { [bool](Get-Command $cmd -ErrorAction SilentlyContinue) }
  function Refresh-Path {
    $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
    if (Test-Path "$Dir\runtime\node\node.exe") { $env:Path = "$Dir\runtime\node;" + $env:Path }
    $env:Path = "$HOME\.local\bin;" + $env:Path
  }
  # Programs write warnings to stderr; Windows PowerShell 5.1 would treat those as fatal under 'Stop'.
  function Native([scriptblock]$block) { $old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'; try { & $block } finally { $ErrorActionPreference = $old } }
  function Run($exe, $argList) {
    Native { & $exe @argList }
    if ($LASTEXITCODE -ne 0) { Fail "$exe $($argList -join ' ') failed (see above)." }
  }

  try {
    Write-Host "JobPilot installer: everything goes into $Dir"

    # ---- 1. JobPilot --------------------------------------------------------------------------------
    if (Test-Path "$Dir\.git") {
      Say 'Updating your JobPilot (git pull)'
      Native { git -C $Dir pull --ff-only }
      if ($LASTEXITCODE -ne 0) { Fail "git pull did not work in $Dir. Undo your own changes there and run this again." }
    } else {
      Say 'Downloading JobPilot'
      $zip = Join-Path $Tmp 'jobpilot.zip'
      Invoke-WebRequest -UseBasicParsing -Uri "https://codeload.github.com/$Repo/zip/$Ref" -OutFile $zip
      Expand-Archive -Path $zip -DestinationPath "$Tmp\src" -Force
      $top = Get-ChildItem "$Tmp\src" -Directory | Select-Object -First 1
      if (-not (Test-Path "$($top.FullName)\server\index.js")) { Fail 'the download looks incomplete.' }
      New-Item -ItemType Directory -Force -Path $Dir | Out-Null
      # The download never contains users\ (your data), data\ or runtime\, so copying over keeps them.
      Copy-Item -Path "$($top.FullName)\*" -Destination $Dir -Recurse -Force
    }
    Set-Location $Dir
    Refresh-Path

    # ---- 2. Node.js ---------------------------------------------------------------------------------
    $nodeOk = $false
    if ($env:JOBPILOT_LOCAL_NODE -and -not (Test-Path "$Dir\runtime\node\node.exe")) { $nodeOk = $false }
    elseif (Has 'node') { Native { & node -e "process.exit(+process.versions.node.split('.')[0] >= 20 ? 0 : 1)" }; $nodeOk = ($LASTEXITCODE -eq 0) }
    if ($nodeOk) { Say "Node.js $(node --version) is already here" } else {
      Say "Installing Node.js $NodeLine (inside the JobPilot folder; no admin needed)"
      $arch = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { 'arm64' } else { 'x64' }
      $base = "https://nodejs.org/dist/latest-v$NodeLine.x"
      $sums = (Invoke-WebRequest -UseBasicParsing -Uri "$base/SHASUMS256.txt").Content -split "`n"
      $line = $sums | Where-Object { $_ -match "node-v[\d.]+-win-$arch\.zip$" } | Select-Object -First 1
      if (-not $line) { Fail "no Node.js download for win-$arch." }
      $sum, $file = ($line.Trim() -split '\s+')
      $nodeZip = Join-Path $Tmp $file
      Invoke-WebRequest -UseBasicParsing -Uri "$base/$file" -OutFile $nodeZip
      if ((Get-FileHash $nodeZip -Algorithm SHA256).Hash -ne $sum.ToUpper()) { Fail 'the Node.js download is damaged (checksum mismatch). Run this again.' }
      Expand-Archive -Path $nodeZip -DestinationPath "$Tmp\node" -Force
      if (Test-Path "$Dir\runtime\node") { Remove-Item "$Dir\runtime\node" -Recurse -Force }
      New-Item -ItemType Directory -Force -Path "$Dir\runtime" | Out-Null
      Move-Item -Path (Get-ChildItem "$Tmp\node" -Directory | Select-Object -First 1).FullName -Destination "$Dir\runtime\node"
      Refresh-Path
      Say "Node.js $(node --version) installed"
    }

    # ---- 3. Git for Windows (Claude Code needs it) ---------------------------------------------------
    if (-not $env:JOBPILOT_SKIP_GIT -and -not $env:JOBPILOT_SKIP_CLAUDE) {
      if (Has 'git') { Say 'Git is already here' } else {
        Say 'Installing Git for Windows (Claude Code needs it; Windows may ask you to allow it)'
        if (Has 'winget') {
          Native { & winget install --id Git.Git -e --source winget --accept-package-agreements --accept-source-agreements --silent }
        } else {
          $rel = Invoke-RestMethod -Uri 'https://api.github.com/repos/git-for-windows/git/releases/latest' -Headers @{ 'User-Agent' = 'JobPilot-installer' }
          $asset = $rel.assets | Where-Object { $_.name -match '^Git-[\d.]+-64-bit\.exe$' } | Select-Object -First 1
          $exe = Join-Path $Tmp $asset.name
          Invoke-WebRequest -UseBasicParsing -Uri $asset.browser_download_url -OutFile $exe
          Start-Process -FilePath $exe -ArgumentList '/VERYSILENT', '/NORESTART', '/CURRENTUSER' -Wait
        }
        Refresh-Path
        if (-not (Has 'git')) { Write-Host 'Git did not install. Get it from https://git-scm.com/download/win, then run this installer again.' -ForegroundColor Yellow }
      }
    }

    # ---- 4. JobPilot's parts and the PDF/browser engine ---------------------------------------------
    Say "Installing JobPilot's parts (one or two minutes)"
    Run 'npm.cmd' @('install', '--no-fund', '--no-audit', '--loglevel=error')
    Say 'Installing the PDF/browser engine'
    Run 'npx.cmd' @('--yes', 'playwright', 'install', 'chromium')

    # ---- 5. Claude Code -----------------------------------------------------------------------------
    if (-not $env:JOBPILOT_SKIP_CLAUDE) {
      if (Has 'claude') { Say 'Claude Code is already installed' } else {
        Say 'Installing Claude Code (the AI JobPilot uses)'
        # Its own official installer, in a separate PowerShell so it cannot end this one.
        Native { & powershell -NoProfile -ExecutionPolicy Bypass -Command 'irm https://claude.ai/install.ps1 | iex' }
        Refresh-Path
        if (-not (Has 'claude')) { Fail 'Claude Code did not install (see above).' }
      }
      Say 'Checking that Claude Code is signed in'
      Native { & node -e "require('./core/llm').check().then(r => process.exit(r.ok ? 0 : 1))" 2>$null }
      if ($LASTEXITCODE -eq 0) { Write-Host 'Claude Code is ready.' } else {
        Write-Host 'Claude Code needs you to sign in once with your Claude account (Pro or higher).'
        Write-Host 'A Claude Code window opens: follow the steps, sign in in the browser, then type /exit and close that window.'
        Read-Host 'Press Enter to open it'
        Start-Process powershell -ArgumentList '-NoExit', '-Command', 'claude' -Wait
      }
    }

    # ---- 6. Shortcuts and start ---------------------------------------------------------------------
    $shell = New-Object -ComObject WScript.Shell
    $startMenu = Join-Path ([Environment]::GetFolderPath('Programs')) 'JobPilot.lnk'
    foreach ($lnk in @((Join-Path ([Environment]::GetFolderPath('Desktop')) 'JobPilot.lnk'), $startMenu)) {
      $s = $shell.CreateShortcut($lnk); $s.TargetPath = "$Dir\start.bat"; $s.WorkingDirectory = $Dir; $s.Description = 'Find jobs and prepare applications'; $s.Save()
    }
    Write-Host 'Added JobPilot to your Desktop and Start menu.'
    if (-not (Test-Path "$env:ProgramFiles\Google\Chrome\Application\chrome.exe") -and -not (Test-Path "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe")) {
      Write-Host 'Tip: Google Chrome (https://www.google.com/chrome/) is recommended for signing in to job sites; JobPilot works without it.'
    }

    Say "JobPilot is installed in $Dir"
    if (-not $env:JOBPILOT_NO_START) {
      Say 'Starting JobPilot (a window opens: keep it open while you use JobPilot)'
      Start-Process -FilePath "$Dir\start.bat" -WorkingDirectory $Dir
    }
  } finally {
    Remove-Item $Tmp -Recurse -Force -ErrorAction SilentlyContinue
  }
}
Install-JobPilot
