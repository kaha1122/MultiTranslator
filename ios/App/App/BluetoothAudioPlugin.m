#import <Capacitor/Capacitor.h>

CAP_PLUGIN(BluetoothAudioPlugin, "BluetoothAudio",
    CAP_PLUGIN_METHOD(isBluetoothHeadsetConnected, CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(startBluetoothSco, CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(stopBluetoothSco, CAPPluginReturnPromise);
)
