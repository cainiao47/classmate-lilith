using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net;
using System.Text;
using System.Threading;
using System.Windows.Forms;

namespace ClassmateLilithLauncher
{
    static class Program
    {
        private const string Url = "http://127.0.0.1:4178";
        private static Mutex singleInstance;

        [STAThread]
        static void Main()
        {
            Application.SetUnhandledExceptionMode(UnhandledExceptionMode.CatchException);
            Application.ThreadException += delegate(object sender, ThreadExceptionEventArgs args) { ReportFailure(args.Exception); };
            AppDomain.CurrentDomain.UnhandledException += delegate(object sender, UnhandledExceptionEventArgs args) { ReportFailure(args.ExceptionObject as Exception); };
            try { Run(); }
            catch (Exception ex) { ReportFailure(ex); }
        }

        private static void Run()
        {
            bool created;
            singleInstance = new Mutex(true, "Local\\ClassmateLilithLauncher-4178", out created);
            if (!created)
            {
                OpenBrowser();
                return;
            }
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new TrayContext());
            GC.KeepAlive(singleInstance);
        }

        private static void ReportFailure(Exception error)
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

    sealed class TrayContext : ApplicationContext
    {
        private readonly NotifyIcon tray;
        private readonly string token = Guid.NewGuid().ToString("N");
        private Process serverProcess;
        private readonly string baseDir;

        public TrayContext()
        {
            baseDir = AppDomain.CurrentDomain.BaseDirectory;
            tray = new NotifyIcon();
            string iconPath = Path.Combine(baseDir, "assets", "app.ico");
            tray.Icon = File.Exists(iconPath) ? new Icon(iconPath) : SystemIcons.Application;
            tray.Text = "Classmate Lilith - 本地服务正在运行";
            var menu = new ContextMenuStrip();
            menu.Items.Add("打开 Classmate Lilith", null, delegate { OpenWorkspace(); });
            menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add("退出并停止服务", null, delegate { StopAndExit(); });
            tray.ContextMenuStrip = menu;
            tray.DoubleClick += delegate { OpenWorkspace(); };
            tray.Visible = true;

            if (!IsAppAvailable()) StartServer();
            if (!WaitUntilReady())
            {
                tray.Visible = false;
                MessageBox.Show("本地服务启动失败。请确认运行组件完整，并且 4178 端口未被其他程序占用。", "Classmate Lilith", MessageBoxButtons.OK, MessageBoxIcon.Error);
                ExitThread();
                return;
            }
            Program.OpenBrowser();
            tray.BalloonTipTitle = "Classmate Lilith 已启动";
            tray.BalloonTipText = "关闭网页不会停止服务；可从系统托盘退出。";
            tray.ShowBalloonTip(2500);
        }

        private void StartServer()
        {
            string serverFile = Path.Combine(baseDir, "server.mjs");
            if (!File.Exists(serverFile)) return;
            string nodeFile = FindNode();
            if (nodeFile == null)
            {
                MessageBox.Show("没有找到 Node.js 运行组件。便携版应包含 runtime\\node\\node.exe，也可以使用电脑中已安装的 Node.js。", "Classmate Lilith", MessageBoxButtons.OK, MessageBoxIcon.Error);
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
                // ProcessStartInfo.EnvironmentVariables can throw on Windows when the
                // inherited environment contains both Path and PATH. Setting these on
                // the launcher process lets the child inherit them without enumerating
                // that legacy case-insensitive dictionary.
                Environment.SetEnvironmentVariable("TRANSCRIPT_POLISHER_LAUNCH_TOKEN", token, EnvironmentVariableTarget.Process);
                Environment.SetEnvironmentVariable("NO_PROXY", "127.0.0.1,localhost", EnvironmentVariableTarget.Process);
                Environment.SetEnvironmentVariable("no_proxy", "127.0.0.1,localhost", EnvironmentVariableTarget.Process);
                serverProcess = Process.Start(info);
            }
            catch (Exception ex)
            {
                MessageBox.Show("无法启动 Node.js：" + ex.Message, "Classmate Lilith", MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
        }

        private string FindNode()
        {
            string programFiles = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles);
            string localAppData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
            string[] candidates = new string[] {
                Path.Combine(baseDir, "runtime", "node", "node.exe"),
                Path.Combine(baseDir, "node", "node.exe"),
                Path.Combine(programFiles, "nodejs", "node.exe"),
                Path.Combine(localAppData, "Programs", "nodejs", "node.exe")
            };
            foreach (string candidate in candidates) if (File.Exists(candidate)) return candidate;
            string pathValue = Environment.GetEnvironmentVariable("PATH") ?? "";
            foreach (string folder in pathValue.Split(';'))
            {
                try
                {
                    string candidate = Path.Combine(folder.Trim(), "node.exe");
                    if (File.Exists(candidate)) return candidate;
                }
                catch { }
            }
            return null;
        }

        private bool WaitUntilReady()
        {
            for (int i = 0; i < 40; i++)
            {
                if (IsAppAvailable()) return true;
                if (serverProcess != null && serverProcess.HasExited) return false;
                Thread.Sleep(150);
            }
            return false;
        }

        private void OpenWorkspace()
        {
            if (!IsAppAvailable())
            {
                try
                {
                    if (serverProcess != null && !serverProcess.HasExited)
                    {
                        serverProcess.Kill();
                        serverProcess.WaitForExit(1200);
                    }
                }
                catch { }
                StartServer();
                if (!WaitUntilReady())
                {
                    MessageBox.Show("本地网页暂时无法连接，自动恢复也没有成功。请确认 4178 端口未被其他程序占用。", "Classmate Lilith", MessageBoxButtons.OK, MessageBoxIcon.Error);
                    return;
                }
            }
            Program.OpenBrowser();
        }

        private bool IsHealthy()
        {
            try
            {
                var request = (HttpWebRequest)WebRequest.Create("http://127.0.0.1:4178/api/health");
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
                var request = (HttpWebRequest)WebRequest.Create("http://127.0.0.1:4178/");
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

        private void StopAndExit()
        {
            try
            {
                var request = (HttpWebRequest)WebRequest.Create("http://127.0.0.1:4178/api/shutdown");
                request.Proxy = null;
                request.Method = "POST";
                request.Headers["X-Launcher-Token"] = token;
                request.Timeout = 800;
                using (request.GetResponse()) { }
            }
            catch { }
            try
            {
                if (serverProcess != null && !serverProcess.HasExited)
                {
                    if (!serverProcess.WaitForExit(1200)) serverProcess.Kill();
                }
            }
            catch { }
            tray.Visible = false;
            tray.Dispose();
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
