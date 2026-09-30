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

    /**
     * Entrega el payload a UN usuario, en su destino propio
     * ({@code /user/{usuario}{destino}}). Es obligatorio para un broadcast: un
     * destino {@code /queue} con N suscriptores reparte en round-robin y solo
     * alcanzaría a UNO. El adaptador de gateway resuelve la entrega con
     * {@code convertAndSendToUser}.
     *
     * @param usuario identidad del destinatario; debe coincidir con el nombre
     *                del {@code Principal} de su sesión STOMP. El STOMP Principal
     *                es el {@code Usuario} y {@code Usuario.getName()} resuelve a
     *                su id, así que aquí viaja ese id como texto.
     * @param destino destino del canal (p. ej. {@code /queue/solicitudes})
     * @param payload carga a publicar
     */
    void publicarAUsuario(String usuario, String destino, Object payload);
}
