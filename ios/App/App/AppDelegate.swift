import UIKit
import Capacitor
import AVFoundation
import FirebaseCore
import FirebaseCrashlytics
import FBSDKCoreKit

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        // Firebase 초기화 (Authentication, Crashlytics 등 모든 Firebase 플러그인에 필요)
        if FirebaseApp.app() == nil {
            FirebaseApp.configure()
        }
        Crashlytics.crashlytics().setCrashlyticsCollectionEnabled(true)
        print("[AppDelegate] Firebase configured with Crashlytics")

        // Facebook SDK 초기화 + App Events activate (Meta Events Manager 귀인용)
        ApplicationDelegate.shared.application(application, didFinishLaunchingWithOptions: launchOptions)
        AppEvents.shared.activateApp()
        print("[AppDelegate] Facebook SDK initialized, AppEvents activated")

        // 네이티브 뷰 배경색 — AdMob 배너 아래 safe-area 투명 영역 방지
        // capacitor.config.json backgroundColor는 WKWebView에만 적용되므로,
        // UIWindow 배경색을 직접 설정해야 배너 아래 틈이 앱 배경과 통일됨
        let bgColor = UIColor(red: 248/255.0, green: 250/255.0, blue: 252/255.0, alpha: 1.0) // #f8fafc
        window?.backgroundColor = bgColor

        // 앱 시작 시 AVAudioSession을 블루투스 허용 모드로 미리 설정.
        // 이렇게 해야 WebView의 getUserMedia 호출 전에 iOS가
        // 에어팟 등 BT 마이크를 라우팅 후보로 인식합니다.
        // 주의: setActive(true)는 여기서 호출하지 않음 — 실제 녹음 시점에 활성화
        let session = AVAudioSession.sharedInstance()
        do {
            try session.setCategory(
                .playAndRecord,
                mode: .default,
                options: [.allowBluetoothHFP, .allowBluetoothA2DP, .defaultToSpeaker]
            )
            print("[AppDelegate] AVAudioSession category set for Bluetooth")
        } catch {
            print("[AppDelegate] Failed to set AVAudioSession category: \(error)")
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
        // window가 didFinishLaunchingWithOptions 시점에 nil일 수 있으므로 여기서도 보장
        if window?.backgroundColor == nil || window?.backgroundColor == .systemBackground {
            let bgColor = UIColor(red: 248/255.0, green: 250/255.0, blue: 252/255.0, alpha: 1.0)
            window?.backgroundColor = bgColor
        }
    }

    func applicationWillTerminate(_ application: UIApplication) {
        // Called when the application is about to terminate. Save data if appropriate. See also applicationDidEnterBackground:.
    }

    func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
        // Called when the app was launched with a url. Feel free to add additional processing here,
        // but if you want the App API to support tracking app url opens, make sure to keep this call
        return ApplicationDelegateProxy.shared.application(app, open: url, options: options)
    }

    func application(_ application: UIApplication, continue userActivity: NSUserActivity, restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void) -> Bool {
        // Called when the app was launched with an activity, including Universal Links.
        // Feel free to add additional processing here, but if you want the App API to support
        // tracking app url opens, make sure to keep this call
        return ApplicationDelegateProxy.shared.application(application, continue: userActivity, restorationHandler: restorationHandler)
    }

    // Push Notifications: APNs 토큰을 Capacitor PushNotifications 플러그인에 전달
    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        NotificationCenter.default.post(name: .capacitorDidRegisterForRemoteNotifications, object: deviceToken)
    }

    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        NotificationCenter.default.post(name: .capacitorDidFailToRegisterForRemoteNotifications, object: error)
    }

}
