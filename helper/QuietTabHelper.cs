// Quiet Tab helper for Windows.
//
// One small exe, three jobs:
//   (no args / chrome-extension://...)  native messaging host: tells the extension what the
//                                        current desktop wallpaper looks like, and pushes an
//                                        update whenever it changes (Lively or plain Windows).
//   --install / --uninstall             register / unregister the native messaging host.
//   --wallpaper                          debug: print what it thinks the wallpaper is.
//
// Built with the C# 5 compiler that ships with Windows (.NET Framework 4), see Install.bat.

using System;
using System.Collections;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using Microsoft.Win32;

static class QuietTabHelper
{
    const string HostName = "com.quiettab.helper";
    const string ExtensionId = "joacmdfomnhaeiljfnfjjadkjjbbkhcp";
    const string Version = "1.2.0";
    const int ThumbMax = 480;

    // Where each Chromium browser looks for native messaging hosts (Chrome's key also
    // covers browsers that reuse it).
    static readonly string[] HostRegistryRoots = {
        @"Software\imput\Helium\NativeMessagingHosts",
        @"Software\Chromium\NativeMessagingHosts",
        @"Software\Google\Chrome\NativeMessagingHosts",
        @"Software\BraveSoftware\Brave-Browser\NativeMessagingHosts",
        @"Software\Microsoft\Edge\NativeMessagingHosts",
        @"Software\Vivaldi\NativeMessagingHosts",
    };

    static readonly string LocalAppData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
    static readonly string StateDir = Path.Combine(LocalAppData, "QuietTab");
    static readonly JavaScriptSerializer Json = new JavaScriptSerializer { MaxJsonLength = int.MaxValue };

    [STAThread]
    static int Main(string[] args)
    {
        try
        {
            string first = args.Length > 0 ? args[0] : "";
            if (first == "--install") return Install();
            if (first == "--uninstall") return Uninstall();
            if (first == "--wallpaper")
            {
                var w = Wallpaper.Current();
                Console.WriteLine(w == null ? "(none)" : w.Source + " | " + w.Title + " | " + (w.ImagePath ?? w.SolidHex));
                return 0;
            }
            return new Host().Run();
        }
        catch (Exception e)
        {
            Log("fatal: " + e);
            return 1;
        }
    }

    public static void Log(string line)
    {
        try
        {
            Directory.CreateDirectory(StateDir);
            File.AppendAllText(Path.Combine(StateDir, "helper.log"), DateTime.Now.ToString("s") + " " + line + Environment.NewLine);
        }
        catch { }
    }

    // ------------------------------------------------------------------ install

    static int Install()
    {
        string exe = Process.GetCurrentProcess().MainModule.FileName;
        string manifestPath = Path.Combine(Path.GetDirectoryName(exe), HostName + ".json");
        var manifest = new Dictionary<string, object> {
            { "name", HostName },
            { "description", "Quiet Tab wallpaper helper" },
            { "path", exe },
            { "type", "stdio" },
            { "allowed_origins", new[] { "chrome-extension://" + ExtensionId + "/" } },
        };
        File.WriteAllText(manifestPath, Json.Serialize(manifest), new UTF8Encoding(false));
        foreach (var root in HostRegistryRoots)
        {
            using (var key = Registry.CurrentUser.CreateSubKey(root + "\\" + HostName))
                key.SetValue("", manifestPath);
        }
        Console.WriteLine("Registered " + HostName + " -> " + manifestPath);
        return 0;
    }

    static int Uninstall()
    {
        foreach (var root in HostRegistryRoots)
        {
            try { Registry.CurrentUser.DeleteSubKeyTree(root + "\\" + HostName, false); } catch { }
        }
        Console.WriteLine("Unregistered " + HostName);
        return 0;
    }

    // ------------------------------------------------------------------ messaging

    class Host
    {
        readonly Stream stdout = Console.OpenStandardOutput();
        readonly object writeLock = new object();
        string lastSignature;
        volatile bool wantResend = true;
        volatile bool alive = true;

        public int Run()
        {
            var reader = new Thread(ReadLoop) { IsBackground = true };
            reader.Start();
            Send(new Dictionary<string, object> { { "type", "hello" }, { "version", Version } });
            while (alive)
            {
                try { PollWallpaper(); }
                catch (Exception e) { Log("poll: " + e.Message); }
                for (int i = 0; i < 20 && alive && !wantResend; i++) Thread.Sleep(100);
            }
            return 0;
        }

