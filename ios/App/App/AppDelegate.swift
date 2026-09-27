import UIKit
import Capacitor
import AVFoundation

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        // #1111: declare this app's baseline audio session as `.playback` so
        // the WKWebView content is audible through the iPhone silent/ring
        // switch, the way a music or podcast app is — the DRI's decision on
        // #1111 ("Yes, play through silent"). This is the native-process
        // floor beneath `navigator.audioSession` (`hooks/audio-io.ts`),
        // which does the same declaration at the WebKit/JS layer and is the
        // layer that additionally switches to `.playAndRecord` for the life
        // of a take; both surfaces share that one JS module, since the
        // native and PWA builds ship the same application code
        // (`capacitor.config.ts`). Best-effort: a thrown `setCategory` here
        // leaves the platform default in place rather than failing launch —
        // there is no failure funnel yet at this point, before the WebView
        // (and its JS) exists, so nothing is reported; `navigator.audioSession`
        // still runs once the page loads regardless of whether this call
        // succeeded.
        // Not yet run on a device (#1111) — see the PR body.
        do {
            try AVAudioSession.sharedInstance().setCategory(.playback)
        } catch {
            // See the comment above: no channel exists this early to report
            // through, and the JS-level declaration is not blocked by this
            // catch being empty.
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

    func application(_ application: UIApplication,
                     configurationForConnecting connectingSceneSession: UISceneSession,
                     options: UIScene.ConnectionOptions) -> UISceneConfiguration {
        let config = UISceneConfiguration(name: "Default Configuration",
                                          sessionRole: connectingSceneSession.role)
        config.delegateClass = SceneDelegate.self
        return config
    }
}
