package co.edu.escuelaing.nexovital.observabilidad.infrastructure;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;

/**
 * Pone un {@code traceId} en el MDC durante toda la petición HTTP y lo devuelve
 * en la respuesta (ESC-7, logs estructurados).
 *
 * <p><b>Antes que todo.</b> Corre en {@link Ordered#HIGHEST_PRECEDENCE}, así que
 * el id existe incluso en las líneas que escribe la cadena de seguridad cuando
 * rechaza una petición con 401 o 403: esos son justo los casos que hay que poder
 * correlacionar.
 *
 * <p><b>La cabecera la manda el cliente, el filtro la valida.</b> Si trae
 * {@value TraceId#CABECERA} con un valor aceptable se reutiliza —así un gateway o
 * un cliente que reintenta conserva la correlación entre saltos— y si no se
 * genera uno nuevo. La validación y el motivo están en {@link TraceId}.
 *
 * <p><b>Se limpia siempre.</b> El {@code finally} quita la clave del MDC: los
 * hilos del contenedor se reutilizan y sin esa limpieza una petición heredaría
 * el id de la anterior.
 *
 * <p>Límite conocido: los hilos que el contenedor usa para atender de forma
 * asíncrona o diferida no heredan el MDC, así que una petición que se despache a
 * otro hilo y siga escribiendo logs después no lleva el id. Para lo que se
 * necesita hoy —correlacionar el manejo síncrono de una petición, incluidas las
 * respuestas de error— alcanza y evita instrumentar cada capa.
 */
@Component
@Order(Ordered.HIGHEST_PRECEDENCE)
public class TraceIdFilter extends OncePerRequestFilter {

    @Override
    protected void doFilterInternal(HttpServletRequest request,
                                    HttpServletResponse response,
                                    FilterChain filterChain) throws ServletException, IOException {
        String id = TraceId.aceptado(request.getHeader(TraceId.CABECERA));
        TraceId.poner(id);
        response.setHeader(TraceId.CABECERA, id);
        try {
            filterChain.doFilter(request, response);
        } finally {
            TraceId.limpiar();
        }
    }
}
