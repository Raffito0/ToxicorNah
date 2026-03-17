import UIKit
import WebKit
import Capacitor

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        // Match native background to web app #111111 — eliminates
        // the dark gray bands at status bar and home indicator areas
        let bgColor = UIColor(red: 0, green: 0, blue: 0, alpha: 1.0)

        DispatchQueue.main.async {
            guard let window = self.window else { return }
            window.backgroundColor = bgColor

            if let rootVC = window.rootViewController {
                rootVC.view.backgroundColor = bgColor

                // Walk subviews to color the WKWebView and its scroll view
                for subview in rootVC.view.subviews {
                    subview.backgroundColor = bgColor
                    if let webView = subview as? WKWebView {
                        webView.isOpaque = false
                        webView.backgroundColor = bgColor
                        webView.scrollView.backgroundColor = bgColor
                    }
                }
            }
        }

        return true
    }

    func applicationWillResignActive(_ application: UIApplication) {
        // Sent when the application is about to move from active to inactive state. This can occur for certain types of temporary interruptions (such as an incoming phone call or SMS message) or when the user quits the application and it begins the transition to the background state.
        // Use this method to pause ongoing tasks, disable timers, and invalidate graphics rendering callbacks. Games should use this method to pause the game.
    }

    func applicationDidEnterBackground(_ application: UIApplication) {
        // Use this method to release shared resources, save user data, invalidate timers, and store enough application state information to restore your application to its current state in case it is terminated later.
        // If your application supports background execution, this method is called instead of applicationWillTerminate: when the user quits.
    }

    func applicationWillEnterForeground(_ application: UIApplication) {
        // Called as part of the transition from the background to the active state; here you can undo many of the changes made on entering the background.
    }

    func applicationDidBecomeActive(_ application: UIApplication) {
        // Restart any tasks that were paused (or not yet started) while the application was inactive. If the application was previously in the background, optionally refresh the user interface.
    }

    func applicationWillTerminate(_ application: UIApplication) {
        // Called when the application is about to terminate. Save data if appropriate. See also applicationDidEnterBackground:.
    }

    func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
        // Handle toxicornah:// deep links (e.g. toxicornah://results?sid=xxx)
        handleDeepLink(url)
        return ApplicationDelegateProxy.shared.application(app, open: url, options: options)
    }

    private func handleDeepLink(_ url: URL) {
        guard let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
              let sid = components.queryItems?.first(where: { $0.name == "sid" })?.value,
              !sid.isEmpty else { return }

        // Validate sid is a UUID format only (prevent XSS injection)
        let uuidPattern = try? NSRegularExpression(pattern: "^[0-9a-fA-F\\-]+$")
        let range = NSRange(sid.startIndex..., in: sid)
        guard uuidPattern?.firstMatch(in: sid, range: range) != nil else { return }

        // Wait for WebView to be ready, then inject sid (500ms is enough for WebView init)
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
            if let webView = self.window?.rootViewController?.view.subviews
                .compactMap({ $0 as? WKWebView }).first {
                let safeSid = sid.replacingOccurrences(of: "'", with: "")
                    .replacingOccurrences(of: "\\", with: "")
                let js = "window.__pendingSid = '\(safeSid)'; window.dispatchEvent(new CustomEvent('applink-sid', { detail: '\(safeSid)' }));"
                webView.evaluateJavaScript(js, completionHandler: nil)
            }
        }
    }

    func application(_ application: UIApplication, continue userActivity: NSUserActivity, restorationHandler: @escaping ([any UIUserActivityRestoring]?) -> Void) -> Bool {
        // Called when the app was launched with an activity, including Universal Links.
        // Feel free to add additional processing here, but if you want the App API to support
        // tracking app url opens, make sure to keep this call
        if let url = userActivity.webpageURL {
            return ApplicationDelegateProxy.shared.application(application, open: url, options: [:])
        }
        return false
    }

}
