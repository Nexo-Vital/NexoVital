package co.edu.escuelaing.nexovital.infrastructure.config;

import co.edu.escuelaing.nexovital.usuarios.domain.model.Usuario;
import jakarta.servlet.http.HttpServletRequest;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Component;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;

/**
 * Bitácora de intentos denegados: quién intentó, qué método, sobre qué ruta y
 * por qué se le negó.
 *
 * <p>Un 403 silencioso no sirve para detectar abuso. Sin este registro, cien
 * intentos de un conductor tocando la ambulancia de otro se ven exactamente
 * igual que cero intentos: el cliente recibe su error y el servidor no deja
 * rastro. El escenario de autorización exige registrar el intento, y este es el
 * punto único donde se hace, tanto para los rechazos por rol (que resuelve
 * {@link SecurityConfig}) como para los rechazos por pertenencia del recurso
 * (que resuelven los adaptadores de entrada).
 *
 * <p>El formato es {@code clave=valor} para que la línea se pueda filtrar con
 * {@code grep acceso_denegado} y separar por campo en un tablero de métricas.
 *
 * <p>El actor se toma del {@code Principal} de seguridad, que es el
 * {@link Usuario} de dominio; si la petición no llegó autenticada se registra
 * {@code anonimo}. Nunca se registra el token ni la contraseña.
 *
 * <p><b>Intentos sin sesión válida (Sprint 2, S-1 / T11).</b> Un 401 tampoco
 * puede ser silencioso: el escenario de autenticación exige "rechaza y registra
 * el intento". Esos casos se registran con la clave {@code autenticacion_fallida}
 * (no {@code acceso_denegado}) para poder separarlos: un 401 es "no sé quién
 * sos" y un 403 es "sé quién sos y no podés".
 */
@Component
public class RegistroAccesoDenegado {

    private static final Logger LOG = LoggerFactory.getLogger(RegistroAccesoDenegado.class);

    private static final String ACTOR_ANONIMO = "anonimo";
    private static final String SIN_DATO = "-";

    /**
     * Registra un intento denegado del contexto HTTP en curso.
     *
     * @param motivo causa corta y estable, por ejemplo {@code rol_insuficiente}
     *               o {@code recurso_ajeno}
     */
    public void registrar(String motivo) {
        registrarComo(actorActual(), rolActual(), motivo);
    }

    /**
     * Registra un intento denegado de alguien que todavía no tiene usuario en
     * NexoVital, pero sí una identidad verificada por Google: por ejemplo, quien
     * intenta registrarse como administrador de plataforma (T10/T11). El actor
     * queda como {@code google:<uid>} para poder seguir el patrón.
     */
    public void registrarIdentidadExterna(String uidExterno, String motivo) {
        registrarComo("google:" + uidExterno, SIN_DATO, motivo);
    }

    /**
     * Formato único del 403 (S-1 / T11): quién (actor y rol), qué (método y
     * ruta, que incluye el id del recurso), desde dónde (IP) y por qué. La hora
     * la pone el log. Nunca se escribe el token.
     */
    private static void registrarComo(String actor, String rol, String motivo) {
        ServletRequestAttributes atributos =
                (ServletRequestAttributes) RequestContextHolder.getRequestAttributes();
        HttpServletRequest request = atributos == null ? null : atributos.getRequest();

        LOG.warn("acceso_denegado actor={} rol={} metodo={} ruta={} ip={} motivo={}",
                actor,
                rol,
                request == null ? SIN_DATO : request.getMethod(),
                request == null ? SIN_DATO : request.getRequestURI(),
                request == null ? SIN_DATO : ipDelCliente(request),
                motivo);
    }

    /**
     * Registra una petición HTTP rechazada con 401: token ausente, vencido,
     * alterado o emitido para otra aplicación.
     *
     * @param motivo {@code token_ausente} o {@code token_invalido}
     */
    public void registrarNoAutenticado(HttpServletRequest request, String motivo) {
        LOG.warn("autenticacion_fallida canal=http metodo={} ruta={} ip={} motivo={}",
                request.getMethod(), request.getRequestURI(), ipDelCliente(request), motivo);
    }

    /**
     * Registra un {@code CONNECT} STOMP rechazado: el canal en tiempo real no
     * se abre y queda constancia del intento.
     *
     * @param motivo {@code token_ausente}, {@code token_invalido} o
     *               {@code sesion_no_autenticada}
     */
    public void registrarNoAutenticadoStomp(String motivo) {
        LOG.warn("autenticacion_fallida canal=stomp motivo={}", motivo);
    }

    /**
     * Primera entrada de {@code X-Forwarded-For} (la que escribe nginx) o, sin
     * proxy delante, la dirección de la conexión. Mismo criterio que el
     * limitador de solicitudes.
     */
    private static String ipDelCliente(HttpServletRequest request) {
        String reenviada = request.getHeader("X-Forwarded-For");
        if (reenviada != null && !reenviada.isBlank()) {
            return reenviada.split(",")[0].trim();
        }
        return request.getRemoteAddr();
    }

    private static String rolActual() {
        Authentication authentication = SecurityContextHolder.getContext().getAuthentication();
        if (authentication != null && authentication.getPrincipal() instanceof Usuario usuario) {
            return usuario.getRol().name();
        }
        return SIN_DATO;
    }

    private static String actorActual() {
        Authentication authentication = SecurityContextHolder.getContext().getAuthentication();
        if (authentication == null || !authentication.isAuthenticated()) {
            return ACTOR_ANONIMO;
        }
        if (authentication.getPrincipal() instanceof Usuario usuario) {
            return usuario.getId().toString();
        }
        return authentication.getName();
    }
}
