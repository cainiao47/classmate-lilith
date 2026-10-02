using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace ClassmateLilithLauncher
{
    static class Program
    {
        internal const string Url = "http://127.0.0.1:4178";
        private const string MutexName = "Local\\ClassmateLilithLauncher-4178";
        private const string ReopenEventName = "Local\\ClassmateLilithLauncher-Reopen-4178";
        private static Mutex singleInstance;

        [STAThread]
        static void Main()
        {
            Application.SetUnhandledExceptionMode(UnhandledExceptionMode.CatchException);
            Application.ThreadException += delegate(object sender, ThreadExceptionEventArgs args) { ReportFailure(args.Exception); };
            AppDomain.CurrentDomain.UnhandledException += delegate(object sender, UnhandledExceptionEventArgs args) { ReportFailure(args.ExceptionObject as Exception); };
            try
            {
                bool created;
                singleInstance = new Mutex(true, MutexName, out created);
                if (!created)
                {
                    SignalExistingWindow();
                    return;
                }
                Application.EnableVisualStyles();
                Application.SetCompatibleTextRenderingDefault(false);
                Application.Run(new TrayContext(ReopenEventName));
                GC.KeepAlive(singleInstance);
            }
            catch (Exception ex) { ReportFailure(ex); }
        }

        private static void SignalExistingWindow()
        {
            try { using (var signal = EventWaitHandle.OpenExisting(ReopenEventName)) signal.Set(); }
            catch { OpenBrowser(); }
        }

        internal static void ReportFailure(Exception error)
        {
            string type = "UnknownException", message = "未知错误", stack = "";
            try { if (error != null) type = error.GetType().FullName; } catch { }
            try { if (error != null && !String.IsNullOrEmpty(error.Message)) message = error.Message; } catch { }
            try { if (error != null) stack = error.StackTrace ?? ""; } catch { }
            try
            {
                string directory = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "logs");
                Directory.CreateDirectory(directory);
                File.AppendAllText(Path.Combine(directory, "launcher-error.log"), DateTime.Now.ToString("s") + " " + type + ": " + message + Environment.NewLine + stack + Environment.NewLine, Encoding.UTF8);
            }
            catch { }
            try { MessageBox.Show("启动器发生异常：" + type + Environment.NewLine + message + Environment.NewLine + "详细信息已写入 logs\\launcher-error.log。", "Classmate Lilith", MessageBoxButtons.OK, MessageBoxIcon.Error); }
            catch { }
        }

        internal static void OpenBrowser()
        {
            try { Process.Start(new ProcessStartInfo(Url) { UseShellExecute = true }); }
            catch { }
        }
    }

    sealed class WorkspaceForm : Form
    {
        private const int DwmWindowCornerPreference = 33;
        private const int DwmBorderColor = 34;
        private const int DwmCaptionColor = 35;
        private const int DwmTextColor = 36;
        private readonly string baseDir;
        private readonly WebView2 webView;
        private readonly Panel statusPanel;
        private readonly Label statusTitle;
        private readonly Label statusDetail;
        private readonly ProgressBar statusProgress;
        private readonly Button retryButton;
        private readonly Button browserButton;
        private bool initializing;
        private bool allowClose;
        private bool closeHintShown;

        internal event EventHandler RetryRequested;
        internal event EventHandler BrowserRequested;

        [DllImport("dwmapi.dll")]
        private static extern int DwmSetWindowAttribute(IntPtr hwnd, int attribute, ref int value, int size);

        internal WorkspaceForm(string root)
        {
            baseDir = root;
            Text = "Classmate Lilith";
            Icon = LoadAppIcon(root);
            StartPosition = FormStartPosition.CenterScreen;
            ClientSize = new Size(1280, 820);
            MinimumSize = new Size(940, 680);
            BackColor = Color.FromArgb(247, 240, 229);
            Font = new Font("Segoe UI", 9F, FontStyle.Regular, GraphicsUnit.Point);

            webView = new WebView2();
            webView.Dock = DockStyle.Fill;
            webView.Visible = false;
            webView.DefaultBackgroundColor = Color.FromArgb(247, 240, 229);
            Controls.Add(webView);

            statusPanel = new Panel();
            statusPanel.Dock = DockStyle.Fill;
            statusPanel.BackColor = Color.FromArgb(247, 240, 229);
            Controls.Add(statusPanel);

            var layout = new TableLayoutPanel();
            layout.Dock = DockStyle.Fill;
            layout.ColumnCount = 3;
            layout.RowCount = 3;
            layout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 50F));
            layout.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 540F));
            layout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 50F));
            layout.RowStyles.Add(new RowStyle(SizeType.Percent, 50F));
            layout.RowStyles.Add(new RowStyle(SizeType.AutoSize));
            layout.RowStyles.Add(new RowStyle(SizeType.Percent, 50F));
            statusPanel.Controls.Add(layout);

            var card = new TableLayoutPanel();
            card.AutoSize = true;
            card.AutoSizeMode = AutoSizeMode.GrowAndShrink;
            card.Dock = DockStyle.Fill;
            card.Padding = new Padding(42, 34, 42, 34);
            card.BackColor = Color.FromArgb(255, 251, 244);
            card.ColumnCount = 1;
            card.RowCount = 5;
            layout.Controls.Add(card, 1, 1);

            var brand = new PictureBox();
            brand.Size = new Size(82, 82);
            brand.SizeMode = PictureBoxSizeMode.Zoom;
            brand.Anchor = AnchorStyles.None;
            string brandPath = Path.Combine(root, "public", "assets", "lilith-app-icon.png");
            if (File.Exists(brandPath))
            {
                using (var image = Image.FromFile(brandPath)) brand.Image = new Bitmap(image);
            }
            card.Controls.Add(brand);

            statusTitle = new Label();
            statusTitle.Text = "正在启动 Classmate Lilith";
            statusTitle.Font = new Font("Segoe UI", 18F, FontStyle.Bold, GraphicsUnit.Point);
            statusTitle.ForeColor = Color.FromArgb(91, 57, 40);
            statusTitle.TextAlign = ContentAlignment.MiddleCenter;
            statusTitle.Dock = DockStyle.Fill;
            statusTitle.AutoSize = true;
            statusTitle.Margin = new Padding(0, 16, 0, 8);
            card.Controls.Add(statusTitle);

            statusDetail = new Label();
            statusDetail.Text = "正在准备本地工作台，请稍候……";
            statusDetail.Font = new Font("Microsoft YaHei UI", 10F, FontStyle.Regular, GraphicsUnit.Point);
            statusDetail.ForeColor = Color.FromArgb(121, 101, 88);
            statusDetail.TextAlign = ContentAlignment.MiddleCenter;
            statusDetail.Dock = DockStyle.Fill;
            statusDetail.AutoSize = true;
            statusDetail.MaximumSize = new Size(450, 0);
            statusDetail.Margin = new Padding(0, 0, 0, 18);
            card.Controls.Add(statusDetail);

            statusProgress = new ProgressBar();
            statusProgress.Style = ProgressBarStyle.Marquee;
            statusProgress.MarqueeAnimationSpeed = 24;
            statusProgress.Height = 5;
            statusProgress.Dock = DockStyle.Top;
            statusProgress.Margin = new Padding(0, 0, 0, 18);
            card.Controls.Add(statusProgress);

            var buttons = new FlowLayoutPanel();
            buttons.AutoSize = true;
            buttons.Anchor = AnchorStyles.None;
            buttons.FlowDirection = FlowDirection.LeftToRight;
            card.Controls.Add(buttons);

            retryButton = MakeButton("重新尝试", true);
            retryButton.Visible = false;
            retryButton.Click += delegate { if (RetryRequested != null) RetryRequested(this, EventArgs.Empty); };
            buttons.Controls.Add(retryButton);

            browserButton = MakeButton("使用浏览器打开", false);
            browserButton.Visible = false;
            browserButton.Click += delegate { if (BrowserRequested != null) BrowserRequested(this, EventArgs.Empty); };
            buttons.Controls.Add(browserButton);

            FormClosing += OnFormClosing;
            Shown += delegate { ApplyWindowStyle(); };
        }

        private static Icon LoadAppIcon(string root)
        {
            string iconPath = Path.Combine(root, "assets", "app.ico");
            try { if (File.Exists(iconPath)) return new Icon(iconPath); }
            catch { }
            return SystemIcons.Application;
        }

        private static Button MakeButton(string text, bool primary)
        {
            var button = new Button();
            button.Text = text;
            button.AutoSize = true;
            button.Padding = new Padding(14, 6, 14, 6);
            button.FlatStyle = FlatStyle.Flat;
            button.FlatAppearance.BorderSize = 1;
            button.FlatAppearance.BorderColor = primary ? Color.FromArgb(139, 88, 55) : Color.FromArgb(201, 177, 153);
            button.BackColor = primary ? Color.FromArgb(139, 88, 55) : Color.FromArgb(255, 251, 244);
            button.ForeColor = primary ? Color.White : Color.FromArgb(91, 57, 40);
            button.Cursor = Cursors.Hand;
            return button;
        }

        private void ApplyWindowStyle()
        {
            try
            {
                int rounded = 2;
                int caption = ColorRef(Color.FromArgb(244, 233, 216));
                int border = ColorRef(Color.FromArgb(214, 190, 163));
                int text = ColorRef(Color.FromArgb(78, 49, 35));
                DwmSetWindowAttribute(Handle, DwmWindowCornerPreference, ref rounded, sizeof(int));
                DwmSetWindowAttribute(Handle, DwmCaptionColor, ref caption, sizeof(int));
                DwmSetWindowAttribute(Handle, DwmBorderColor, ref border, sizeof(int));
                DwmSetWindowAttribute(Handle, DwmTextColor, ref text, sizeof(int));
            }
            catch { }
        }

        private static int ColorRef(Color color) { return color.R | (color.G << 8) | (color.B << 16); }

        internal void ShowStarting(string detail)
        {
            statusTitle.Text = "正在启动 Classmate Lilith";
            statusDetail.Text = detail;
            statusProgress.Visible = true;
            retryButton.Visible = false;
            browserButton.Visible = false;
            webView.Visible = false;
            statusPanel.Visible = true;
            ShowWorkspace();
        }

        internal void ShowFailure(string message, bool browserFallback)
        {
            statusTitle.Text = "无法打开工作台";
            statusDetail.Text = message;
            statusProgress.Visible = false;
            retryButton.Visible = true;
            browserButton.Visible = browserFallback;
            webView.Visible = false;
            statusPanel.Visible = true;
            ShowWorkspace();
        }

        internal async void LoadWorkspace()
        {
            ShowStarting("正在载入独立工作窗口……");
            if (initializing) return;
            try
            {
                if (webView.CoreWebView2 == null)
                {
                    initializing = true;
                    string userData = Path.Combine(baseDir, "data", "webview2");
                    Directory.CreateDirectory(userData);
                    var options = new CoreWebView2EnvironmentOptions();
                    options.AdditionalBrowserArguments = "--disable-background-timer-throttling --proxy-bypass-list=127.0.0.1;localhost";
                    var environment = await CoreWebView2Environment.CreateAsync(null, userData, options);
                    await webView.EnsureCoreWebView2Async(environment);
                    ConfigureWebView();
                    initializing = false;
                }
                webView.CoreWebView2.Navigate(Program.Url);
            }
            catch (WebView2RuntimeNotFoundException)
            {
                initializing = false;
                ShowFailure("这台电脑缺少 Microsoft Edge WebView2 Runtime。可以安装微软 WebView2 Runtime，或暂时使用浏览器打开工作台。", true);
            }
            catch (Exception ex)
            {
                initializing = false;
                Program.ReportFailure(ex);
                ShowFailure("独立窗口初始化失败：" + ex.Message, true);
            }
        }

        private void ConfigureWebView()
        {
            webView.CoreWebView2.Settings.IsStatusBarEnabled = false;
            webView.CoreWebView2.Settings.AreDevToolsEnabled = false;
            webView.CoreWebView2.Settings.IsZoomControlEnabled = true;
            webView.CoreWebView2.NavigationStarting += OnNavigationStarting;
            webView.CoreWebView2.NavigationCompleted += delegate(object sender, CoreWebView2NavigationCompletedEventArgs args)
            {
                if (args.IsSuccess)
                {
                    statusPanel.Visible = false;
                    webView.Visible = true;
                    ShowWorkspace();
                }
                else ShowFailure("工作台载入失败。请重新尝试，或使用浏览器临时打开。", true);
            };
            webView.CoreWebView2.NewWindowRequested += delegate(object sender, CoreWebView2NewWindowRequestedEventArgs args)
            {
                args.Handled = true;
                if (IsTrustedUri(args.Uri)) webView.CoreWebView2.Navigate(args.Uri);
                else OpenExternal(args.Uri);
            };
            webView.CoreWebView2.PermissionRequested += delegate(object sender, CoreWebView2PermissionRequestedEventArgs args)
            {
                Uri uri;
                bool trusted = Uri.TryCreate(args.Uri, UriKind.Absolute, out uri) && uri.Host == "127.0.0.1" && uri.Port == 4178;
                if (trusted && args.PermissionKind == CoreWebView2PermissionKind.Microphone) args.State = CoreWebView2PermissionState.Allow;
                else if (!trusted) args.State = CoreWebView2PermissionState.Deny;
            };
            webView.CoreWebView2.DownloadStarting += OnDownloadStarting;
            webView.CoreWebView2.ProcessFailed += delegate { ShowFailure("独立窗口的网页进程意外退出。服务仍在运行，可以重新载入。", true); };
        }

        private void OnNavigationStarting(object sender, CoreWebView2NavigationStartingEventArgs args)
        {
            if (IsTrustedUri(args.Uri)) return;
            args.Cancel = true;
            OpenExternal(args.Uri);
        }

        private void OnDownloadStarting(object sender, CoreWebView2DownloadStartingEventArgs args)
        {
            using (var dialog = new SaveFileDialog())
            {
                dialog.FileName = Path.GetFileName(args.ResultFilePath);
                dialog.OverwritePrompt = true;
                if (dialog.ShowDialog(this) == DialogResult.OK) args.ResultFilePath = dialog.FileName;
                else args.Cancel = true;
            }
        }

        private static bool IsTrustedUri(string value)
        {
            Uri uri;
            if (!Uri.TryCreate(value, UriKind.Absolute, out uri)) return false;
            if (uri.Scheme == "about" || uri.Scheme == "blob") return true;
            return uri.Scheme == "http" && uri.Host == "127.0.0.1" && uri.Port == 4178;
        }

        private static void OpenExternal(string value)
        {
            try { Process.Start(new ProcessStartInfo(value) { UseShellExecute = true }); }
            catch { }
        }

        internal void ShowWorkspace()
        {
            if (!Visible) Show();
            if (WindowState == FormWindowState.Minimized) WindowState = FormWindowState.Normal;
            Activate();
            BringToFront();
        }

        internal void OpenOrLoadWorkspace()
        {
            ShowWorkspace();
            if (webView.CoreWebView2 == null || webView.Source == null) LoadWorkspace();
            else
            {
                statusPanel.Visible = false;
                webView.Visible = true;
            }
        }

        internal void PermitClose() { allowClose = true; }

        private void OnFormClosing(object sender, FormClosingEventArgs args)
        {
            if (allowClose) return;
            args.Cancel = true;
            Hide();
            if (!closeHintShown)
            {
                closeHintShown = true;
                MessageBox.Show("Classmate Lilith 已缩到系统托盘，本地服务仍在运行。需要彻底退出时，请使用托盘菜单中的“退出并停止服务”。", "Classmate Lilith", MessageBoxButtons.OK, MessageBoxIcon.Information);
            }
        }
    }

    sealed class TrayContext : ApplicationContext
    {
        private readonly NotifyIcon tray;
        private readonly string token = Guid.NewGuid().ToString("N");
        private readonly string baseDir;
        private readonly WorkspaceForm workspace;
        private readonly EventWaitHandle reopenSignal;
        private readonly RegisteredWaitHandle reopenRegistration;
        private readonly System.Windows.Forms.Timer startupTimer;
        private Process serverProcess;
        private int startupAttempts;
        private bool isQuitting;

        internal TrayContext(string reopenEventName)
        {
            baseDir = AppDomain.CurrentDomain.BaseDirectory;
            workspace = new WorkspaceForm(baseDir);
            workspace.RetryRequested += delegate { BeginStartup(); };
            workspace.BrowserRequested += delegate { Program.OpenBrowser(); };
            workspace.ShowStarting("正在检查本地服务……");

            reopenSignal = new EventWaitHandle(false, EventResetMode.AutoReset, reopenEventName);
            reopenRegistration = ThreadPool.RegisterWaitForSingleObject(reopenSignal, delegate
            {
                try { workspace.BeginInvoke(new MethodInvoker(OpenWorkspace)); }
                catch { }
            }, null, Timeout.Infinite, false);

            tray = new NotifyIcon();
            string iconPath = Path.Combine(baseDir, "assets", "app.ico");
            tray.Icon = File.Exists(iconPath) ? new Icon(iconPath) : SystemIcons.Application;
            tray.Text = "Classmate Lilith - 本地服务正在运行";
            var menu = new ContextMenuStrip();
            menu.Items.Add("显示 Classmate Lilith", null, delegate { OpenWorkspace(); });
            menu.Items.Add("使用浏览器打开", null, delegate { Program.OpenBrowser(); });
            menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add("退出并停止服务", null, delegate { StopAndExit(); });
            tray.ContextMenuStrip = menu;
            tray.DoubleClick += delegate { OpenWorkspace(); };
            tray.Visible = true;

            startupTimer = new System.Windows.Forms.Timer();
            startupTimer.Interval = 200;
            startupTimer.Tick += delegate { PollStartup(); };
            BeginStartup();
        }

        private void BeginStartup()
        {
            startupTimer.Stop();
            workspace.ShowStarting("正在检查本地服务……");
            if (IsAppAvailable())
            {
                workspace.LoadWorkspace();
                return;
            }
            StartServer();
            startupAttempts = 0;
            startupTimer.Start();
        }

        private void PollStartup()
        {
            startupAttempts++;
            if (IsAppAvailable())
            {
                startupTimer.Stop();
                workspace.LoadWorkspace();
                tray.BalloonTipTitle = "Classmate Lilith 已启动";
                tray.BalloonTipText = "独立窗口已就绪；关闭窗口会缩到系统托盘。";
                tray.ShowBalloonTip(2200);
                return;
            }
            if (startupAttempts >= 75 || (serverProcess != null && serverProcess.HasExited))
            {
                startupTimer.Stop();
                workspace.ShowFailure("本地服务启动失败。请确认运行组件完整，并检查 4178 端口是否被其他程序占用。", false);
            }
        }

        private void StartServer()
        {
            string serverFile = Path.Combine(baseDir, "server.mjs");
            if (!File.Exists(serverFile)) return;
            string nodeFile = FindNode();
            if (nodeFile == null)
            {
                workspace.ShowFailure("没有找到 Node.js 运行组件。请重新下载完整的 Windows ZIP。", false);
                return;
            }
            var info = new ProcessStartInfo();
            info.FileName = nodeFile;
            info.Arguments = "\"" + serverFile + "\"";
            info.WorkingDirectory = baseDir;
            info.UseShellExecute = false;
            info.CreateNoWindow = true;
            info.WindowStyle = ProcessWindowStyle.Hidden;
            try
            {
                Environment.SetEnvironmentVariable("TRANSCRIPT_POLISHER_LAUNCH_TOKEN", token, EnvironmentVariableTarget.Process);
                Environment.SetEnvironmentVariable("NO_PROXY", "127.0.0.1,localhost", EnvironmentVariableTarget.Process);
                Environment.SetEnvironmentVariable("no_proxy", "127.0.0.1,localhost", EnvironmentVariableTarget.Process);
                serverProcess = Process.Start(info);
                workspace.ShowStarting("本地服务正在启动……");
            }
            catch (Exception ex) { workspace.ShowFailure("无法启动 Node.js：" + ex.Message, false); }
        }

        private string FindNode()
        {
            string programFiles = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles);
            string localAppData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
            string[] candidates = new string[] {
                Path.Combine(baseDir, "runtime", "node", "node.exe"), Path.Combine(baseDir, "node", "node.exe"),
                Path.Combine(programFiles, "nodejs", "node.exe"), Path.Combine(localAppData, "Programs", "nodejs", "node.exe")
            };
            foreach (string candidate in candidates) if (File.Exists(candidate)) return candidate;
            string pathValue = Environment.GetEnvironmentVariable("PATH") ?? "";
            foreach (string folder in pathValue.Split(';'))
            {
                try { string candidate = Path.Combine(folder.Trim(), "node.exe"); if (File.Exists(candidate)) return candidate; }
                catch { }
            }
            return null;
        }

        private bool IsHealthy()
        {
            try
            {
                var request = (HttpWebRequest)WebRequest.Create(Program.Url + "/api/health");
                request.Proxy = null;
                request.Timeout = 350;
                request.ReadWriteTimeout = 350;
                using (var response = (HttpWebResponse)request.GetResponse())
                using (var reader = new StreamReader(response.GetResponseStream(), Encoding.UTF8))
                {
                    string body = reader.ReadToEnd();
                    return response.StatusCode == HttpStatusCode.OK && body.Contains("\"app\":\"classmate-lilith\"");
                }
            }
            catch { return false; }
        }

        private bool IsAppAvailable()
        {
            if (IsHealthy()) return true;
            try
            {
                var request = (HttpWebRequest)WebRequest.Create(Program.Url + "/");
                request.Proxy = null;
                request.Timeout = 450;
                request.ReadWriteTimeout = 450;
                using (var response = (HttpWebResponse)request.GetResponse())
                using (var reader = new StreamReader(response.GetResponseStream(), Encoding.UTF8))
                {
                    string html = reader.ReadToEnd();
                    return response.StatusCode == HttpStatusCode.OK && html.Contains("Classmate Lilith");
                }
            }
            catch { return false; }
        }

        private void OpenWorkspace()
        {
            if (IsAppAvailable()) workspace.OpenOrLoadWorkspace();
            else if (serverProcess != null && !serverProcess.HasExited)
            {
                workspace.ShowStarting("正在等待本地服务……");
                startupAttempts = 0;
                startupTimer.Start();
            }
            else BeginStartup();
        }

        private void StopAndExit()
        {
            if (isQuitting) return;
            isQuitting = true;
            startupTimer.Stop();
            try
            {
                var request = (HttpWebRequest)WebRequest.Create(Program.Url + "/api/shutdown");
                request.Proxy = null;
                request.Method = "POST";
                request.Headers["X-Launcher-Token"] = token;
                request.Timeout = 800;
                using (request.GetResponse()) { }
            }
            catch { }
            try
            {
                if (serverProcess != null && !serverProcess.HasExited && !serverProcess.WaitForExit(1200)) serverProcess.Kill();
            }
            catch { }
            workspace.PermitClose();
            workspace.Close();
            tray.Visible = false;
            tray.Dispose();
            reopenRegistration.Unregister(null);
            reopenSignal.Dispose();
            ExitThread();
        }

        protected override void ExitThreadCore()
        {
            tray.Visible = false;
            tray.Dispose();
            base.ExitThreadCore();
        }
    }
}
