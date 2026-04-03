import UIKit
import WebKit
import Capacitor
import AVFoundation

/// CAPBridgeViewController를 서브클래싱하여 WKWebView의 미디어 캡처 권한을 자동 승인합니다.
/// iOS 15+에서 getUserMedia() 호출 시 WKWebView가 매번 띄우는 반복 프롬프트를 제거합니다.
///
/// 주의: Capacitor 내부의 CAPWebViewDelegationHandler가 uiDelegate를 관리하므로,
/// 직접 uiDelegate를 덮어쓰면 WebView 로딩이 깨집니다.
/// 대신 Capacitor의 브릿지 초기화가 완료된 후 delegate proxy를 설정합니다.
class PronunFitViewController: CAPBridgeViewController {

    private var originalUIDelegate: WKUIDelegate?
    private var delegateInstalled = false

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        installMediaCaptureDelegate()
    }

    /// Capacitor 브릿지 초기화 후 안전하게 delegate proxy를 설치합니다.
    private func installMediaCaptureDelegate() {
        guard !delegateInstalled, let wv = webView else { return }
        // Capacitor의 기존 uiDelegate를 보존
        originalUIDelegate = wv.uiDelegate
        wv.uiDelegate = self
        delegateInstalled = true
        print("[PronunFitVC] Media capture delegate installed")
    }
}

// MARK: - WKUIDelegate (미디어 캡처 권한 자동 승인 + 기존 delegate 전달)
extension PronunFitViewController: WKUIDelegate {

    /// iOS 15+: getUserMedia() 미디어 캡처 권한 자동 승인
    @available(iOS 15, *)
    func webView(_ webView: WKWebView,
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

    // MARK: - 기존 Capacitor delegate로 전달 (JS alert/confirm/prompt 등)

    func webView(_ webView: WKWebView,
                 runJavaScriptAlertPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo,
                 completionHandler: @escaping () -> Void) {
        if let d = originalUIDelegate,
           d.responds(to: #selector(WKUIDelegate.webView(_:runJavaScriptAlertPanelWithMessage:initiatedByFrame:completionHandler:))) {
            d.webView?(webView, runJavaScriptAlertPanelWithMessage: message, initiatedByFrame: frame, completionHandler: completionHandler)
        } else {
            completionHandler()
        }
    }

    func webView(_ webView: WKWebView,
                 runJavaScriptConfirmPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo,
                 completionHandler: @escaping (Bool) -> Void) {
        if let d = originalUIDelegate,
           d.responds(to: #selector(WKUIDelegate.webView(_:runJavaScriptConfirmPanelWithMessage:initiatedByFrame:completionHandler:))) {
            d.webView?(webView, runJavaScriptConfirmPanelWithMessage: message, initiatedByFrame: frame, completionHandler: completionHandler)
        } else {
            completionHandler(false)
        }
    }

    func webView(_ webView: WKWebView,
                 runJavaScriptTextInputPanelWithPrompt prompt: String,
                 defaultText: String?,
                 initiatedByFrame frame: WKFrameInfo,
                 completionHandler: @escaping (String?) -> Void) {
        if let d = originalUIDelegate,
           d.responds(to: #selector(WKUIDelegate.webView(_:runJavaScriptTextInputPanelWithPrompt:defaultText:initiatedByFrame:completionHandler:))) {
            d.webView?(webView, runJavaScriptTextInputPanelWithPrompt: prompt, defaultText: defaultText, initiatedByFrame: frame, completionHandler: completionHandler)
        } else {
            completionHandler(nil)
        }
    }

    func webView(_ webView: WKWebView,
                 createWebViewWith configuration: WKWebViewConfiguration,
                 for navigationAction: WKNavigationAction,
                 windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let d = originalUIDelegate,
           d.responds(to: #selector(WKUIDelegate.webView(_:createWebViewWith:for:windowFeatures:))) {
            return d.webView?(webView, createWebViewWith: configuration, for: navigationAction, windowFeatures: windowFeatures)
        }
        // window.open() 등 새 창 요청 → 현재 WebView에서 로드
        if navigationAction.targetFrame == nil {
            webView.load(navigationAction.request)
        }
        return nil
    }
}
