import AppKit
import Foundation
import WebKit

@main
final class AppDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate, WKNavigationDelegate, WKUIDelegate, WKDownloadDelegate {
    private let workspaceURL = URL(string: "http://127.0.0.1:4178")!
    private let healthURL = URL(string: "http://127.0.0.1:4178/api/health")!
    private let launchToken = UUID().uuidString.replacingOccurrences(of: "-", with: "")
    private var mainWindow: NSWindow!
    private var webView: WKWebView!
    private var statusContainer: NSView!
    private var statusSpinner: NSProgressIndicator!
    private var statusTitle: NSTextField!
    private var statusDetail: NSTextField!
    private var retryButton: NSButton!
    private var statusItem: NSStatusItem!
    private var serverProcess: Process?
    private var launcherLogHandle: FileHandle?
    private var startupTimer: Timer?
    private var startupAttempts = 0
    private var healthCheckInFlight = false
    private var isQuitting = false

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.regular)
        configureApplicationMenu()
        configureMainWindow()
        configureStatusMenu()
        showMainWindow()
        beginStartup()
    }

    func applicationWillTerminate(_ notification: Notification) {
        isQuitting = true
        startupTimer?.invalidate()
        if let process = serverProcess, process.isRunning { process.terminate() }
        try? launcherLogHandle?.close()
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        false
    }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        showMainWindow()
        if !flag { openWorkspace() }
        return true
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

    private func configureApplicationMenu() {
        let menu = NSMenu()
        let appItem = NSMenuItem()
        let appMenu = NSMenu()
        let aboutItem = appMenu.addItem(withTitle: "关于 Classmate Lilith", action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: "")
        aboutItem.target = NSApp
        appMenu.addItem(.separator())
        let logsItem = appMenu.addItem(withTitle: "打开日志文件夹", action: #selector(openLogs), keyEquivalent: "l")
        logsItem.target = self
        appMenu.addItem(.separator())
        let quitItem = appMenu.addItem(withTitle: "退出 Classmate Lilith", action: #selector(stopAndQuit), keyEquivalent: "q")
        quitItem.target = self
        appItem.submenu = appMenu
        menu.addItem(appItem)

        let windowItem = NSMenuItem()
        let windowMenu = NSMenu(title: "窗口")
        windowMenu.addItem(withTitle: "最小化", action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m")
        windowMenu.addItem(withTitle: "显示主窗口", action: #selector(openWorkspace), keyEquivalent: "0")
        windowMenu.items.last?.target = self
        windowItem.submenu = windowMenu
        menu.addItem(windowItem)
        NSApp.windowsMenu = windowMenu
        NSApp.mainMenu = menu
    }

    private func configureMainWindow() {
        let frame = NSRect(x: 0, y: 0, width: 1280, height: 820)
        mainWindow = NSWindow(
            contentRect: frame,
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered,
            defer: false
        )
        mainWindow.title = "Classmate Lilith"
        mainWindow.minSize = NSSize(width: 920, height: 640)
        mainWindow.setFrameAutosaveName("ClassmateLilithMainWindow")
        mainWindow.isReleasedWhenClosed = false
        mainWindow.delegate = self
        mainWindow.titlebarAppearsTransparent = true
        mainWindow.titlebarSeparatorStyle = .none
        mainWindow.backgroundColor = NSColor(calibratedRed: 0.969, green: 0.941, blue: 0.898, alpha: 1)
        mainWindow.isMovableByWindowBackground = true
        mainWindow.center()

        let root = NSView(frame: frame)
        root.autoresizingMask = [.width, .height]
        mainWindow.contentView = root

        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .default()
        webView = WKWebView(frame: root.bounds, configuration: configuration)
        webView.autoresizingMask = [.width, .height]
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.isHidden = true
        root.addSubview(webView)

        let visual = NSVisualEffectView(frame: root.bounds)
        visual.autoresizingMask = [.width, .height]
        visual.material = .underWindowBackground
        visual.blendingMode = .behindWindow
        visual.state = .active
        visual.wantsLayer = true
        visual.layer?.backgroundColor = NSColor(calibratedRed: 0.969, green: 0.941, blue: 0.898, alpha: 0.9).cgColor
        statusContainer = visual
        root.addSubview(statusContainer)

        let brandIcon = NSImageView()
        brandIcon.image = NSWorkspace.shared.icon(forFile: Bundle.main.bundlePath)
        brandIcon.imageScaling = .scaleProportionallyUpOrDown
        brandIcon.translatesAutoresizingMaskIntoConstraints = false
        NSLayoutConstraint.activate([
            brandIcon.widthAnchor.constraint(equalToConstant: 82),
            brandIcon.heightAnchor.constraint(equalToConstant: 82)
        ])

        statusSpinner = NSProgressIndicator()
        statusSpinner.style = .spinning
        statusSpinner.controlSize = .large

        statusTitle = NSTextField(labelWithString: "正在启动 Classmate Lilith")
        statusTitle.font = NSFont.systemFont(ofSize: 22, weight: .semibold)
        statusTitle.textColor = NSColor(calibratedRed: 0.357, green: 0.224, blue: 0.157, alpha: 1)
        statusTitle.alignment = .center

        statusDetail = NSTextField(wrappingLabelWithString: "正在准备本地工作台，请稍候……")
        statusDetail.font = NSFont.systemFont(ofSize: 13)
        statusDetail.textColor = NSColor(calibratedRed: 0.475, green: 0.396, blue: 0.345, alpha: 1)
        statusDetail.alignment = .center
        statusDetail.maximumNumberOfLines = 4
        statusDetail.preferredMaxLayoutWidth = 560

        retryButton = NSButton(title: "重新尝试", target: self, action: #selector(retryStartup))
        retryButton.bezelStyle = .rounded
        retryButton.keyEquivalent = "\r"
        retryButton.isHidden = true

        let logsButton = NSButton(title: "打开日志文件夹", target: self, action: #selector(openLogs))
        logsButton.bezelStyle = .rounded

        let buttons = NSStackView(views: [retryButton, logsButton])
        buttons.orientation = .horizontal
        buttons.alignment = .centerY
        buttons.spacing = 10

        let stack = NSStackView(views: [brandIcon, statusSpinner, statusTitle, statusDetail, buttons])
        stack.orientation = .vertical
        stack.alignment = .centerX
        stack.spacing = 14
        stack.translatesAutoresizingMaskIntoConstraints = false
        statusContainer.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.centerXAnchor.constraint(equalTo: statusContainer.centerXAnchor),
            stack.centerYAnchor.constraint(equalTo: statusContainer.centerYAnchor),
            stack.leadingAnchor.constraint(greaterThanOrEqualTo: statusContainer.leadingAnchor, constant: 40),
            stack.trailingAnchor.constraint(lessThanOrEqualTo: statusContainer.trailingAnchor, constant: -40),
            statusDetail.widthAnchor.constraint(lessThanOrEqualToConstant: 560)
        ])
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
        menu.addItem(withTitle: "显示 Classmate Lilith", action: #selector(openWorkspace), keyEquivalent: "o")
        menu.addItem(withTitle: "打开日志文件夹", action: #selector(openLogs), keyEquivalent: "l")
        menu.addItem(.separator())
        menu.addItem(withTitle: "退出并停止服务", action: #selector(stopAndQuit), keyEquivalent: "q")
        for item in menu.items { item.target = self }
        statusItem.menu = menu
    }

    private func showMainWindow() {
        mainWindow.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    private func showStarting(_ detail: String) {
        webView.isHidden = true
        statusContainer.isHidden = false
        statusSpinner.isHidden = false
        statusSpinner.startAnimation(nil)
        statusTitle.stringValue = "正在启动 Classmate Lilith"
        statusDetail.stringValue = detail
        retryButton.isHidden = true
        showMainWindow()
    }

    private func showFailure(_ message: String) {
        startupTimer?.invalidate()
        statusSpinner.stopAnimation(nil)
        statusSpinner.isHidden = true
        statusTitle.stringValue = "无法打开工作台"
        statusDetail.stringValue = message
        retryButton.isHidden = false
        webView.isHidden = true
        statusContainer.isHidden = false
        showMainWindow()
        NSApp.requestUserAttention(.criticalRequest)
    }

    private func showWebView() {
        statusSpinner.stopAnimation(nil)
        statusContainer.isHidden = true
        webView.isHidden = false
        showMainWindow()
    }

    private func beginStartup() {
        showStarting("正在检查本地服务……")
        checkServiceHealth { [weak self] healthy in
            guard let self else { return }
            if healthy {
                self.loadWorkspace()
            } else if self.startServer() {
                self.waitForServer()
            }
        }
    }

    @discardableResult
    private func startServer() -> Bool {
        let node = appRoot.appendingPathComponent("runtime/node/bin/node")
        let server = appRoot.appendingPathComponent("server.mjs")
        guard FileManager.default.isExecutableFile(atPath: node.path), FileManager.default.fileExists(atPath: server.path) else {
            showFailure("应用运行组件不完整。请重新下载完整 ZIP，解压后将应用移入“应用程序”文件夹。")
            return false
        }

        do {
            try FileManager.default.createDirectory(at: dataDirectory, withIntermediateDirectories: true)
            try FileManager.default.createDirectory(at: logsDirectory, withIntermediateDirectories: true)
            let launcherLog = logsDirectory.appendingPathComponent("launcher.log")
            if !FileManager.default.fileExists(atPath: launcherLog.path) {
                FileManager.default.createFile(atPath: launcherLog.path, contents: nil)
            }
            try launcherLogHandle?.close()
            let logHandle = try FileHandle(forWritingTo: launcherLog)
            try logHandle.seekToEnd()
            launcherLogHandle = logHandle

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
                    self.showFailure("本地服务意外退出（代码 \(task.terminationStatus)）。请打开日志文件夹查看详细原因。")
                }
            }
            try process.run()
            serverProcess = process
            showStarting("本地服务正在启动……")
            return true
        } catch {
            showFailure("无法启动本地服务：\(error.localizedDescription)")
            return false
        }
    }

    private func waitForServer() {
        startupAttempts = 0
        startupTimer?.invalidate()
        startupTimer = Timer.scheduledTimer(withTimeInterval: 0.2, repeats: true) { [weak self] timer in
            guard let self else { timer.invalidate(); return }
            self.startupAttempts += 1
            if self.healthCheckInFlight { return }
            if self.startupAttempts >= 75 || self.serverProcess?.isRunning == false {
                timer.invalidate()
                self.showFailure("本地服务启动失败。请确认应用完整，并检查 4178 端口是否被其他程序占用。")
                return
            }
            self.healthCheckInFlight = true
            self.checkServiceHealth { [weak self] healthy in
                guard let self else { return }
                self.healthCheckInFlight = false
                if healthy {
                    timer.invalidate()
                    self.loadWorkspace()
                }
            }
        }
    }

    private func session() -> URLSession {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = 0.8
        configuration.timeoutIntervalForResource = 1.0
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

    private func loadWorkspace() {
        showStarting("正在载入工作台……")
        webView.load(URLRequest(url: workspaceURL, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 15))
    }

    @objc private func openWorkspace() {
        showMainWindow()
        checkServiceHealth { [weak self] healthy in
            guard let self else { return }
            if healthy {
                if self.webView.url == nil { self.loadWorkspace() }
                else { self.showWebView() }
            } else if self.serverProcess?.isRunning == true {
                self.showStarting("正在等待本地服务……")
                self.waitForServer()
            } else {
                self.beginStartup()
            }
        }
    }

    @objc private func retryStartup() {
        beginStartup()
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

    private func isTrustedLocalURL(_ url: URL) -> Bool {
        if url.scheme == "about" || url.scheme == "blob" { return true }
        return url.scheme == "http" && url.host == "127.0.0.1" && url.port == 4178
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        showWebView()
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        showFailure("工作台载入失败：\(error.localizedDescription)")
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        showFailure("无法连接本地工作台：\(error.localizedDescription)")
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = navigationAction.request.url else {
            decisionHandler(.cancel)
            return
        }
        if navigationAction.shouldPerformDownload {
            decisionHandler(.download)
        } else if isTrustedLocalURL(url) {
            decisionHandler(.allow)
        } else {
            NSWorkspace.shared.open(url)
            decisionHandler(.cancel)
        }
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationResponse: WKNavigationResponse, decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
        decisionHandler(navigationResponse.canShowMIMEType ? .allow : .download)
    }

    func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) {
        download.delegate = self
    }

    func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) {
        download.delegate = self
    }

    func webView(_ webView: WKWebView, runOpenPanelWith parameters: WKOpenPanelParameters, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping ([URL]?) -> Void) {
        let panel = NSOpenPanel()
        panel.allowsMultipleSelection = parameters.allowsMultipleSelection
        panel.canChooseDirectories = parameters.allowsDirectories
        panel.canChooseFiles = true
        panel.beginSheetModal(for: mainWindow) { response in
            completionHandler(response == .OK ? panel.urls : nil)
        }
    }

    func webView(_ webView: WKWebView, requestMediaCapturePermissionFor origin: WKSecurityOrigin, initiatedByFrame frame: WKFrameInfo, type: WKMediaCaptureType, decisionHandler: @escaping (WKPermissionDecision) -> Void) {
        let trusted = origin.protocol == "http" && origin.host == "127.0.0.1" && origin.port == 4178
        decisionHandler(trusted ? .prompt : .deny)
    }

    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        guard navigationAction.targetFrame == nil, let url = navigationAction.request.url else { return nil }
        if isTrustedLocalURL(url) {
            webView.load(navigationAction.request)
        } else {
            NSWorkspace.shared.open(url)
        }
        return nil
    }

    func download(_ download: WKDownload, decideDestinationUsing response: URLResponse, suggestedFilename: String, completionHandler: @escaping (URL?) -> Void) {
        let panel = NSSavePanel()
        panel.nameFieldStringValue = suggestedFilename
        panel.canCreateDirectories = true
        panel.beginSheetModal(for: mainWindow) { result in
            completionHandler(result == .OK ? panel.url : nil)
        }
    }

    func downloadDidFinish(_ download: WKDownload) {
        NSSound(named: NSSound.Name("Glass"))?.play()
    }

    func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
        let alert = NSAlert()
        alert.alertStyle = .warning
        alert.messageText = "文件保存失败"
        alert.informativeText = error.localizedDescription
        alert.beginSheetModal(for: mainWindow)
    }
}
