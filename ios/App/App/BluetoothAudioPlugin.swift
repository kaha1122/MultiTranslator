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
                options: [.allowBluetooth, .allowBluetoothA2DP, .defaultToSpeaker]
            )
            try session.setActive(true, options: [])
            print("[BluetoothAudio] AVAudioSession configured for Bluetooth")
            call.resolve(["success": true])
        } catch {
            print("[BluetoothAudio] Failed to configure AVAudioSession: \(error)")
            call.reject("Failed to configure AVAudioSession: \(error.localizedDescription)")
        }
    }

    /// AVAudioSession을 기본 상태로 복원 (녹음 후 호출)
    @objc func stopBluetoothSco(_ call: CAPPluginCall) {
        let session = AVAudioSession.sharedInstance()
        do {
            try session.setActive(false, options: [.notifyOthersOnDeactivation])
            print("[BluetoothAudio] AVAudioSession deactivated")
            call.resolve(["success": true])
        } catch {
            print("[BluetoothAudio] Failed to deactivate AVAudioSession: \(error)")
            // 비활성화 실패는 치명적이지 않으므로 resolve
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
