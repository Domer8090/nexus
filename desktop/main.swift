import Cocoa
import WebKit

/// Nexus for Mac: a window around the local Nexus server, which it starts and stops.
final class App: NSObject, NSApplicationDelegate, NSWindowDelegate, WKNavigationDelegate, WKUIDelegate, WKDownloadDelegate {
  var window: NSWindow!
  var web: WKWebView!
  let server = Process()
  let hold = Pipe()
  var origin = ""
  var log = ""
  var quitting = false

  func applicationDidFinishLaunching(_ n: Notification) {
    makeMenu()
    let conf = WKWebViewConfiguration()
    conf.websiteDataStore = .default()
    web = WKWebView(frame: .zero, configuration: conf)
    web.navigationDelegate = self
    web.uiDelegate = self
    web.allowsMagnification = true
    window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1360, height: 880), styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
    window.title = "Nexus"
    window.backgroundColor = .black
    window.appearance = NSAppearance(named: .darkAqua)
    window.titlebarAppearsTransparent = true
    window.minSize = NSSize(width: 420, height: 560)
    window.isReleasedWhenClosed = false
    window.delegate = self
    window.contentView = web
    window.center()
    window.setFrameAutosaveName("NexusMain")
    window.makeKeyAndOrderFront(nil)
    NSApp.activate(ignoringOtherApps: true)
    web.loadHTMLString("<body style='background:#000;color:#a1a1a1;font:15px -apple-system;display:grid;place-items:center;height:100vh;margin:0'>Starting Nexus…</body>", baseURL: nil)
    start()
  }

  // MARK: server

  func findNode() -> String? {
    let fm = FileManager.default
    let home = fm.homeDirectoryForCurrentUser.path
    var paths = ["/opt/homebrew/bin/node", "/usr/local/bin/node", "\(home)/.volta/bin/node", "\(home)/.local/bin/node"]
    let nvm = "\(home)/.nvm/versions/node"
    paths += ((try? fm.contentsOfDirectory(atPath: nvm)) ?? []).sorted { $0.compare($1, options: .numeric) == .orderedDescending }.map { "\(nvm)/\($0)/bin/node" }
    return paths.first { fm.isExecutableFile(atPath: $0) && nodeVersionOK($0) }
  }

  func nodeVersionOK(_ path: String) -> Bool {
    let p = Process(), out = Pipe()
    p.executableURL = URL(fileURLWithPath: path)
    p.arguments = ["-e", "const [a,b]=process.versions.node.split('.').map(Number);process.exit(a>22||(a===22&&b>=13)?0:1)"]
    p.standardOutput = out
    p.standardError = out
    guard (try? p.run()) != nil else { return false }
    p.waitUntilExit()
    return p.terminationStatus == 0
  }

  func start() {
    guard let node = findNode() else {
      return fatal("Nexus needs Node.js 22.13 or newer", "Install it from nodejs.org or with Homebrew (brew install node), then open Nexus again.")
    }
    let res = Bundle.main.resourceURL!
    server.executableURL = URL(fileURLWithPath: node)
    // Optional settings such as BACKBOARD_API_KEY live in ~/.nexus/.env, never inside the app.
    let env = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".nexus/.env").path
    server.arguments = (FileManager.default.fileExists(atPath: env) ? ["--env-file=\(env)"] : []) + [res.appendingPathComponent("boot.cjs").path]
    let out = Pipe()
    server.standardOutput = out
    server.standardError = out
    server.standardInput = hold
    var buf = ""
    out.fileHandleForReading.readabilityHandler = { [weak self] h in
      let d = h.availableData
      guard !d.isEmpty else { h.readabilityHandler = nil; return }
      let s = String(decoding: d, as: UTF8.self)
      buf = String((buf + s).suffix(4000))
      let snapshot = buf
      DispatchQueue.main.async {
        guard let self else { return }
        self.log = snapshot
        if self.origin.isEmpty, let m = snapshot.range(of: #"NEXUS_READY \d+\n"#, options: .regularExpression) {
          let port = snapshot[m].split(separator: " ")[1].trimmingCharacters(in: .whitespacesAndNewlines)
          self.origin = "http://127.0.0.1:\(port)"
          self.web.load(URLRequest(url: URL(string: self.origin + "/")!))
        }
      }
    }
    server.terminationHandler = { [weak self] _ in
      DispatchQueue.main.async {
        guard let self, !self.quitting else { return }
        self.fatal("The Nexus server stopped", String(self.log.suffix(600)))
      }
    }
    do { try server.run() } catch { fatal("Nexus could not start", error.localizedDescription) }
  }

  func fatal(_ title: String, _ text: String) {
    let a = NSAlert()
    a.alertStyle = .critical
    a.messageText = title
    a.informativeText = text
    a.runModal()
    quitting = true
    NSApp.terminate(nil)
  }

  // MARK: quitting

  func applicationShouldTerminateAfterLastWindowClosed(_ a: NSApplication) -> Bool { false }
  func applicationShouldHandleReopen(_ a: NSApplication, hasVisibleWindows v: Bool) -> Bool {
    if !v { window.makeKeyAndOrderFront(nil) }
    return true
  }

  func applicationShouldTerminate(_ a: NSApplication) -> NSApplication.TerminateReply {
    if quitting || origin.isEmpty { quitting = true; return .terminateNow }
    var req = URLRequest(url: URL(string: origin + "/api/sessions")!)
    req.timeoutInterval = 2
    URLSession.shared.dataTask(with: req) { data, _, _ in
      let j = data.flatMap { try? JSONSerialization.jsonObject(with: $0) } as? [String: Any]
      let running = j?["running"] as? Int ?? 0
      DispatchQueue.main.async {
        var ok = true
        if running > 0 {
          let al = NSAlert()
          al.messageText = running == 1 ? "An agent is still working" : "\(running) agents are still working"
          al.informativeText = "Quitting stops them. Files they already wrote stay. Close the window instead to keep them going."
          al.addButton(withTitle: "Keep working")
          al.addButton(withTitle: "Quit and stop")
          ok = al.runModal() == .alertSecondButtonReturn
        }
        self.quitting = ok
        NSApp.reply(toApplicationShouldTerminate: ok)
      }
    }.resume()
    return .terminateLater
  }

  func applicationWillTerminate(_ n: Notification) {
    quitting = true
    try? hold.fileHandleForWriting.close()
    if server.isRunning { server.terminate() }
  }

  // MARK: web

  func webView(_ w: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
    guard let url = action.request.url else { return decisionHandler(.cancel) }
    if action.shouldPerformDownload { return decisionHandler(.download) }
    // Only Nexus itself may fill the window. Preview frames and about:blank stay inside it.
    let mainFrame = action.targetFrame?.isMainFrame ?? true
    if mainFrame, !origin.isEmpty, !sameOrigin(url), url.scheme != "about", url.scheme != "blob" {
      openOutside(url)
      return decisionHandler(.cancel)
    }
    decisionHandler(.allow)
  }

  func sameOrigin(_ u: URL) -> Bool {
    guard let o = URL(string: origin) else { return false }
    return u.scheme == o.scheme && u.host == o.host && u.port == o.port
  }

  func openOutside(_ url: URL) {
    if ["http", "https", "mailto"].contains(url.scheme ?? "") { NSWorkspace.shared.open(url) }
  }

  func webView(_ w: WKWebView, createWebViewWith c: WKWebViewConfiguration, for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
    if let u = action.request.url { openOutside(u) }
    return nil
  }

  func webView(_ w: WKWebView, decidePolicyFor r: WKNavigationResponse, decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
    let attachment = (r.response as? HTTPURLResponse)?.value(forHTTPHeaderField: "Content-Disposition")?.hasPrefix("attachment") ?? false
    decisionHandler(attachment || !r.canShowMIMEType ? .download : .allow)
  }

  func webView(_ w: WKWebView, navigationAction: WKNavigationAction, didBecome d: WKDownload) { d.delegate = self }
  func webView(_ w: WKWebView, navigationResponse: WKNavigationResponse, didBecome d: WKDownload) { d.delegate = self }

  func download(_ d: WKDownload, decideDestinationUsing r: URLResponse, suggestedFilename name: String, completionHandler: @escaping (URL?) -> Void) {
    let p = NSSavePanel()
    p.nameFieldStringValue = name
    p.beginSheetModal(for: window) { res in
      guard res == .OK, let url = p.url else { return completionHandler(nil) }
      try? FileManager.default.removeItem(at: url)  // the panel already asked about replacing it
      completionHandler(url)
    }
  }

  func webView(_ w: WKWebView, runOpenPanelWith p: WKOpenPanelParameters, initiatedByFrame f: WKFrameInfo, completionHandler: @escaping ([URL]?) -> Void) {
    let o = NSOpenPanel()
    o.allowsMultipleSelection = p.allowsMultipleSelection
    o.canChooseDirectories = p.allowsDirectories
    o.beginSheetModal(for: window) { completionHandler($0 == .OK ? o.urls : nil) }
  }

  func webView(_ w: WKWebView, runJavaScriptAlertPanelWithMessage m: String, initiatedByFrame f: WKFrameInfo, completionHandler: @escaping () -> Void) {
    let a = NSAlert()
    a.messageText = m
    a.beginSheetModal(for: window) { _ in completionHandler() }
  }

  func webView(_ w: WKWebView, runJavaScriptConfirmPanelWithMessage m: String, initiatedByFrame f: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
    let a = NSAlert()
    a.messageText = m
    a.addButton(withTitle: "OK")
    a.addButton(withTitle: "Cancel")
    a.beginSheetModal(for: window) { completionHandler($0 == .alertFirstButtonReturn) }
  }

  func webViewWebContentProcessDidTerminate(_ w: WKWebView) { w.reload() }

  // MARK: menu

  @objc func reload() { web.reload() }
  @objc func back() { web.goBack() }
  @objc func zoomIn() { web.pageZoom = min(2, web.pageZoom + 0.1) }
  @objc func zoomOut() { web.pageZoom = max(0.6, web.pageZoom - 0.1) }
  @objc func zoomReset() { web.pageZoom = 1 }
  @objc func showWindow() { window.makeKeyAndOrderFront(nil) }

  func makeMenu() {
    let bar = NSMenu()
    func menu(_ title: String, _ items: [NSMenuItem]) {
      let top = NSMenuItem(), m = NSMenu(title: title)
      items.forEach(m.addItem)
      top.submenu = m
      bar.addItem(top)
    }
    func item(_ t: String, _ s: Selector, _ k: String, _ target: AnyObject? = nil, _ mods: NSEvent.ModifierFlags = .command) -> NSMenuItem {
      let i = NSMenuItem(title: t, action: s, keyEquivalent: k)
      i.target = target
      i.keyEquivalentModifierMask = mods
      return i
    }
    menu("Nexus", [
      item("About Nexus", #selector(NSApplication.orderFrontStandardAboutPanel(_:)), ""), .separator(),
      item("Hide Nexus", #selector(NSApplication.hide(_:)), "h"), .separator(),
      item("Quit Nexus", #selector(NSApplication.terminate(_:)), "q"),
    ])
    menu("Edit", [
      item("Undo", Selector(("undo:")), "z"), item("Redo", Selector(("redo:")), "z", nil, [.command, .shift]), .separator(),
      item("Cut", #selector(NSText.cut(_:)), "x"), item("Copy", #selector(NSText.copy(_:)), "c"), item("Paste", #selector(NSText.paste(_:)), "v"), item("Select All", #selector(NSText.selectAll(_:)), "a"),
    ])
    menu("View", [
      item("Reload", #selector(reload), "r", self), item("Back", #selector(back), "[", self), .separator(),
      item("Zoom In", #selector(zoomIn), "=", self), item("Zoom Out", #selector(zoomOut), "-", self), item("Actual Size", #selector(zoomReset), "0", self), .separator(),
      item("Enter Full Screen", #selector(NSWindow.toggleFullScreen(_:)), "f", nil, [.command, .control]),
    ])
    menu("Window", [
      item("Nexus", #selector(showWindow), "1", self), item("Minimize", #selector(NSWindow.performMiniaturize(_:)), "m"), item("Close Window", #selector(NSWindow.performClose(_:)), "w"),
    ])
    NSApp.mainMenu = bar
  }
}

let app = NSApplication.shared
let delegate = App()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()
