import UIKit
import WebKit
import Capacitor

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?
    var pendingDeepLinkSid: String?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        // Match native background to web app
        let bgColor = UIColor(red: 0, green: 0, blue: 0, alpha: 1.0)

        DispatchQueue.main.async {
            guard let window = self.window else { return }
            window.backgroundColor = bgColor
            if let rootVC = window.rootViewController {
                rootVC.view.backgroundColor = bgColor
            }
        }

        // Check if app was launched with a URL (cold start)
        if let url = launchOptions?[.url] as? URL {
            extractAndStoreSid(from: url)
        }

        return true
    }

    func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
        // Called for warm resume (app already in background)
        extractAndStoreSid(from: url)
        // Also forward to Capacitor
        return ApplicationDelegateProxy.shared.application(app, open: url, options: options)
    }

    func application(_ application: UIApplication, continue userActivity: NSUserActivity, restorationHandler: @escaping ([any UIUserActivityRestoring]?) -> Void) -> Bool {
        if let url = userActivity.webpageURL {
            return ApplicationDelegateProxy.shared.application(application, open: url, options: [:])
        }
        return false
    }

    private func extractAndStoreSid(from url: URL) {
        guard let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
              let sid = components.queryItems?.first(where: { $0.name == "sid" })?.value,
              !sid.isEmpty else { return }

        // Validate UUID format
        let uuidPattern = try? NSRegularExpression(pattern: "^[0-9a-fA-F\\-]+$")
        let range = NSRange(sid.startIndex..., in: sid)
        guard uuidPattern?.firstMatch(in: sid, range: range) != nil else { return }

        pendingDeepLinkSid = sid

        // Retry injecting into WebView until it works (up to 5 seconds)
        injectSidIntoWebView(sid: sid, attempt: 0)
    }

    private func injectSidIntoWebView(sid: String, attempt: Int) {
        guard attempt < 25 else { return } // 25 x 200ms = 5 seconds max

        DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) {
            // In Capacitor, the WKWebView IS the rootViewController's view
            guard let rootVC = self.window?.rootViewController else {
                self.injectSidIntoWebView(sid: sid, attempt: attempt + 1)
                return
            }

            // Try: view IS the WebView (Capacitor standard)
            var webView = rootVC.view as? WKWebView

            // Fallback: search subviews recursively
            if webView == nil {
                webView = self.findWebView(in: rootVC.view)
            }

            guard let wv = webView else {
                self.injectSidIntoWebView(sid: sid, attempt: attempt + 1)
                return
            }

            let safeSid = sid.replacingOccurrences(of: "'", with: "").replacingOccurrences(of: "\\", with: "")
            let js = """
            if (window.__deepLinkHandled !== '\(safeSid)') {
                window.__deepLinkHandled = '\(safeSid)';
                window.__pendingSid = '\(safeSid)';
                window.dispatchEvent(new CustomEvent('applink-sid', { detail: '\(safeSid)' }));
                localStorage.setItem('toxicornah_pending_sid', '\(safeSid)');
            }
            """
            wv.evaluateJavaScript(js) { _, error in
                if error != nil {
                    // JS failed (page not loaded yet) — retry
                    self.injectSidIntoWebView(sid: sid, attempt: attempt + 1)
                }
            }
        }
    }

    private func findWebView(in view: UIView) -> WKWebView? {
        if let webView = view as? WKWebView {
            return webView
        }
        for subview in view.subviews {
            if let found = findWebView(in: subview) {
                return found
            }
        }
        return nil
    }

    func applicationWillResignActive(_ application: UIApplication) {}
    func applicationDidEnterBackground(_ application: UIApplication) {}
    func applicationWillEnterForeground(_ application: UIApplication) {}
    func applicationDidBecomeActive(_ application: UIApplication) {}
    func applicationWillTerminate(_ application: UIApplication) {}
}
