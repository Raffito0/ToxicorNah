package com.toxicornah.app;

import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        handleAppLink(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        handleAppLink(intent);
    }

    private void handleAppLink(Intent intent) {
        if (intent == null) return;
        String action = intent.getAction();
        Uri data = intent.getData();
        if (!Intent.ACTION_VIEW.equals(action) || data == null) return;

        String sid = data.getQueryParameter("sid");
        if (sid == null || sid.isEmpty()) return;

        // Wait 2s for the WebView/bridge to finish loading, then inject the sid
        new Handler(Looper.getMainLooper()).postDelayed(() -> {
            if (getBridge() != null && getBridge().getWebView() != null) {
                String js = "(function() {" +
                    "  window.__pendingSid = '" + sid + "';" +
                    "  window.dispatchEvent(new CustomEvent('applink-sid', { detail: '" + sid + "' }));" +
                    "})();";
                getBridge().getWebView().evaluateJavascript(js, null);
            }
        }, 2000);
    }
}
