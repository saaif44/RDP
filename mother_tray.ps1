$ErrorActionPreference = 'Stop'

$AppName = 'Mother System'
$RootDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ServerDir = Join-Path $RootDir 'server'
$PackagedAdminExe = Join-Path $RootDir 'LocalRDP-Admin-win64.exe'
$DashboardUrl = 'http://localhost:7420'
$LogDir = Join-Path $env:APPDATA 'LocalRDP'
$LogPath = Join-Path $LogDir 'mother-system.log'

New-Item -ItemType Directory -Path $LogDir -Force | Out-Null

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

function Write-MotherLog {
  param([string]$Message)
  $timestamp = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
  "[$timestamp] $Message" | Add-Content -Path $LogPath -Encoding UTF8
}

$script:serverProcess = $null

function Get-NodePath {
  $nodeCommand = Get-Command node -ErrorAction SilentlyContinue
  if ($nodeCommand) {
    return $nodeCommand.Source
  }
  return $null
}

function Start-MotherServer {
  if ($script:serverProcess -and -not $script:serverProcess.HasExited) {
    return
  }

  $fileName = $PackagedAdminExe
  $arguments = ''
  $workingDirectory = $RootDir

  if (-not (Test-Path $fileName)) {
    $nodePath = Get-NodePath
    if (-not $nodePath) {
      Write-MotherLog 'Node.js was not found in PATH. Install Node.js or start this launcher from a Node-enabled environment.'
      [System.Windows.Forms.MessageBox]::Show(
        'Node.js was not found in PATH. Install Node.js, then start Mother System again.',
        $AppName,
        [System.Windows.Forms.MessageBoxButtons]::OK,
        [System.Windows.Forms.MessageBoxIcon]::Error
      ) | Out-Null
      return
    }

    $fileName = $nodePath
    $arguments = 'index.js'
    $workingDirectory = $ServerDir
  }

  $stdoutPath = Join-Path $LogDir 'mother-server.out.log'
  $stderrPath = Join-Path $LogDir 'mother-server.err.log'

  $startInfo = New-Object System.Diagnostics.ProcessStartInfo
  $startInfo.FileName = $fileName
  $startInfo.Arguments = $arguments
  $startInfo.WorkingDirectory = $workingDirectory
  $startInfo.UseShellExecute = $false
  $startInfo.CreateNoWindow = $true
  $startInfo.WindowStyle = [System.Diagnostics.ProcessWindowStyle]::Hidden
  $startInfo.RedirectStandardOutput = $true
  $startInfo.RedirectStandardError = $true

  $process = New-Object System.Diagnostics.Process
  $process.StartInfo = $startInfo
  $process.EnableRaisingEvents = $true

  $outputHandler = [System.Diagnostics.DataReceivedEventHandler]{
    param($sender, $event)
    if ($event.Data) {
      $event.Data | Add-Content -Path $stdoutPath -Encoding UTF8
    }
  }

  $errorHandler = [System.Diagnostics.DataReceivedEventHandler]{
    param($sender, $event)
    if ($event.Data) {
      $event.Data | Add-Content -Path $stderrPath -Encoding UTF8
    }
  }

  $process.add_OutputDataReceived($outputHandler)
  $process.add_ErrorDataReceived($errorHandler)
  $process.add_Exited({
    param($sender, $eventArgs)
    Write-MotherLog "Mother System backend exited. Exit code: $($sender.ExitCode)"
  })
  $process.Start() | Out-Null
  $process.BeginOutputReadLine()
  $process.BeginErrorReadLine()

  $script:serverProcess = $process
  Write-MotherLog "Mother System backend started. PID: $($process.Id)"
}

function Stop-MotherServer {
  if ($script:serverProcess -and -not $script:serverProcess.HasExited) {
    Write-MotherLog "Stopping Mother System backend. PID: $($script:serverProcess.Id)"
    $script:serverProcess.Kill()
    $script:serverProcess.WaitForExit(3000) | Out-Null
  }
}

function Open-Dashboard {
  Start-Process $DashboardUrl
}

function Open-Logs {
  if (-not (Test-Path $LogPath)) {
    New-Item -ItemType File -Path $LogPath -Force | Out-Null
  }
  Start-Process notepad.exe $LogPath
}

$context = New-Object System.Windows.Forms.ApplicationContext
$trayIcon = New-Object System.Windows.Forms.NotifyIcon
$trayIcon.Text = $AppName
$trayIcon.Icon = [System.Drawing.SystemIcons]::Application
$trayIcon.Visible = $true

$menu = New-Object System.Windows.Forms.ContextMenuStrip

$openItem = $menu.Items.Add('Open Dashboard')
$openItem.add_Click({ Open-Dashboard })

$restartItem = $menu.Items.Add('Restart Backend')
$restartItem.add_Click({
  Stop-MotherServer
  Start-Sleep -Milliseconds 500
  Start-MotherServer
  $trayIcon.ShowBalloonTip(1500, $AppName, 'Backend restarted.', [System.Windows.Forms.ToolTipIcon]::Info)
})

$logsItem = $menu.Items.Add('Open Launcher Log')
$logsItem.add_Click({ Open-Logs })

$menu.Items.Add((New-Object System.Windows.Forms.ToolStripSeparator)) | Out-Null

$exitItem = $menu.Items.Add('Exit')
$exitItem.add_Click({
  Stop-MotherServer
  $trayIcon.Visible = $false
  $trayIcon.Dispose()
  $context.ExitThread()
})

$trayIcon.ContextMenuStrip = $menu
$trayIcon.add_DoubleClick({ Open-Dashboard })

Start-MotherServer
if ($script:serverProcess -and -not $script:serverProcess.HasExited) {
  $trayIcon.ShowBalloonTip(2000, $AppName, 'Running in the system tray.', [System.Windows.Forms.ToolTipIcon]::Info)
} else {
  $trayIcon.ShowBalloonTip(3000, $AppName, 'Backend is not running. Open Launcher Log for details.', [System.Windows.Forms.ToolTipIcon]::Warning)
}

[System.Windows.Forms.Application]::Run($context)
