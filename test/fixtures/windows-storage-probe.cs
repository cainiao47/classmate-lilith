using System;
using System.IO;
using System.Reflection;

static class WindowsStorageProbe
{
    static object Invoke(Type type, string name)
    {
        return type.GetMethod(name, BindingFlags.Static | BindingFlags.NonPublic).Invoke(null, null);
    }

    static void Equal(string actual, string expected)
    {
        if (!String.Equals(actual, expected, StringComparison.OrdinalIgnoreCase)) throw new Exception("Native storage path mismatch.");
    }

    static int Main()
    {
        try
        {
            string root = AppDomain.CurrentDomain.BaseDirectory;
            Type program = Assembly.LoadFrom(Path.Combine(root, "Classmate Lilith.exe")).GetType("ClassmateLilithLauncher.Program", true);
            string documentsRoot = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments), "Classmate Lilith");
            string legacyRoot = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Classmate Lilith");
            Equal((string)Invoke(program, "StorageRoot"), documentsRoot);
            Environment.SetEnvironmentVariable("CLASSMATE_DATA_DIR", Path.Combine(legacyRoot, "data"));
            Environment.SetEnvironmentVariable("CLASSMATE_LOG_DIR", Path.Combine(legacyRoot, "logs"));
            Invoke(program, "NormalizeLegacyStorageEnvironment");
            Equal((string)Invoke(program, "DataDirectory"), Path.Combine(documentsRoot, "data"));
            if (Environment.GetEnvironmentVariable("CLASSMATE_LOG_DIR") != null) throw new Exception("Obsolete log path was inherited.");

            string customData = Path.Combine(root, "custom", "data");
            string customLogs = Path.Combine(root, "custom", "logs");
            Environment.SetEnvironmentVariable("CLASSMATE_DATA_DIR", customData);
            Environment.SetEnvironmentVariable("CLASSMATE_LOG_DIR", customLogs);
            Invoke(program, "NormalizeLegacyStorageEnvironment");
            Equal((string)Invoke(program, "DataDirectory"), customData);
            Equal(Environment.GetEnvironmentVariable("CLASSMATE_LOG_DIR"), customLogs);

            // This marker belongs to this disposable probe directory only.
            File.Delete(Path.Combine(root, "installation.json"));
            Equal((string)Invoke(program, "StorageRoot"), root);
            Console.WriteLine("DefaultDocuments=True; LegacyUpdaterEnvironmentReset=True; CustomOverridesPreserved=True; PortableUnchanged=True");
            return 0;
        }
        catch (Exception error) { Console.Error.WriteLine(error.ToString()); return 1; }
    }
}
