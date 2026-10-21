using System;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Security.Cryptography;
using System.Threading;
using System.Windows.Forms;

namespace ClassmateLilithUpdate
{
    static class UpdateHelper
    {
        private static string Quote(string value) { return "\"" + value.Replace("\"", "") + "\""; }
        private static bool IsInside(string parent, string file)
        {
            return Path.GetFullPath(file).StartsWith(Path.GetFullPath(parent).TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase);
        }
        private static void WaitForExit(int id, int milliseconds)
        {
            try { using (Process process = Process.GetProcessById(id)) if (!process.WaitForExit(milliseconds)) throw new Exception("程序仍在运行，已取消覆盖安装。"); }
            catch (ArgumentException) { }
        }
        private static void CopyTree(string from, string to)
        {
            Directory.CreateDirectory(to);
            foreach (string file in Directory.GetFiles(from))
            {
                if ((File.GetAttributes(file) & FileAttributes.ReparsePoint) != 0) throw new Exception("备份中存在异常链接。");
                File.Copy(file, Path.Combine(to, Path.GetFileName(file)), true);
            }
            foreach (string folder in Directory.GetDirectories(from))
            {
                if ((File.GetAttributes(folder) & FileAttributes.ReparsePoint) != 0) throw new Exception("备份中存在异常链接。");
                CopyTree(folder, Path.Combine(to, Path.GetFileName(folder)));
            }
        }
        private static bool Healthy(string version)
        {
            try
            {
                var request = (HttpWebRequest)WebRequest.Create("http://127.0.0.1:4178/api/health");
                request.Proxy = null; request.Timeout = 800;
                using (var response = request.GetResponse()) using (var reader = new StreamReader(response.GetResponseStream()))
                {
                    string body = reader.ReadToEnd();
                    return body.Contains("\"app\":\"classmate-lilith\"") && body.Contains("\"version\":\"" + version + "\"");
                }
            }
            catch { return false; }
        }
        [STAThread]
        static int Main(string[] args)
        {
            string app = "", backup = "", log = "";
            bool installStarted = false;
            Process newLauncher = null;
            try
            {
                if (args.Length != 8) throw new Exception("更新参数不完整。");
                string package = Path.GetFullPath(args[0]);
                app = Path.GetFullPath(args[4]); backup = Path.GetFullPath(args[5]);
                string ready = Path.GetFullPath(args[6]);
                string configuredData = Environment.GetEnvironmentVariable("CLASSMATE_DATA_DIR");
                string support = String.IsNullOrEmpty(configuredData)
                    ? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments), "Classmate Lilith")
                    : Path.GetDirectoryName(Path.GetFullPath(configuredData));
                string cache = Path.Combine(support, "updates");
                if (!IsInside(cache, package) || !IsInside(cache, backup) || !IsInside(cache, ready) ||
                    !IsInside(cache, Application.ExecutablePath) || !File.Exists(Path.Combine(app, "installation.json")) || !File.Exists(Path.Combine(backup, "backup.json")))
                    throw new Exception("更新目录验证失败。");
                log = Path.Combine(cache, "last-update.log");
                string hash;
                using (var algorithm = SHA256.Create()) using (var input = File.OpenRead(package))
                    hash = BitConverter.ToString(algorithm.ComputeHash(input)).Replace("-", "").ToLowerInvariant();
                if (!String.Equals(hash, args[1], StringComparison.Ordinal)) throw new Exception("安装文件校验失败。");
                int serverPid = Int32.Parse(args[2]), launcherPid = Int32.Parse(args[3]);
                File.WriteAllText(ready, "ready");
                WaitForExit(serverPid, 30000);
                try { using (EventWaitHandle signal = EventWaitHandle.OpenExisting("Local\\ClassmateLilithUpdateExit-" + launcherPid)) signal.Set(); }
                catch (WaitHandleCannotBeOpenedException) { }
                WaitForExit(launcherPid, 15000);
                installStarted = true;
                var info = new ProcessStartInfo(package, "/SP- /SILENT /SUPPRESSMSGBOXES /NORESTART /UPDATE=1 /DIR=" + Quote(app));
                info.UseShellExecute = false;
                using (Process installer = Process.Start(info))
                {
                    installer.WaitForExit();
                    if (installer.ExitCode != 0) throw new Exception("安装器返回代码 " + installer.ExitCode + "，将恢复先前程序文件。");
                }
                newLauncher = Process.Start(new ProcessStartInfo(Path.Combine(app, "Classmate Lilith.exe")) { UseShellExecute = true });
                bool healthy = false;
                for (int attempt = 0; attempt < 30; attempt++) { if (Healthy(args[7])) { healthy = true; break; } Thread.Sleep(500); }
                if (!healthy) throw new Exception("新版安装后未能正常启动，将恢复先前程序文件。");
                File.AppendAllText(log, DateTime.Now.ToString("s") + " 更新安装及启动验证完成。" + Environment.NewLine);
                return 0;
            }
            catch (Exception error)
            {
                string message = error.Message;
                if (installStarted)
                {
                    if (newLauncher != null)
                    {
                        try { using (EventWaitHandle signal = EventWaitHandle.OpenExisting("Local\\ClassmateLilithUpdateExit-" + newLauncher.Id)) signal.Set(); WaitForExit(newLauncher.Id, 15000); }
                        catch { }
                    }
                    try { CopyTree(Path.Combine(backup, "app"), app); message += "\n已恢复先前程序文件，用户数据未改动。"; }
                    catch (Exception restore) { message += "\n自动恢复未完成：" + restore.Message + "\n程序备份保留在：" + backup; }
                    try { Process.Start(new ProcessStartInfo(Path.Combine(app, "Classmate Lilith.exe")) { UseShellExecute = true }); } catch { }
                }
                if (log.Length > 0) try { File.AppendAllText(log, DateTime.Now.ToString("s") + " " + message + Environment.NewLine); } catch { }
                MessageBox.Show(message, "Classmate Lilith 更新未完成", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                return 1;
            }
        }
    }
}
