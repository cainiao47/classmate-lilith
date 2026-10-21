using System;
using System.Drawing;
using System.Globalization;
using System.IO;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

[assembly: System.Runtime.Versioning.TargetFramework(".NETFramework,Version=v4.7.2")]

static class WindowsDpiProbe
{
    [DllImport("user32.dll")] internal static extern IntPtr GetWindowDpiAwarenessContext(IntPtr window);
    [DllImport("user32.dll")] internal static extern bool AreDpiAwarenessContextsEqual(IntPtr first, IntPtr second);
    [DllImport("user32.dll")] internal static extern uint GetDpiForWindow(IntPtr window);

    [STAThread]
    static int Main()
    {
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        Application.Run(new ProbeContext());
        return Environment.ExitCode;
    }

    sealed class ProbeContext : ApplicationContext
    {
        private readonly Timer timer;
        internal ProbeContext()
        {
            timer = new Timer();
            timer.Interval = 30;
            timer.Tick += async delegate { timer.Stop(); await RunProbe(); };
            timer.Start();
        }

        private async Task RunProbe()
        {
            Form form = null;
            try
            {
                string root = AppDomain.CurrentDomain.BaseDirectory;
                Type type = Assembly.LoadFrom(Path.Combine(root, "Classmate Lilith.exe")).GetType("ClassmateLilithLauncher.WorkspaceForm", true);
                form = (Form)Activator.CreateInstance(type, BindingFlags.Instance | BindingFlags.NonPublic, null, new object[] { root }, null);
                form.ShowInTaskbar = false;
                IntPtr window = form.Handle; // Create only a hidden test window; never show the user's workspace.
                if (form.Visible) throw new Exception("Probe window must remain hidden.");
                if (!AreDpiAwarenessContextsEqual(GetWindowDpiAwarenessContext(window), new IntPtr(-4))) throw new Exception("Production window is not PerMonitorV2 aware.");
                if (form.AutoScaleMode != AutoScaleMode.Dpi) throw new Exception("Production form is not using DPI autoscaling.");

                MethodInfo constrain = type.GetMethod("ConstrainToWorkingArea", BindingFlags.Static | BindingFlags.NonPublic);
                foreach (float scale in new float[] { 1F, 1.25F, 1.5F, 2F })
                {
                    Rectangle area = new Rectangle(-1920, 0, 1920, 1040);
                    Rectangle desired = new Rectangle(-2000, -50, (int)(1280 * scale), (int)(820 * scale));
                    Rectangle fitted = (Rectangle)constrain.Invoke(null, new object[] { desired, area });
                    if (!area.Contains(fitted)) throw new Exception("Scaled window does not fit its monitor.");
                }

                WebView2 web = (WebView2)type.GetField("webView", BindingFlags.Instance | BindingFlags.NonPublic).GetValue(form);
                web.Visible = true;
                IntPtr webWindow = web.Handle;
                var options = new CoreWebView2EnvironmentOptions();
                options.AdditionalBrowserArguments = "--disable-background-networking --disable-component-update --no-first-run";
                var environment = await CoreWebView2Environment.CreateAsync(null, Path.Combine(root, "isolated-webview-profile"), options);
                await web.EnsureCoreWebView2Async(environment);
                var navigation = new TaskCompletionSource<bool>();
                web.CoreWebView2.NavigationCompleted += delegate(object sender, CoreWebView2NavigationCompletedEventArgs args)
                {
                    if (args.IsSuccess) navigation.TrySetResult(true);
                    else navigation.TrySetException(new Exception("Synthetic page navigation failed."));
                };
                web.CoreWebView2.NavigateToString("<!doctype html><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'><p style='font:16px sans-serif'>高清文字测试 DPI 125% 150% 200%</p>");
                await navigation.Task;
                int screens = 0;
                foreach (Screen screen in Screen.AllScreens)
                {
                    form.Location = new Point(screen.WorkingArea.Left + 30, screen.WorkingArea.Top + 30);
                    bool matches = false;
                    double ratio = 0;
                    for (int attempt = 0; attempt < 20; attempt++)
                    {
                        await Task.Delay(100);
                        ratio = Double.Parse(await web.CoreWebView2.ExecuteScriptAsync("window.devicePixelRatio"), CultureInfo.InvariantCulture);
                        uint dpi = GetDpiForWindow(form.Handle);
                        if (dpi == form.DeviceDpi && Math.Abs(ratio - dpi / 96.0 * web.ZoomFactor) < 0.025) { matches = true; break; }
                    }
                    if (!matches) throw new Exception("WebView raster scale does not match its monitor DPI: " + ratio.ToString(CultureInfo.InvariantCulture));
                    screens++;
                    Console.WriteLine("Monitor=" + screen.DeviceName + "; WindowDpi=" + form.DeviceDpi + "; WebViewDevicePixelRatio=" + ratio.ToString(CultureInfo.InvariantCulture));
                }
                if (form.Visible) throw new Exception("Probe window became visible unexpectedly.");
                Console.WriteLine("PerMonitorV2=True; WebViewRasterMatchesDpi=True; LayoutScalesChecked=100,125,150,200; Monitors=" + screens);
            }
            catch (Exception error) { Console.Error.WriteLine(error.ToString()); Environment.ExitCode = 1; }
            finally
            {
                if (form != null) form.Dispose();
                timer.Dispose();
                ExitThread();
            }
        }
    }
}
