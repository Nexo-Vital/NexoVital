package co.edu.escuelaing.nexovital.auditoria.domain.model;

import java.time.Instant;
import java.util.Objects;
import java.util.UUID;

/**
 * Una entrada de la bitácora de peticiones (S-2, EP-06.F2.US2).
 *
 * <p>Guarda lo mínimo que exige el profesor —hora, IP, usuario, navegador y
 * país— y lo que hace falta para reconstruir lo ocurrido: canal, método, ruta,
 * resultado, duración y el {@code traceId} que enlaza la petición con sus logs y
 * con las acciones críticas de {@link EventoAuditoria}.
 *
 * <p>El país no lo calcula quien registra: se resuelve a partir de la IP justo
 * antes de escribir el lote, fuera del hilo de la petición, para no sumarle
 * latencia al API. Por eso el registro nace con {@code pais = null}.
 *
 * @param canal      {@link #CANAL_HTTP} o {@link #CANAL_STOMP}
 * @param metodo     verbo HTTP, o el comando STOMP ({@code CONNECT},
 *                   {@code SUBSCRIBE}, {@code DISCONNECT})
 * @param ruta       URI sin query string, o el destino STOMP
 * @param estado     código HTTP; en STOMP 200 si se aceptó y 403 si se rechazó
 * @param duracionMs tiempo que tomó atender la petición; {@code null} en STOMP
 * @param usuarioId  usuario de NexoVital, o {@code null} si es anónimo
 * @param actor      quién era cuando no hay usuario: {@code anonimo} o
 *                   {@code google:<uid>} para una cuenta sin registrar
 * @param detalle    motivo del rechazo ({@code token_ausente},
 *                   {@code recurso_ajeno}, ...), o {@code null}
 */
public record PeticionRegistrada(
        UUID id,
        Instant ocurridoEn,
        String canal,
        String metodo,
        String ruta,
        int estado,
        Long duracionMs,
        UUID usuarioId,
        String usuarioRol,
        String actor,
        String ip,
        String pais,
        String navegador,
        String traceId,
        String instancia,
        String detalle) {

    public static final String CANAL_HTTP = "HTTP";
    public static final String CANAL_STOMP = "STOMP";
    public static final String ACTOR_ANONIMO = "anonimo";

    public PeticionRegistrada {
        Objects.requireNonNull(id, "id");
        Objects.requireNonNull(ocurridoEn, "ocurridoEn");
        Objects.requireNonNull(canal, "canal");
        Objects.requireNonNull(metodo, "metodo");
    }

    /** Copia con el país ya resuelto. */
    public PeticionRegistrada conPais(String paisResuelto) {
        return new PeticionRegistrada(id, ocurridoEn, canal, metodo, ruta, estado, duracionMs,
                usuarioId, usuarioRol, actor, ip, paisResuelto, navegador, traceId, instancia, detalle);
    }
}
