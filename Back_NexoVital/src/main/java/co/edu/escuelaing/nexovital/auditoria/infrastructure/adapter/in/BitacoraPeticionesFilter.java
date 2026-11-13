package co.edu.escuelaing.nexovital.auditoria.infrastructure.adapter.in;

import co.edu.escuelaing.nexovital.auditoria.domain.model.PeticionRegistrada;
import co.edu.escuelaing.nexovital.auditoria.domain.port.out.BitacoraPeticionesPort;
import co.edu.escuelaing.nexovital.observabilidad.infrastructure.TraceId;
import co.edu.escuelaing.nexovital.usuarios.domain.model.Usuario;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.lang.NonNull;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.time.Clock;
import java.util.List;
import java.util.UUID;

/**
 * Registra en la bitácora TODAS las peticiones HTTP (S-2, EP-06.F2.US2, T14):
 * hora, IP, usuario, navegador y país, además de método, ruta, resultado,
 * duración y {@code traceId}.
 *
 * <p><b>Por fuera de Spring Security.</b> Corre justo después de
 * {@code TraceIdFilter} y antes de la cadena de seguridad, envolviéndola. Así ve
 * también las peticiones que la seguridad corta con 401 o 403, que son las que
 * más interesa reconstruir. Como al terminar la cadena el contexto de seguridad
 * ya está limpio, el usuario lo deja {@code JwtAuthFilter} en el atributo
 * {@link AtributosBitacora#USUARIO}.
 *
 * <p><b>Sin costo para el API.</b> Aquí solo se arma el registro y se encola;
 * la escritura en la base va por lotes en otro hilo y el país se resuelve allí.
 *
 * <p><b>Excepciones.</b> Por defecto se excluyen {@code /actuator/prometheus} y
 * {@code /actuator/health}: no son peticiones de usuarios sino el raspado de
 * métricas (cada 15 s por instancia) y las sondas de la plataforma, y llenarían
 * la bitácora de ruido. La lista se cambia con {@code nexovital.bitacora.excluir}
 * y vacía no excluye nada.
 */
@Component
@Order(Ordered.HIGHEST_PRECEDENCE + 1)
public class BitacoraPeticionesFilter extends OncePerRequestFilter {

    private static final int MAX_RUTA = 500;
    private static final int MAX_NAVEGADOR = 300;

    private final BitacoraPeticionesPort bitacora;
    private final Clock clock;
    private final String instancia;
    private final boolean habilitada;
    private final List<String> excluidas;

    public BitacoraPeticionesFilter(BitacoraPeticionesPort bitacora,
                                    Clock clock,
                                    @Value("${nexovital.instancia-id:local}") String instancia,
                                    @Value("${nexovital.bitacora.enabled:true}") boolean habilitada,
                                    @Value("${nexovital.bitacora.excluir:/actuator/prometheus,/actuator/health}")
                                    List<String> excluidas) {
        this.bitacora = bitacora;
        this.clock = clock;
        this.instancia = instancia;
        this.habilitada = habilitada;
        this.excluidas = excluidas.stream().map(String::trim).filter(s -> !s.isEmpty()).toList();
    }

    @Override
    protected boolean shouldNotFilter(@NonNull HttpServletRequest request) {
        if (!habilitada) {
            return true;
        }
        String ruta = request.getRequestURI();
        return excluidas.stream().anyMatch(excluida -> ruta.equals(excluida) || ruta.startsWith(excluida + "/"));
    }

    @Override
    protected void doFilterInternal(@NonNull HttpServletRequest request,
                                    @NonNull HttpServletResponse response,
                                    @NonNull FilterChain filterChain) throws ServletException, IOException {
        long inicio = System.nanoTime();
        boolean fallo = false;
        try {
            filterChain.doFilter(request, response);
        } catch (IOException | ServletException | RuntimeException e) {
            fallo = true;
            throw e;
        } finally {
            long duracionMs = (System.nanoTime() - inicio) / 1_000_000;
            // Una excepción que se escapa termina en 500 aunque la respuesta
            // todavía diga 200: el contenedor la convierte después.
            int estado = fallo && response.getStatus() < 400
                    ? HttpServletResponse.SC_INTERNAL_SERVER_ERROR
                    : response.getStatus();
            bitacora.registrar(armar(request, estado, duracionMs));
        }
    }

    private PeticionRegistrada armar(HttpServletRequest request, int estado, long duracionMs) {
        Usuario usuario = request.getAttribute(AtributosBitacora.USUARIO) instanceof Usuario u ? u : null;
        Object actorExterno = request.getAttribute(AtributosBitacora.ACTOR_EXTERNO);
        Object motivo = request.getAttribute(AtributosBitacora.MOTIVO);

        String actor;
        if (usuario != null) {
            actor = usuario.getEmail();
        } else if (actorExterno != null) {
            actor = actorExterno.toString();
        } else {
            actor = PeticionRegistrada.ACTOR_ANONIMO;
        }

        return new PeticionRegistrada(
                UUID.randomUUID(),
                clock.instant(),
                PeticionRegistrada.CANAL_HTTP,
                request.getMethod(),
                recortar(request.getRequestURI(), MAX_RUTA),
                estado,
                duracionMs,
                usuario == null ? null : usuario.getId(),
                usuario == null ? null : usuario.getRol().name(),
                actor,
                IpCliente.de(request),
                null,
                recortar(request.getHeader("User-Agent"), MAX_NAVEGADOR),
                TraceId.actual(),
                instancia,
                motivo == null ? null : motivo.toString());
    }

    static String recortar(String texto, int maximo) {
        if (texto == null) {
            return null;
        }
        return texto.length() > maximo ? texto.substring(0, maximo) : texto;
    }
}
