package co.edu.escuelaing.nexovital.recursos.application.usecase;

import co.edu.escuelaing.nexovital.shared.domain.port.out.PushPort;
import org.springframework.stereotype.Component;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;

/**
 * Entrega al {@link PushPort} el payload de un item recién acreditado, SIEMPRE
 * después del commit. La fase {@code AFTER_COMMIT} garantiza que el consumidor
 * nunca vea un evento que la base no confirmó: es la regla de oro del contrato
 * ("publish POST-COMMIT").
 *
 * <p>Es el espejo de {@code EmergenciaPushListener} y de
 * {@code OrganizacionPushListener}: el módulo dueño del dato es quien emite, y
 * el disparador es el servicio transaccional, nunca el controlador ni el
 * cliente. El destino es {@code /topic/suministros}, el que el contrato ya
 * declara para el inventario y su semáforo.
 *
 * <p>El payload es el {@link co.edu.escuelaing.nexovital.recursos.infrastructure.adapter.in.dto.ItemInventarioDto}
 * ya proyectado: la forma pública que el front consume por REST, con
 * {@code semaforo} incluido, para que un suscriptor haga UPSERT por {@code id}
 * sin un mapper nuevo.
 */
@Component
public class InventarioPushListener {

    /** Destino ya declarado en el contrato para el inventario (EP-03). */
    public static final String DESTINO_SUMINISTROS = "/topic/suministros";

    private final PushPort pushPort;

    public InventarioPushListener(PushPort pushPort) {
        this.pushPort = pushPort;
    }

    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    public void alRegistrarDonacion(DonacionRegistradaEvento evento) {
        pushPort.publicar(DESTINO_SUMINISTROS, evento.item());
    }

    /**
     * El despacho de stock también publica el semáforo actualizado en el mismo
     * canal: el contrato lo declara para la operación
     * ({@code x-usa-publicacion: /topic/suministros}, publish POST-COMMIT).
     */
    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    public void alDespacharStock(StockDespachadoEvento evento) {
        pushPort.publicar(DESTINO_SUMINISTROS, evento.item());
    }

    /**
     * Un insumo recién declarado por el administrador del centro viaja por el
     * mismo canal: los clientes lo agregan al inventario del centro por UPSERT.
     */
    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    public void alRegistrarItem(ItemInventarioRegistradoEvento evento) {
        pushPort.publicar(DESTINO_SUMINISTROS, evento.item());
    }
}
