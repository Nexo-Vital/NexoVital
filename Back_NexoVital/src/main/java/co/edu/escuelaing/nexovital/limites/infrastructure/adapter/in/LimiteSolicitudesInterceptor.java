package co.edu.escuelaing.nexovital.limites.infrastructure.adapter.in;

import co.edu.escuelaing.nexovital.limites.application.LimitadorDeSolicitudes;
import co.edu.escuelaing.nexovital.limites.domain.model.RecursoLimitado;
import co.edu.escuelaing.nexovital.limites.domain.model.VeredictoLimite;
import co.edu.escuelaing.nexovital.shared.infrastructure.dto.ErrorResponse;
import co.edu.escuelaing.nexovital.usuarios.domain.model.Usuario;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Component;
import org.springframework.web.servlet.HandlerInterceptor;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.time.Instant;
import java.util.UUID;
import java.util.regex.Pattern;

/**
 * Interceptor que aplica el límite antes de que la petición llegue al
 * controlador.
 *
 * <p>Corre dentro del {@code DispatcherServlet}, o sea después de la cadena de
 * seguridad: cuando llega acá la petición ya está autenticada y hay un actor al
 * que contarle la solicitud. En un filtro de servlet habría que resolver el
 * token a mano para lo mismo.
 *
 * <p><b>La IP se lee de {@code X-Forwarded-For}, no de {@code remoteAddr}.</b>
 * Con el balanceador adelante, {@code remoteAddr} es siempre la IP del
 * balanceador: limitar por ahí bloquearía a todos los usuarios a la vez en
 * cuanto uno abuse. Se toma la primera entrada de la cadena, que es la del
 * cliente original.
 *
 * <p>Eso solo es confiable porque el proxy de entrada REEMPLAZA la cabecera en
 * vez de agregarle (Sprint 2, T18): el nginx del compose manda
 * {@code X-Forwarded-For $remote_addr} y el nginx del front en Azure resuelve
 * la IP real con {@code realip} antes de reenviarla. Si un proxy volviera a
 * usar {@code $proxy_add_x_forwarded_for}, un cliente podría inventar la
 * primera entrada y evadir el límite por IP.
 *
 * <p>El rechazo queda registrado con el mismo formato {@code clave=valor} que la
 * bitácora de accesos denegados, para poder contar patrones en el tablero
 * técnico.
 */
@Component
public class LimiteSolicitudesInterceptor implements HandlerInterceptor {

    private static final Logger LOG = LoggerFactory.getLogger(LimiteSolicitudesInterceptor.class);

    private static final String CABECERA_IP_REAL = "X-Forwarded-For";
    private static final String METODO_LIMITADO = "POST";
    private static final String RUTA_EMERGENCIAS = "/api/v1/emergencias";
    private static final Pattern RUTA_DONACION =
            Pattern.compile("/api/v1/centros-acopio/[^/]+/inventario/donacion$");

    private static final String CODIGO = "DEMASIADAS_SOLICITUDES";
    private static final String MENSAJE =
            "Has hecho demasiadas solicitudes en poco tiempo. Espera y vuelve a intentarlo.";

    private final LimitadorDeSolicitudes limitador;
    private final ObjectMapper objectMapper;
    private final Clock clock;

    public LimiteSolicitudesInterceptor(LimitadorDeSolicitudes limitador,
                                        ObjectMapper objectMapper,
                                        Clock clock) {
        this.limitador = limitador;
        this.objectMapper = objectMapper;
        this.clock = clock;
    }

    @Override
    public boolean preHandle(HttpServletRequest request,
                             HttpServletResponse response,
                             Object handler) throws IOException {
        RecursoLimitado recurso = recursoDe(request);
        if (recurso == null) {
            return true;
        }

        String ip = ipDelCliente(request);
        UUID actor = actorActual();
        VeredictoLimite veredicto = limitador.evaluar(recurso, actor, ip, Instant.now(clock));
        if (veredicto.permitido()) {
            return true;
        }

        LOG.warn("limite_excedido actor={} ip={} recurso={} metodo={} ruta={}",
                actor == null ? "anonimo" : actor,
                ip,
                recurso.name(),
                request.getMethod(),
                request.getRequestURI());
        escribirRechazo(response, veredicto.segundosParaReintentar());
        return false;
    }

    /** Solo POST y solo las rutas que crean estado y son fáciles de inundar. */
    private static RecursoLimitado recursoDe(HttpServletRequest request) {
        if (!METODO_LIMITADO.equals(request.getMethod())) {
            return null;
        }
        String ruta = request.getRequestURI();
        if (ruta == null) {
            return null;
        }
        if (ruta.endsWith(RUTA_EMERGENCIAS)) {
            return RecursoLimitado.EMERGENCIA;
        }
        if (RUTA_DONACION.matcher(ruta).find()) {
            return RecursoLimitado.DONACION;
        }
        return null;
    }

    private static String ipDelCliente(HttpServletRequest request) {
        String reenviada = request.getHeader(CABECERA_IP_REAL);
        if (reenviada != null && !reenviada.isBlank()) {
            // "cliente, proxy1, proxy2": el primero es el origen real.
            return reenviada.split(",")[0].trim();
        }
        return request.getRemoteAddr();
    }

    private static UUID actorActual() {
        Authentication authentication = SecurityContextHolder.getContext().getAuthentication();
        if (authentication == null || !authentication.isAuthenticated()) {
            return null;
        }
        if (authentication.getPrincipal() instanceof Usuario usuario) {
            return usuario.getId();
        }
        return null;
    }

    private void escribirRechazo(HttpServletResponse response, long segundosParaReintentar)
            throws IOException {
        response.setStatus(429);
        response.setHeader(HttpHeaders.RETRY_AFTER, Long.toString(segundosParaReintentar));
        response.setContentType(MediaType.APPLICATION_JSON_VALUE);
        response.setCharacterEncoding(StandardCharsets.UTF_8.name());
        objectMapper.writeValue(response.getWriter(), ErrorResponse.of(CODIGO, MENSAJE));
    }
}