        void PollWallpaper()
        {
            var w = Wallpaper.Current();
            string sig = w == null ? "none" : w.Signature;
            if (sig == lastSignature && !wantResend) return;
            wantResend = false;
            lastSignature = sig;

            var msg = new Dictionary<string, object> { { "type", "wallpaper" }, { "stamp", sig } };
            if (w != null)
            {
                msg["source"] = w.Source;
                msg["title"] = w.Title;
                if (w.SolidHex != null) msg["color"] = w.SolidHex;
                else msg["image"] = Wallpaper.Thumbnail(w.ImagePath, ThumbMax);
            }
            Send(msg);
        }

        void ReadLoop()
        {
            var stdin = Console.OpenStandardInput();
            var lenBuf = new byte[4];
            try
            {
                while (true)
                {
                    if (!ReadExact(stdin, lenBuf, 4)) break;
                    int len = BitConverter.ToInt32(lenBuf, 0);
                    var buf = new byte[len];
                    if (!ReadExact(stdin, buf, len)) break;
                    Handle((Dictionary<string, object>)Json.DeserializeObject(Encoding.UTF8.GetString(buf)));
                }
            }
            catch (Exception e) { Log("read: " + e.Message); }
            alive = false; // browser closed the port
        }

        void Handle(Dictionary<string, object> msg)
        {
            string type = msg.ContainsKey("type") ? (string)msg["type"] : "";
            if (type == "refresh") { wantResend = true; return; }
        }

        static bool ReadExact(Stream s, byte[] buf, int n)
        {
            int off = 0;
            while (off < n)
            {
                int r = s.Read(buf, off, n - off);
                if (r <= 0) return false;
                off += r;
            }
            return true;
        }

        void Send(object obj)
        {
            byte[] body = Encoding.UTF8.GetBytes(Json.Serialize(obj));
            lock (writeLock)
            {
                stdout.Write(BitConverter.GetBytes(body.Length), 0, 4);
                stdout.Write(body, 0, body.Length);
                stdout.Flush();
            }
        }
    }

    // ------------------------------------------------------------------ wallpaper

    class Wallpaper
    {
        public string Source, Title, ImagePath, SolidHex, Signature;

        static readonly string[] ImageExts = { ".jpg", ".jpeg", ".png", ".bmp", ".gif", ".tif", ".tiff", ".jfif" };

        public static Wallpaper Current()
        {
            return Lively() ?? Windows();
        }

        // Lively Wallpaper draws over the real desktop while it runs. Its layout file points at
        // the active wallpaper's folder; LivelyInfo.json there names the file and a thumbnail.
        static Wallpaper Lively()
        {
            if (Process.GetProcessesByName("Lively").Length == 0) return null;
            var candidates = new List<string> { Path.Combine(LocalAppData, "Lively Wallpaper") };
            string packages = Path.Combine(LocalAppData, "Packages");
            if (Directory.Exists(packages))
                foreach (var d in Directory.GetDirectories(packages, "*LivelyWallpaper*"))
                    candidates.Add(Path.Combine(d, @"LocalCache\Local\Lively Wallpaper"));

            foreach (var dir in candidates)
            {
                string layoutPath = Path.Combine(dir, "WallpaperLayout.json");
                if (!File.Exists(layoutPath)) continue;
                var layout = Json.DeserializeObject(ReadShared(layoutPath)) as object[];
                if (layout == null) continue;

                // Prefer the live entry on the primary screen.
                string infoDir = null;
                foreach (var pass in new[] { true, false })
                {
                    foreach (Dictionary<string, object> entry in layout)
                    {
                        var screen = entry.ContainsKey("LivelyScreen") ? entry["LivelyScreen"] as Dictionary<string, object> : null;
                        bool stale = screen != null && screen.ContainsKey("isStale") && screen["isStale"] is bool && (bool)screen["isStale"];
                        bool primary = screen != null && screen.ContainsKey("IsPrimary") && screen["IsPrimary"] is bool && (bool)screen["IsPrimary"];
                        if (stale || (pass && !primary)) continue;
                        infoDir = entry["LivelyInfoPath"] as string;
                        break;
                    }
                    if (infoDir != null) break;
                }
                if (infoDir == null || !Directory.Exists(infoDir)) continue;

                string infoPath = Path.Combine(infoDir, "LivelyInfo.json");
                if (!File.Exists(infoPath)) continue;
                var info = (Dictionary<string, object>)Json.DeserializeObject(ReadShared(infoPath));
                string title = info.ContainsKey("Title") ? info["Title"] as string : null;
                string file = info.ContainsKey("FileName") ? info["FileName"] as string : null;
                bool absolute = info.ContainsKey("IsAbsolutePath") && info["IsAbsolutePath"] is bool && (bool)info["IsAbsolutePath"];

                string image = null;
                if (file != null)
                {
                    string full = absolute ? file : Path.Combine(infoDir, file);
                    if (ImageExts.Contains(Path.GetExtension(full).ToLowerInvariant()) && File.Exists(full)) image = full;
                }
                foreach (var key in new[] { "Thumbnail", "Preview" })
                {
                    if (image != null) break;
                    string name = info.ContainsKey(key) ? info[key] as string : null;
                    if (string.IsNullOrEmpty(name)) continue;
                    string full = Path.IsPathRooted(name) ? name : Path.Combine(infoDir, name);
                    if (File.Exists(full) && ImageExts.Contains(Path.GetExtension(full).ToLowerInvariant())) image = full;
                }
                if (image == null) continue;
                return Make("lively", title ?? Path.GetFileNameWithoutExtension(image), image);
            }
            return null;
        }

