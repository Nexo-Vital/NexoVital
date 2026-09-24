package co.edu.escuelaing.nexovital.mapa.domain.port.out;

/**
 * Puerto de salida hacia el canal de tiempo real (diseño US2 D5): el módulo
 * dueño del dato entrega el payload de push ya armado {@code {destino, payload}}
 * y no conoce el broker.
 *
 * <p>La tarea 244 (US2) implementa el canal: el adaptador real publica el payload
 * como evento de aplicación en proceso y el gateway lo reenvía a las sesiones
 * STOMP. El caso de uso no cambia porque solo conoce este puerto.
 */
public interface PushPort {

    /**
     * Publica un payload en un destino del canal de tiempo real.
     *
     * @param destino destino del canal (p. ej. {@code /topic/emergencias})
     * @param payload carga a publicar
     */
    void publicar(String destino, Object payload);
}
