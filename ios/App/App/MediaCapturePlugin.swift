import Foundation
import WebKit
import Capacitor
import AVFoundation

/// Capacitor Plugin: WKWebView 미디어 캡처 권한 자동 승인
/// Capacitor 브릿지 초기화 완료 후(load()) delegate proxy를 설치하므로
/// 기존 CAPBridgeViewController의 delegate 체인을 깨뜨리지 않습니다.
///
/// iOS 15+에서 getUserMedia() 호출 시 WKWebView가 매번 띄우는
/// 반복 프롬프트를 제거합니다. (네이티브 OS 권한이 승인된 경우에만 auto-grant)
@objc(MediaCapturePlugin)
public class MediaCapturePlugin: CAPPlugin, CAPBridgedPlugin, WKUIDelegate {

    public let identifier = "MediaCapturePlugin"
    public let jsName = "MediaCapture"
    public let pluginMethods: [CAPPluginMethod] = []

    private weak var originalDelegate: WKUIDelegate?

    override public func load() {
        // Capacitor 브릿지가 WebView를 완전히 설정한 후 실행됨
        DispatchQueue.main.async { [weak self] in
            guard let self = self, let webView = self.bridge?.webView else { return }
            // Capacitor의 기존 uiDelegate를 보존
            self.originalDelegate = webView.uiDelegate
            // 자신을 proxy delegate로 설정
            webView.uiDelegate = self
            print("[MediaCapturePlugin] delegate proxy installed")
        }
    }

    // MARK: - 미디어 캡처 권한 자동 승인 (iOS 15+)

    @available(iOS 15, *)
    public func webView(_ webView: WKWebView,
                        requestMediaCapturePermissionFor origin: WKSecurityOrigin,
                        initiatedByFrame frame: WKFrameInfo,
                        type: WKMediaCaptureType,
                        decisionHandler: @escaping (WKPermissionDecision) -> Void) {
        switch type {
        case .microphone, .microphoneAndCamera:
            if AVAudioSession.sharedInstance().recordPermission == .granted {
                decisionHandler(.grant)
            } else {
                decisionHandler(.prompt)
            }
        case .camera:
            decisionHandler(.grant)
        @unknown default:
            decisionHandler(.prompt)
        }
    }

    // MARK: - 나머지 WKUIDelegate 호출은 Capacitor 원본 delegate로 전달

    override public func responds(to aSelector: Selector!) -> Bool {
        if super.responds(to: aSelector) { return true }
        return originalDelegate?.responds(to: aSelector) ?? false
    }

    override public func forwardingTarget(for aSelector: Selector!) -> Any? {
        if let d = originalDelegate, d.responds(to: aSelector) {
            return d
        }
        return super.forwardingTarget(for: aSelector)
    }
}
