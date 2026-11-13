package co.edu.escuelaing.nexovital.auditoria.infrastructure.adapter.in;

/**
 * Atributos con los que otras piezas le dejan datos a la bitácora de
 * peticiones sin depender de ella.
 *
 * <p>La bitácora se escribe al terminar la petición, cuando Spring Security ya
 * limpió el contexto de seguridad. Por eso quien sabe algo (el filtro que
 * autenticó, el registro de rechazos) lo deja en un atributo de la petición, o
 * de la sesión STOMP, y la bitácora lo lee al final.
 */
public final class AtributosBitacora {

    /** El {@code Usuario} autenticado. Lo pone {@code JwtAuthFilter}. */
    public static final String USUARIO = "nexovital.bitacora.usuario";

    /**
     * Quién era cuando todavía no hay usuario de NexoVital, por ejemplo
     * {@code google:<uid>} en el registro.
     */
    public static final String ACTOR_EXTERNO = "nexovital.bitacora.actorExterno";

    /** Motivo corto de un rechazo ({@code token_ausente}, {@code recurso_ajeno}...). */
    public static final String MOTIVO = "nexovital.bitacora.motivo";

    /** IP del cliente, guardada en la sesión STOMP durante el handshake. */
    public static final String IP_SESION = "nexovital.bitacora.ip";

    /** User-Agent del cliente, guardado en la sesión STOMP durante el handshake. */
    public static final String NAVEGADOR_SESION = "nexovital.bitacora.navegador";

    private AtributosBitacora() {
        // Solo constantes.
    }
}
