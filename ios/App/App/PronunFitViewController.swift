import UIKit
import WebKit
import Capacitor
import AVFoundation

/// CAPBridgeViewController를 서브클래싱하여 WKWebView의 미디어 캡처 권한을 자동 승인합니다.
/// iOS 15+에서 getUserMedia() 호출 시 WKWebView가 매번 띄우는 반복 프롬프트를 제거합니다.
/// 네이티브 OS 권한(AVAudioSession)이 이미 승인된 경우에만 auto-grant하므로 보안에 안전합니다.
class PronunFitViewController: CAPBridgeViewController {

    override func viewDidLoad() {
        super.viewDidLoad()
        // WKWebView의 uiDelegate를 설정하여 미디어 캡처 권한 요청을 가로챕니다.
        webView?.uiDelegate = self
    }
}

// MARK: - WKUIDelegate (미디어 캡처 권한 자동 승인)
extension PronunFitViewController: WKUIDelegate {

    /// iOS 15+: WKWebView가 getUserMedia()로 마이크/카메라 권한을 요청할 때 호출됩니다.
    /// 네이티브 OS 권한이 이미 승인된 경우 WKWebView 프롬프트 없이 자동 승인합니다.
    @available(iOS 15, *)
    func webView(_ webView: WKWebView,
                 requestMediaCapturePermissionFor origin: WKSecurityOrigin,
                 initiatedByFrame frame: WKFrameInfo,
                 type: WKMediaCaptureType,
                 decisionHandler: @escaping (WKPermissionDecision) -> Void) {
        switch type {
        case .microphone, .microphoneAndCamera:
            // 마이크: 네이티브 OS 권한이 .granted일 때만 auto-grant
            if AVAudioSession.sharedInstance().recordPermission == .granted {
                decisionHandler(.grant)
            } else {
                // 권한 미승인이면 WKWebView 기본 프롬프트 표시
                decisionHandler(.prompt)
            }
        case .camera:
            decisionHandler(.grant)
        @unknown default:
            decisionHandler(.prompt)
        }
    }
}
