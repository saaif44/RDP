using System.Diagnostics;
using System.Drawing;
using System.Threading;
using System.Windows.Forms;

namespace LocalRDP.Admin.Tray;

internal static class Program
{
    private const string MutexName = "LocalRDP.MotherSystem.Tray";

    [STAThread]
    private static void Main()
    {
        using var mutex = new Mutex(true, MutexName, out var isFirstInstance);

        if (!isFirstInstance)
        {
            OpenDashboard();
            return;
        }

        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        Application.Run(new MotherSystemTrayContext());
    }

    private static void OpenDashboard()
    {
        Process.Start(new ProcessStartInfo
        {
            FileName = "http://localhost:7420",
            UseShellExecute = true
        });
    }
}

internal sealed class MotherSystemTrayContext : ApplicationContext
{
    private const string AppName = "Mother System";
    private const string DashboardUrl = "http://localhost:7420";

    private readonly NotifyIcon _trayIcon;
    private readonly ContextMenuStrip _menu;
    private readonly string _logPath;
    private readonly object _logLock = new();
    private Process? _backendProcess;
    private bool _isQuitting;
    private bool _disposed;

    public MotherSystemTrayContext()
    {
        var logDir = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
            "LocalRDP");
        Directory.CreateDirectory(logDir);
        _logPath = Path.Combine(logDir, "mother-system.log");

        _menu = new ContextMenuStrip();
        _menu.Items.Add("Open Dashboard", null, (_, _) => OpenDashboard());
        _menu.Items.Add("Open Log", null, (_, _) => OpenLog());
        _menu.Items.Add(new ToolStripSeparator());
        _menu.Items.Add("Quit", null, (_, _) => Quit());

        _trayIcon = new NotifyIcon
        {
            Text = AppName,
            Icon = GetTrayIcon(),
            ContextMenuStrip = _menu,
            Visible = true
        };
        _trayIcon.DoubleClick += (_, _) => OpenDashboard();

        StartBackend();
    }

    private void StartBackend()
    {
        var appDir = AppContext.BaseDirectory;
        var packagedBackend = Path.Combine(appDir, "runtime", "LocalRDP-Admin-Backend.exe");
        var localBackend = Path.Combine(appDir, "LocalRDP-Admin-Backend.exe");
        var sourceBackend = Path.GetFullPath(Path.Combine(appDir, "..", "..", "..", "server", "index.js"));

        string fileName;
        string arguments;
        string workingDirectory;

        if (File.Exists(packagedBackend))
        {
            fileName = packagedBackend;
            arguments = "";
            workingDirectory = Path.GetDirectoryName(packagedBackend) ?? appDir;
        }
        else if (File.Exists(localBackend))
        {
            fileName = localBackend;
            arguments = "";
            workingDirectory = appDir;
        }
        else if (File.Exists(sourceBackend))
        {
            fileName = "node";
            arguments = "index.js";
            workingDirectory = Path.GetDirectoryName(sourceBackend) ?? appDir;
        }
        else
        {
            WriteLog("Backend executable was not found.");
            MessageBox.Show(
                "Mother System backend was not found. Reinstall or extract the full Windows package.",
                AppName,
                MessageBoxButtons.OK,
                MessageBoxIcon.Error);
            return;
        }

        try
        {
            var startInfo = new ProcessStartInfo
            {
                FileName = fileName,
                Arguments = arguments,
                WorkingDirectory = workingDirectory,
                UseShellExecute = false,
                CreateNoWindow = true,
                WindowStyle = ProcessWindowStyle.Hidden,
                RedirectStandardOutput = true,
                RedirectStandardError = true
            };
            startInfo.Environment["MOTHER_CONSOLE_LOGS"] = "1";

            _backendProcess = new Process
            {
                StartInfo = startInfo,
                EnableRaisingEvents = true
            };

            _backendProcess.OutputDataReceived += (_, args) => WriteBackendOutput(args.Data);
            _backendProcess.ErrorDataReceived += (_, args) => WriteBackendOutput(args.Data);
            _backendProcess.Exited += (_, _) =>
            {
                WriteLog($"Backend exited with code {_backendProcess?.ExitCode}.");
                if (!_isQuitting)
                {
                    _trayIcon.ShowBalloonTip(3000, AppName, "Backend stopped. Open Log for details.", ToolTipIcon.Warning);
                }
            };

            _backendProcess.Start();
            _backendProcess.BeginOutputReadLine();
            _backendProcess.BeginErrorReadLine();

            WriteLog($"Backend started. PID: {_backendProcess.Id}");
            _trayIcon.ShowBalloonTip(1800, AppName, "Running in the system tray.", ToolTipIcon.Info);
        }
        catch (Exception ex)
        {
            WriteLog($"Failed to start backend: {ex}");
            MessageBox.Show(
                "Mother System could not start. Right-click the tray icon and open the log for details.",
                AppName,
                MessageBoxButtons.OK,
                MessageBoxIcon.Error);
        }
    }

    private void OpenDashboard()
    {
        Process.Start(new ProcessStartInfo
        {
            FileName = DashboardUrl,
            UseShellExecute = true
        });
    }

    private void OpenLog()
    {
        if (!File.Exists(_logPath))
        {
            File.WriteAllText(_logPath, "");
        }

        Process.Start(new ProcessStartInfo
        {
            FileName = _logPath,
            UseShellExecute = true
        });
    }

    private void Quit()
    {
        _isQuitting = true;
        StopBackend();
        _trayIcon.Visible = false;
        ExitThread();
    }

    private void StopBackend()
    {
        if (_backendProcess is null || _backendProcess.HasExited)
        {
            return;
        }

        try
        {
            WriteLog($"Stopping backend. PID: {_backendProcess.Id}");
            _backendProcess.Kill(entireProcessTree: true);
            _backendProcess.WaitForExit(3000);
        }
        catch (Exception ex)
        {
            WriteLog($"Failed to stop backend cleanly: {ex}");
        }
    }

    private void WriteBackendOutput(string? line)
    {
        if (!string.IsNullOrWhiteSpace(line))
        {
            WriteLog(line);
        }
    }

    private void WriteLog(string message)
    {
        var line = $"[{DateTime.Now:yyyy-MM-dd HH:mm:ss}] {message}{Environment.NewLine}";
        lock (_logLock)
        {
            File.AppendAllText(_logPath, line);
        }
    }

    private static Icon GetTrayIcon()
    {
        try
        {
            return Icon.ExtractAssociatedIcon(Application.ExecutablePath) ?? SystemIcons.Application;
        }
        catch
        {
            return SystemIcons.Application;
        }
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing && !_disposed)
        {
            _disposed = true;
            StopBackend();
            _trayIcon.Visible = false;
            _trayIcon.Dispose();
            _menu.Dispose();
        }

        base.Dispose(disposing);
    }
}
