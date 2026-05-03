package com.arigems.pronunfit;

import android.app.Application;
import android.content.Context;
import android.os.Build;
import android.os.UserManager;

import com.facebook.appevents.AppEventsLogger;

public class MainApplication extends Application {
    @Override
    public void onCreate() {
        super.onCreate();

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            UserManager um = (UserManager) getSystemService(Context.USER_SERVICE);
            if (um != null && !um.isUserUnlocked()) {
                return;
            }
        }

        try {
            AppEventsLogger.activateApp(this);
        } catch (Exception e) {
            android.util.Log.e("MainApplication", "FB activateApp failed", e);
        }
    }
}
