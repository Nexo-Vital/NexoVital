package co.edu.escuelaing.nexovital.shared.domain.port.out;

/**
 * Puerto de salida hacia el canal de tiempo real (diseño US2 D5): el módulo
 * dueño del dato entrega el payload de push ya armado {@code {destino, payload}}
 * y no conoce el broker.
 *
 * <p>Vive en {@code shared} junto a
 * {@link co.edu.escuelaing.nexovital.shared.domain.model.PushMessage} y no en un
 * módulo de dominio: hay <b>dos</b> módulos que publican ({@code mapa} para las
 * emergencias y {@code usuarios} para los centros), así que el par
 * puerto+mensaje es infraestructura compartida. Tenerlo en {@code shared} evita
 * que {@code usuarios} dependa de {@code mapa} solo para publicar.
 *
 * <p>La tarea 244 (US2) implementa el canal: el adaptador real publica el payload
 * como evento de aplicación en proceso y el gateway lo reenvía a las sesiones
 * STOMP. El caso de uso no cambia porque solo conoce este puerto.
 */
public interface PushPort {

    /**
     * Publica un payload en un destino del canal de tiempo real.
     *
     * @param destino destino del canal (p. ej. {@code /topic/map.events})
     * @param payload carga a publicar
     */
    void publicar(String destino, Object payload);
}