        [DllImport("user32.dll", CharSet = CharSet.Unicode)]
        static extern bool SystemParametersInfo(uint action, uint uiParam, StringBuilder pvParam, uint winIni);

        static Wallpaper Windows()
        {
            var sb = new StringBuilder(1024);
            SystemParametersInfo(0x0073 /* SPI_GETDESKWALLPAPER */, (uint)sb.Capacity, sb, 0);
            string path = sb.ToString();
            string transcoded = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), @"Microsoft\Windows\Themes\TranscodedWallpaper");

            if (!string.IsNullOrEmpty(path) && File.Exists(path) && CanDecode(path))
                return Make("windows", Path.GetFileNameWithoutExtension(path), path);
            if (!string.IsNullOrEmpty(path) && File.Exists(transcoded))
                return Make("windows", Path.GetFileNameWithoutExtension(path), transcoded);

            // Solid colour desktop.
            using (var key = Registry.CurrentUser.OpenSubKey(@"Control Panel\Colors"))
            {
                var bg = key == null ? null : key.GetValue("Background") as string;
                if (bg == null) return null;
                var rgb = bg.Split(' ').Select(int.Parse).ToArray();
                string hex = string.Format("#{0:x2}{1:x2}{2:x2}", rgb[0], rgb[1], rgb[2]);
                return new Wallpaper { Source = "solid", Title = "Solid colour", SolidHex = hex, Signature = "solid:" + hex };
            }
        }

        static bool CanDecode(string path)
        {
            return ImageExts.Contains(Path.GetExtension(path).ToLowerInvariant());
        }

        static Wallpaper Make(string source, string title, string image)
        {
            var fi = new FileInfo(image);
            return new Wallpaper
            {
                Source = source,
                Title = title,
                ImagePath = image,
                Signature = source + ":" + image + ":" + fi.LastWriteTimeUtc.Ticks + ":" + fi.Length,
            };
        }

        static string ReadShared(string path)
        {
            using (var fs = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete))
            using (var sr = new StreamReader(fs)) return sr.ReadToEnd();
        }

        public static string Thumbnail(string path, int max)
        {
            byte[] raw;
            using (var fs = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete))
            using (var ms = new MemoryStream()) { fs.CopyTo(ms); raw = ms.ToArray(); }

            using (var src = Image.FromStream(new MemoryStream(raw)))
            {
                double scale = Math.Min(1.0, (double)max / Math.Max(src.Width, src.Height));
                int w = Math.Max(1, (int)(src.Width * scale)), h = Math.Max(1, (int)(src.Height * scale));
                using (var bmp = new Bitmap(w, h))
                {
                    using (var g = Graphics.FromImage(bmp))
                    {
                        g.InterpolationMode = InterpolationMode.HighQualityBicubic;
                        g.DrawImage(src, 0, 0, w, h);
                    }
                    var codec = ImageCodecInfo.GetImageEncoders().First(c => c.FormatID == ImageFormat.Jpeg.Guid);
                    var ep = new EncoderParameters(1);
                    ep.Param[0] = new EncoderParameter(System.Drawing.Imaging.Encoder.Quality, 88L);
                    using (var outMs = new MemoryStream())
                    {
                        bmp.Save(outMs, codec, ep);
                        return "data:image/jpeg;base64," + Convert.ToBase64String(outMs.ToArray());
                    }
                }
            }
        }
    }
}
