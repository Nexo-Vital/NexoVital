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
        ServletRequestAttributes atributos =
                (ServletRequestAttributes) RequestContextHolder.getRequestAttributes();
        HttpServletRequest request = atributos == null ? null : atributos.getRequest();

        LOG.warn("acceso_denegado actor={} metodo={} ruta={} motivo={}",
                actorActual(),
                request == null ? SIN_DATO : request.getMethod(),
                request == null ? SIN_DATO : request.getRequestURI(),
                motivo);
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
