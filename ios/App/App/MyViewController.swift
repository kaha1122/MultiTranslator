import UIKit
import Capacitor

/// Capacitor 8은 cap sync가 생성하는 packageClassList(node_modules 플러그인만)로만
/// 플러그인을 자동 등록하므로, 인앱 플러그인은 여기서 수동 등록해야 브리지에 로드됨.
/// Main.storyboard의 customClass가 이 클래스를 가리킴.
class MyViewController: CAPBridgeViewController {

    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(BluetoothAudioPlugin())
    }
}
