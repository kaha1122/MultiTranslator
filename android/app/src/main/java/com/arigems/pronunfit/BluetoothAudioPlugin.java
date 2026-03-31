package com.arigems.pronunfit;

import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothProfile;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.media.AudioManager;
import android.os.Build;
import android.util.Log;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Capacitor 플러그인: 블루투스 SCO 오디오 채널을 열어서
 * 블루투스 이어폰/헤드셋의 마이크로 녹음할 수 있게 해줍니다.
 */
@CapacitorPlugin(name = "BluetoothAudio")
public class BluetoothAudioPlugin extends Plugin {

    private static final String TAG = "BluetoothAudio";
    private AudioManager audioManager;
    private BroadcastReceiver scoReceiver;
    private boolean scoStarted = false;

    @Override
    public void load() {
        audioManager = (AudioManager) getContext().getSystemService(Context.AUDIO_SERVICE);
    }

    /**
     * 블루투스 헤드셋이 연결되어 있는지 확인합니다.
     */
    @PluginMethod()
    public void isBluetoothHeadsetConnected(PluginCall call) {
        JSObject ret = new JSObject();
        try {
            BluetoothAdapter adapter = BluetoothAdapter.getDefaultAdapter();
            if (adapter == null || !adapter.isEnabled()) {
                ret.put("connected", false);
                call.resolve(ret);
                return;
            }
            // BluetoothProfile.HEADSET (1) 은 HFP 프로필 — 마이크 입력 가능한 헤드셋
            boolean connected = adapter.getProfileConnectionState(BluetoothProfile.HEADSET)
                    == BluetoothProfile.STATE_CONNECTED;
            ret.put("connected", connected);
        } catch (SecurityException e) {
            Log.w(TAG, "Bluetooth permission denied", e);
            ret.put("connected", false);
        } catch (Exception e) {
            Log.e(TAG, "Error checking BT headset", e);
            ret.put("connected", false);
        }
        call.resolve(ret);
    }

    /**
     * 블루투스 SCO 오디오 채널을 엽니다.
     * 이 채널이 열려야 BT 헤드셋의 마이크 입력을 사용할 수 있습니다.
     */
    @PluginMethod()
    public void startBluetoothSco(PluginCall call) {
        if (audioManager == null) {
            call.reject("AudioManager not available");
            return;
        }

        try {
            // SCO 연결 상태를 모니터링하는 리시버 등록
            if (scoReceiver == null) {
                scoReceiver = new BroadcastReceiver() {
                    @Override
                    public void onReceive(Context context, Intent intent) {
                        int state = intent.getIntExtra(AudioManager.EXTRA_SCO_AUDIO_STATE,
                                AudioManager.SCO_AUDIO_STATE_DISCONNECTED);
                        Log.d(TAG, "SCO state changed: " + state);
                    }
                };
                IntentFilter filter = new IntentFilter(AudioManager.ACTION_SCO_AUDIO_STATE_UPDATED);
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                    getContext().registerReceiver(scoReceiver, filter, Context.RECEIVER_NOT_EXPORTED);
                } else {
                    getContext().registerReceiver(scoReceiver, filter);
                }
            }

            audioManager.setMode(AudioManager.MODE_IN_COMMUNICATION);
            audioManager.startBluetoothSco();
            audioManager.setBluetoothScoOn(true);
            scoStarted = true;

            Log.d(TAG, "Bluetooth SCO started");
            JSObject ret = new JSObject();
            ret.put("success", true);
            call.resolve(ret);
        } catch (Exception e) {
            Log.e(TAG, "Failed to start BT SCO", e);
            call.reject("Failed to start Bluetooth SCO: " + e.getMessage());
        }
    }

    /**
     * 블루투스 SCO 오디오 채널을 닫고 원래 상태로 복원합니다.
     */
    @PluginMethod()
    public void stopBluetoothSco(PluginCall call) {
        if (audioManager == null) {
            call.reject("AudioManager not available");
            return;
        }

        try {
            if (scoStarted) {
                audioManager.setBluetoothScoOn(false);
                audioManager.stopBluetoothSco();
                audioManager.setMode(AudioManager.MODE_NORMAL);
                scoStarted = false;
                Log.d(TAG, "Bluetooth SCO stopped");
            }

            // 리시버 해제
            if (scoReceiver != null) {
                try {
                    getContext().unregisterReceiver(scoReceiver);
                } catch (IllegalArgumentException ignored) {}
                scoReceiver = null;
            }

            JSObject ret = new JSObject();
            ret.put("success", true);
            call.resolve(ret);
        } catch (Exception e) {
            Log.e(TAG, "Failed to stop BT SCO", e);
            call.reject("Failed to stop Bluetooth SCO: " + e.getMessage());
        }
    }
}
