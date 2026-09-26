import AppKit
import Foundation

@main
final class AppDelegate: NSObject, NSApplicationDelegate {
    private let workspaceURL = URL(string: "http://127.0.0.1:4178")!
    private let healthURL = URL(string: "http://127.0.0.1:4178/api/health")!
    private let launchToken = UUID().uuidString.replacingOccurrences(of: "-", with: "")
    private var statusItem: NSStatusItem!
    private var serverProcess: Process?
    private var startupTimer: Timer?
    private var startupAttempts = 0
    private var healthCheckInFlight = false
    private var isQuitting = false

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.accessory)
        configureStatusMenu()
        checkServiceHealth { [weak self] healthy in
            guard let self else { return }
            if healthy {
                self.openWorkspaceInBrowser()
            } else {
                self.startServer()
                self.waitForServer()
            }
        }
    }

    func applicationWillTerminate(_ notification: Notification) {
        startupTimer?.invalidate()
        if let process = serverProcess, process.isRunning { process.terminate() }
    }

    private var appRoot: URL {
        guard let resources = Bundle.main.resourceURL else { fatalError("Missing app resources") }
        return resources.appendingPathComponent("app", isDirectory: true)
    }

    private var dataDirectory: URL {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first!
        return base.appendingPathComponent("Classmate Lilith", isDirectory: true)
            .appendingPathComponent("data", isDirectory: true)
    }

    private var logsDirectory: URL {
        let base = FileManager.default.urls(for: .libraryDirectory, in: .userDomainMask).first!
        return base.appendingPathComponent("Logs", isDirectory: true)
            .appendingPathComponent("Classmate Lilith", isDirectory: true)
    }

    private func configureStatusMenu() {
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        if let button = statusItem.button {
            let icon = NSWorkspace.shared.icon(forFile: Bundle.main.bundlePath)
            icon.size = NSSize(width: 18, height: 18)
            icon.isTemplate = false
            button.image = icon
            button.toolTip = "Classmate Lilith"
        }

        let menu = NSMenu()
        menu.addItem(withTitle: "打开 Classmate Lilith", action: #selector(openWorkspace), keyEquivalent: "o")
        menu.addItem(withTitle: "打开日志文件夹", action: #selector(openLogs), keyEquivalent: "l")
        menu.addItem(.separator())
        menu.addItem(withTitle: "退出并停止服务", action: #selector(stopAndQuit), keyEquivalent: "q")
        for item in menu.items { item.target = self }
        statusItem.menu = menu
    }

    private func startServer() {
        let node = appRoot.appendingPathComponent("runtime/node/bin/node")
        let server = appRoot.appendingPathComponent("server.mjs")
        guard FileManager.default.isExecutableFile(atPath: node.path), FileManager.default.fileExists(atPath: server.path) else {
            showError("应用运行组件不完整，请重新下载并解压 Classmate Lilith。")
            return
        }

        do {
            try FileManager.default.createDirectory(at: dataDirectory, withIntermediateDirectories: true)
            try FileManager.default.createDirectory(at: logsDirectory, withIntermediateDirectories: true)
            let launcherLog = logsDirectory.appendingPathComponent("launcher.log")
            if !FileManager.default.fileExists(atPath: launcherLog.path) {
                FileManager.default.createFile(atPath: launcherLog.path, contents: nil)
            }
            let logHandle = try FileHandle(forWritingTo: launcherLog)
            try logHandle.seekToEnd()

            let process = Process()
            process.executableURL = node
            process.arguments = [server.path]
            process.currentDirectoryURL = appRoot
            var environment = ProcessInfo.processInfo.environment
            environment["TRANSCRIPT_POLISHER_LAUNCH_TOKEN"] = launchToken
            environment["CLASSMATE_DATA_DIR"] = dataDirectory.path
            environment["CLASSMATE_LOG_DIR"] = logsDirectory.path
            environment["NO_PROXY"] = "127.0.0.1,localhost"
            environment["no_proxy"] = "127.0.0.1,localhost"
            process.environment = environment
            process.standardOutput = logHandle
            process.standardError = logHandle
            process.terminationHandler = { [weak self] task in
                guard let self, !self.isQuitting else { return }
                DispatchQueue.main.async {
                    self.showError("本地服务意外退出（代码 \(task.terminationStatus)）。可在菜单栏打开日志文件夹查看原因。")
                }
            }
            try process.run()
            serverProcess = process
        } catch {
            showError("无法启动本地服务：\(error.localizedDescription)")
        }
    }

    private func waitForServer() {
        startupAttempts = 0
        startupTimer?.invalidate()
        startupTimer = Timer.scheduledTimer(withTimeInterval: 0.18, repeats: true) { [weak self] timer in
            guard let self else { timer.invalidate(); return }
            self.startupAttempts += 1
            if self.healthCheckInFlight { return }
            if self.startupAttempts >= 50 || self.serverProcess?.isRunning == false {
                timer.invalidate()
                self.showError("本地服务启动失败。请确认应用完整，并且 4178 端口没有被其他程序占用。")
                return
            }
            self.healthCheckInFlight = true
            self.checkServiceHealth { [weak self] healthy in
                guard let self else { return }
                self.healthCheckInFlight = false
                if healthy {
                    timer.invalidate()
                    self.openWorkspaceInBrowser()
                }
            }
        }
    }

    private func session() -> URLSession {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = 0.7
        configuration.timeoutIntervalForResource = 0.9
        configuration.connectionProxyDictionary = [:]
        return URLSession(configuration: configuration)
    }

    private func checkServiceHealth(completion: @escaping (Bool) -> Void) {
        session().dataTask(with: healthURL) { data, response, _ in
            let http = response as? HTTPURLResponse
            let body = data.flatMap { String(data: $0, encoding: .utf8) } ?? ""
            let healthy = http?.statusCode == 200 && body.contains("\"app\":\"classmate-lilith\"")
            DispatchQueue.main.async { completion(healthy) }
        }.resume()
    }

    @objc private func openWorkspace() {
        checkServiceHealth { [weak self] healthy in
            guard let self else { return }
            if healthy {
                self.openWorkspaceInBrowser()
            } else if self.serverProcess?.isRunning == true {
                self.waitForServer()
            } else {
                self.startServer()
                self.waitForServer()
            }
        }
    }

    private func openWorkspaceInBrowser() {
        NSWorkspace.shared.open(workspaceURL)
    }

    @objc private func openLogs() {
        try? FileManager.default.createDirectory(at: logsDirectory, withIntermediateDirectories: true)
        NSWorkspace.shared.open(logsDirectory)
    }

    @objc private func stopAndQuit() {
        isQuitting = true
        startupTimer?.invalidate()
        var request = URLRequest(url: workspaceURL.appendingPathComponent("api/shutdown"))
        request.httpMethod = "POST"
        request.setValue(launchToken, forHTTPHeaderField: "X-Launcher-Token")
        session().dataTask(with: request) { [weak self] _, _, _ in
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) { self?.finishQuit() }
        }.resume()
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.4) { [weak self] in self?.finishQuit() }
    }

    private func finishQuit() {
        if let process = serverProcess, process.isRunning { process.terminate() }
        NSApp.terminate(nil)
    }

    private func showError(_ message: String) {
        let alert = NSAlert()
        alert.alertStyle = .critical
        alert.messageText = "Classmate Lilith"
        alert.informativeText = message
        alert.addButton(withTitle: "确定")
        NSApp.activate(ignoringOtherApps: true)
        alert.runModal()
    }
}
