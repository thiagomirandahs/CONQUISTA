package app.filhosdaconquista;

import android.os.Bundle;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    // O topo do app é claro: ícones da barra de status (hora, bateria) ESCUROS, senão somem no branco.
    // A folga do topo/rodapé é feita no CSS (--seguro-topo/--seguro-baixo, plugin SystemBars em "css").
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().getDecorView().post(() -> {
            WindowInsetsControllerCompat c = new WindowInsetsControllerCompat(getWindow(), getWindow().getDecorView());
            c.setAppearanceLightStatusBars(true);
            c.setAppearanceLightNavigationBars(true);
        });
    }
}
