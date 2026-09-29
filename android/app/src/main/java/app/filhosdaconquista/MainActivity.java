package app.filhosdaconquista;

import android.graphics.Color;
import android.os.Bundle;
import android.view.View;
import android.webkit.JavascriptInterface;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    // Regra do dono (29/09): as barras do sistema continuam do SISTEMA. O app ocupa só o espaço
    // entre elas (folga = insets reais do aparelho, nunca valor fixo) e a área das barras fica na
    // COR DO TEMA da tela (o web avisa pela ponte `DesbravaBarras.pintar`), sem faixa preta/branca.
    private View raiz;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        raiz = findViewById(android.R.id.content);
        pintar("#eef2fb", true);
        ViewCompat.setOnApplyWindowInsetsListener(raiz, (v, insets) -> {
            Insets b = insets.getInsets(WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout() | WindowInsetsCompat.Type.ime());
            v.setPadding(b.left, b.top, b.right, b.bottom);
            return WindowInsetsCompat.CONSUMED;
        });
        getBridge().getWebView().addJavascriptInterface(new Object() {
            @JavascriptInterface
            public void pintar(String hex, boolean temaClaro) { runOnUiThread(() -> MainActivity.this.pintar(hex, temaClaro)); }
        }, "DesbravaBarras");
    }

    private void pintar(String hex, boolean temaClaro) {
        try { raiz.setBackgroundColor(Color.parseColor(hex)); } catch (Exception ignorada) { /* cor inválida: mantém */ }
        WindowInsetsControllerCompat c = new WindowInsetsControllerCompat(getWindow(), raiz);
        c.setAppearanceLightStatusBars(temaClaro);     // tema claro = ícones escuros
        c.setAppearanceLightNavigationBars(temaClaro);
    }
}
