package org.unfoldingword.tcmobile;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // #1472 spike only: never merged. Must register before super.onCreate.
        registerPlugin(CardProbePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
