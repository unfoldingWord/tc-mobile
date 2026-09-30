import UIKit
import Capacitor
import AVFoundation

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        // #1111/#1116: declare this app's baseline audio session as
        // `.playAndRecord` — DRI decision on #1116's George r1 finding,
        // verbatim: "Native .playAndRecord (Recommended)". The prior
        // `.playback`-only baseline was flagged High/UNSAFE: this repo's
        // JS-level floor, `navigator.audioSession` (`hooks/audio-io.ts`),
        // does not exist on iOS 15.4–16.3 (it shipped in 16.4), so the JS
        // switch to `"play-and-record"` before `getUserMedia`
        // (`use-recorder.ts`'s `start()`) is silently skipped on those
        // versions — leaving the native category at `.playback`, which is
        // documented for playback only, while the mic is live. A take could
        // be captured silent under it. `.playAndRecord` here, once, at
        // launch, is meant to give the app a record-capable baseline on
        // every iOS version it supports, whether or not that WebKit has
        // `navigator.audioSession`.
        //
        // `.defaultToSpeaker` routes output to the speaker rather than the
        // much quieter earpiece receiver when no headset/Bluetooth device is
        // attached — the right default for a translator holding the phone in
        // hand, not to their ear. `.allowBluetooth` (classic/HFP) and
        // `.allowBluetoothA2DP` let a paired Bluetooth mic or headset
        // participate rather than being silently excluded by the category.
        // This is the app's one audio session configuration, and nothing
        // switches it at run time: since #1251 the web code's
        // `navigator.audioSession` switch (`"playback"` on each Play,
        // `"play-and-record"` before each Record, `hooks/audio-io.ts`) does
        // nothing inside this shell, and still runs in Safari and the
        // installed PWA, where there is no AppDelegate. A `type` write on
        // WebKit 16.4+ would replace this category, and the web API cannot
        // restore `.defaultToSpeaker` or the Bluetooth options. Whether this
        // category alone keeps Play audible with the silent switch on, inside
        // WKWebView, has not been run on a device (#1251).
        //
        // Setting the category alone does NOT activate the audio session or
        // request microphone permission (Apple: `setCategory` configures the
        // session; activation is the separate `setActive(true)` call, which
        // this code never makes, and the mic permission prompt is raised by
        // `getUserMedia`/`AVAudioSession.requestRecordPermission`, not by
        // `setCategory`) — so this call does not prompt for the microphone
        // or keep it hot at launch. Not yet run on a device (#1111/#1116) —
        // see the PR body.
        do {
            try AVAudioSession.sharedInstance().setCategory(
                .playAndRecord,
                mode: .default,
                options: [.defaultToSpeaker, .allowBluetooth, .allowBluetoothA2DP]
            )
        } catch {
            // No failure funnel exists this early, before the WebView (and
            // its JS reporter) exists — NSLog is the one channel available
            // at this point in the native shell, so the failure is at least
            // visible in a device log rather than silently swallowed.
            NSLog("tC Mobile: AVAudioSession.setCategory(.playAndRecord) failed at launch (#1111/#1116): %@", String(describing: error))
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
