import Foundation
import Capacitor
import AVFoundation

/**
 * Capacitor 플러그인: iOS에서 AVAudioSession을 설정하여
 * 블루투스 이어폰/헤드셋의 마이크로 녹음할 수 있게 해줍니다.
 */
@objc(BluetoothAudioPlugin)
public class BluetoothAudioPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "BluetoothAudioPlugin"
    public let jsName = "BluetoothAudio"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "isBluetoothHeadsetConnected", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "startBluetoothSco", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stopBluetoothSco", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "activateAudioSession", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "deactivateAudioSession", returnType: CAPPluginReturnPromise),
    ]

    /// 블루투스 오디오 장치가 연결되어 있는지 확인
    @objc func isBluetoothHeadsetConnected(_ call: CAPPluginCall) {
        let session = AVAudioSession.sharedInstance()
        let connected = isBluetoothInputAvailable(session)
        call.resolve(["connected": connected])
    }

    /// AVAudioSession을 블루투스 허용 모드로 설정 (녹음 전 호출)
    @objc func startBluetoothSco(_ call: CAPPluginCall) {
        let session = AVAudioSession.sharedInstance()
        do {
            try session.setCategory(
                .playAndRecord,
                mode: .measurement,
                options: [.allowBluetoothHFP, .allowBluetoothA2DP, .defaultToSpeaker]
            )
            try session.setActive(true, options: [])

            // BT 입력 포트를 명시적으로 선택 (에어팟 한쪽만 착용 등 iOS가 내장 마이크로
            // 폴백하는 케이스 방지). setPreferredInput은 "선호" 힌트이므로
            // BT 연결이 끊기면 iOS가 자동으로 내장 마이크로 전환합니다.
            if let inputs = session.availableInputs {
                let btInput = inputs.first { input in
                    input.portType == .bluetoothHFP ||
                    input.portType == .bluetoothA2DP ||
                    input.portType == .bluetoothLE
                }
                if let btInput = btInput {
                    try session.setPreferredInput(btInput)
                    print("[BluetoothAudio] Preferred input set to: \(btInput.portName)")
                }
            }

            print("[BluetoothAudio] AVAudioSession configured for Bluetooth")
            call.resolve(["success": true])
        } catch {
            print("[BluetoothAudio] Failed to configure AVAudioSession: \(error)")
            call.reject("Failed to configure AVAudioSession: \(error.localizedDescription)")
        }
    }

    /// 녹음 종료 후 오디오 세션을 재생 모드로 전환 (녹음 후 호출)
    /// setActive(false)로 세션을 완전히 끄면 에어팟 출력 라우트가 리셋되어
    /// TTS 재생이 스피커로 전환되는 문제가 발생합니다.
    /// 대신 .playback 카테고리로 전환하여 BT 출력 라우트를 유지합니다.
    @objc func stopBluetoothSco(_ call: CAPPluginCall) {
        let session = AVAudioSession.sharedInstance()
        do {
            // preferredInput 초기화 (BT 마이크 강제 선택 해제)
            try session.setPreferredInput(nil)
            // 재생 전용 모드로 전환 — BT 출력(에어팟 스피커)은 유지됨
            try session.setCategory(
                .playback,
                mode: .default,
                options: [.allowBluetoothA2DP]
            )
            print("[BluetoothAudio] AVAudioSession switched to playback mode")
            call.resolve(["success": true])
        } catch {
            print("[BluetoothAudio] Failed to switch AVAudioSession: \(error)")
            // 전환 실패 시에도 치명적이지 않으므로 resolve
            call.resolve(["success": false])
        }
    }

    /// 오디오 세션을 .playAndRecord로 (재)활성화
    /// iOS에서 최초 마이크 권한 승인 후 세션을 갱신해야 getUserMedia가 정상 동작함.
    /// AppDelegate에서 설정한 카테고리가 권한 없이 불완전 초기화되었을 수 있으므로 재설정.
    @objc func activateAudioSession(_ call: CAPPluginCall) {
        let session = AVAudioSession.sharedInstance()
        do {
            try session.setCategory(
                .playAndRecord,
                mode: .default,
                options: [.allowBluetoothHFP, .allowBluetoothA2DP, .defaultToSpeaker]
            )
            try session.setActive(true, options: [])
            print("[BluetoothAudio] AVAudioSession activated for recording")
            call.resolve(["success": true])
        } catch {
            print("[BluetoothAudio] Failed to activate AVAudioSession: \(error)")
            call.resolve(["success": false])
        }
    }

    /// [v1.5.67 idle 발열 절감] 녹음 종료 후 AVAudioSession을 .playback으로 복귀.
    /// stopBluetoothSco는 BT 사용자(btScoActiveRef=true)일 때만 호출되어 내장 마이크
    /// 사용자에겐 .playAndRecord 카테고리가 잔류 → idle 시 mediaserverd input subsystem
    /// 지속 가동 → 발열. 이 메소드는 BT 무관 항상 호출되어 .playback으로 강제 복귀.
    ///
    /// 주의: setActive(false)는 호출하지 않음.
    ///   - 과거 사례(BluetoothAudioPlugin.swift:62-63 주석): setActive(false)로 세션을
    ///     완전히 끄면 에어팟 출력 라우트가 리셋되어 TTS가 스피커로 튀는 회귀 발생.
    ///   - 카테고리만 .playback으로 전환해도 mediaserverd가 input subsystem을 깨우지 않아
    ///     idle 발열 해소 효과는 동일.
    @objc func deactivateAudioSession(_ call: CAPPluginCall) {
        let session = AVAudioSession.sharedInstance()
        do {
            // preferredInput 초기화 — BT 마이크 강제 선택 해제 (BT 사용자가 끊고 내장으로
            // 전환한 경우에도 잔류 선호도 제거)
            try session.setPreferredInput(nil)
            try session.setCategory(
                .playback,
                mode: .default,
                options: [.allowBluetoothA2DP]
            )
            print("[BluetoothAudio] AVAudioSession switched to .playback (idle thermal mode)")
            call.resolve(["success": true])
        } catch {
            print("[BluetoothAudio] Failed to deactivate AVAudioSession: \(error)")
            // 실패해도 치명적이지 않으므로 resolve (호출 측에서 무시)
            call.resolve(["success": false])
        }
    }

    /// 현재 오디오 입력 중 블루투스 장치가 있는지 확인
    private func isBluetoothInputAvailable(_ session: AVAudioSession) -> Bool {
        guard let inputs = session.availableInputs else { return false }
        return inputs.contains { input in
            input.portType == .bluetoothHFP ||
            input.portType == .bluetoothA2DP ||
            input.portType == .bluetoothLE
        }
    }
}
