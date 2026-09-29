package app.filhosdaconquista;

import android.os.Bundle;
import android.view.View;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    // Android 15+ desenha o app por baixo da barra de status (edge-to-edge obrigatório) e o topo
    // cobria hora/bateria. Aqui o conteúdo recebe a folga das barras do sistema, com fundo azul-marinho.
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        View raiz = findViewById(android.R.id.content);
        raiz.setBackgroundColor(0xFF07122F);
        new WindowInsetsControllerCompat(getWindow(), raiz).setAppearanceLightStatusBars(false);
        ViewCompat.setOnApplyWindowInsetsListener(raiz, (v, insets) -> {
            Insets b = insets.getInsets(WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout() | WindowInsetsCompat.Type.ime());
            v.setPadding(b.left, b.top, b.right, b.bottom);
            return WindowInsetsCompat.CONSUMED;
        });
    }
}
