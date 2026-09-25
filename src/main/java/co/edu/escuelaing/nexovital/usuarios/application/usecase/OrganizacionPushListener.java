package co.edu.escuelaing.nexovital.usuarios.application.usecase;

import co.edu.escuelaing.nexovital.shared.domain.port.out.PushPort;
import co.edu.escuelaing.nexovital.usuarios.infrastructure.adapter.in.dto.OrganizacionDto;
import org.springframework.stereotype.Component;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Entrega al {@link PushPort} el payload de un centro recién registrado, SIEMPRE
 * después del commit. La fase {@code AFTER_COMMIT} garantiza que el consumidor
 * nunca vea un evento que la base no confirmó (regla de oro del contrato,
 * diseño US2 D6).
 *
 * <p>Es el espejo de {@code EmergenciaPushListener} para el módulo
 * {@code usuarios}: el módulo dueño del dato es quien emite (decisión D5 del
 * diseño US2). El destino es {@code /topic/map.events}, el que el contrato del
 * canal ya declara para el ciclo de vida de los elementos del mapa.
 *
 * <p>El payload es {@code {clase, id, nombre, ubicacion, zonaId, tipo}}: el
 * {@link OrganizacionDto} que el módulo ya sirve por REST más la {@code clase}
 * que distingue un centro de una zona. No se escribe un proyector nuevo.
 */
@Component
public class OrganizacionPushListener {

    /** Destino del ciclo de vida de los elementos del mapa (diseño US2 D3). */
    public static final String DESTINO_MAPA = "/topic/map.events";

    /** Marca de clase del elemento: un centro de ayuda o de acopio. */
    public static final String CLASE_CENTRO = "CENTRO";

    /**
     * Marca del evento segun el catalogo del diseno US2 D4. Viaja DENTRO del
     * payload, envolviendo al elemento: el consumidor lo lee como
     * {@code payload.type}.
     */
    public static final String TIPO_ELEMENTO_UPSERT = "mapa.elemento.upsert";

    private final PushPort pushPort;

    public OrganizacionPushListener(PushPort pushPort) {
        this.pushPort = pushPort;
    }

    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    public void alRegistrarOrganizacion(OrganizacionRegistradaEvento evento) {
        pushPort.publicar(DESTINO_MAPA, aPayload(evento.organizacion()));
    }

    /**
     * Arma el payload del centro: el DTO público más la {@code clase}. Se usa un
     * {@link Map} ordenado y explícito para que la forma del frame quede fija y
     * legible, sin exponer un tipo de dominio por el canal.
     */
    private static Map<String, Object> aPayload(OrganizacionDto organizacion) {
        Map<String, Object> elemento = new LinkedHashMap<>();
        elemento.put("clase", CLASE_CENTRO);
        elemento.put("id", organizacion.id());
        elemento.put("nombre", organizacion.nombre());
        elemento.put("ubicacion", organizacion.ubicacion());
        elemento.put("zonaId", organizacion.zonaId());
        elemento.put("tipo", organizacion.tipo());

        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("type", TIPO_ELEMENTO_UPSERT);
        payload.put("elemento", elemento);
        return payload;
    }
}
