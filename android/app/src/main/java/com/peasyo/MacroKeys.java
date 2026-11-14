package com.peasyo;

import android.view.KeyEvent;

import com.facebook.react.bridge.Arguments;
import com.facebook.react.bridge.ReactContext;
import com.facebook.react.bridge.WritableMap;
import com.facebook.react.modules.core.DeviceEventManagerModule;

/**
 * Gatilho de macro por botão físico do controle.
 * StreamView / StreamTextureView chamam handle() antes de tratar a tecla.
 * Emite "onMacroKey" {action: down|up|capture, keyCode} para o JS.
 */
public class MacroKeys {
    public static volatile int triggerKey = 0;
    public static volatile boolean capturing = false;

    public static boolean handle(ReactContext rc, KeyEvent e) {
        try {
            if (rc == null || e == null) {
                return false;
            }
            int action = e.getAction();
            if (action != KeyEvent.ACTION_DOWN && action != KeyEvent.ACTION_UP) {
                return false;
            }
            int code = e.getKeyCode();
            if (code == KeyEvent.KEYCODE_BACK
                    || code == KeyEvent.KEYCODE_VOLUME_UP
                    || code == KeyEvent.KEYCODE_VOLUME_DOWN) {
                return false;
            }
            if (capturing) {
                if (action == KeyEvent.ACTION_DOWN) {
                    capturing = false;
                    emit(rc, "capture", code);
                }
                return true;
            }
            int t = triggerKey;
            if (t != 0 && code == t) {
                if (action == KeyEvent.ACTION_DOWN && e.getRepeatCount() != 0) {
                    return true;
                }
                emit(rc, action == KeyEvent.ACTION_DOWN ? "down" : "up", code);
                return true;
            }
        } catch (Throwable ignored) {
        }
        return false;
    }

    private static void emit(ReactContext rc, String action, int code) {
        WritableMap m = Arguments.createMap();
        m.putString("action", action);
        m.putInt("keyCode", code);
        rc.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter.class)
                .emit("onMacroKey", m);
    }
}
