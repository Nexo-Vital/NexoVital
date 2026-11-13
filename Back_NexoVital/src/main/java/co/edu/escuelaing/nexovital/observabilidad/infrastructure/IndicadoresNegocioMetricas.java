package co.edu.escuelaing.nexovital.observabilidad.infrastructure;

import co.edu.escuelaing.nexovital.observabilidad.domain.model.IndicadoresNegocio;
import co.edu.escuelaing.nexovital.observabilidad.domain.port.out.IndicadoresNegocioQueryPort;
import io.micrometer.core.instrument.Gauge;
import io.micrometer.core.instrument.MeterRegistry;
import java.util.List;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import java.util.function.ToDoubleFunction;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.DisposableBean;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Component;

/**
 * Publica en Prometheus los indicadores del tablero de negocio (Sprint 2, T41).
 *
 * <p>Cada {@value #INTERVALO_POR_DEFECTO_MS} ms (configurable con
 * {@code nexovital.metricas.negocio.intervalo-ms}) lee una foto de la base con
 * {@link IndicadoresNegocioQueryPort} y la deja en memoria; los gauges solo leen
 * esa foto, así que un raspado de Prometheus nunca consulta la base.
 *
 * <p>Las dos instancias publican el mismo valor, porque los dos leen la misma
 * base. Por eso el tablero los combina con {@code max()} y no con {@code sum()}:
 * sumarlos contaría cada emergencia dos veces.
 *
 * <p>Métricas (nombre en Prometheus):
 * <ul>
 *   <li>{@code nexovital_negocio_emergencias_reportadas}</li>
 *   <li>{@code nexovital_negocio_donaciones_completadas}</li>
 *   <li>{@code nexovital_negocio_asignacion_segundos_promedio}</li>
 *   <li>{@code nexovital_negocio_asignaciones}</li>
 *   <li>{@code nexovital_negocio_centros{semaforo="ROJO|AMARILLO|VERDE|COMPLETO"}}</li>
 * </ul>
 * Hasta la primera lectura valen {@code NaN} («sin datos» en el tablero), nunca
 * un 0 inventado.
 */
@Component
public class IndicadoresNegocioMetricas implements DisposableBean {

    private static final Logger LOG = LoggerFactory.getLogger(IndicadoresNegocioMetricas.class);

    static final String EMERGENCIAS = "nexovital.negocio.emergencias.reportadas";
    static final String DONACIONES = "nexovital.negocio.donaciones.completadas";
    static final String ASIGNACION_PROMEDIO = "nexovital.negocio.asignacion.segundos.promedio";
    static final String ASIGNACIONES = "nexovital.negocio.asignaciones";
    static final String CENTROS = "nexovital.negocio.centros";
    static final List<String> NIVELES_SEMAFORO = List.of("ROJO", "AMARILLO", "VERDE", "COMPLETO");
    static final long INTERVALO_POR_DEFECTO_MS = 10_000;

    private final IndicadoresNegocioQueryPort fuente;
    private final long intervaloMs;
    private final AtomicReference<IndicadoresNegocio> ultimo = new AtomicReference<>();
    private final ScheduledExecutorService reloj = Executors.newSingleThreadScheduledExecutor(tarea -> {
        Thread hilo = new Thread(tarea, "indicadores-negocio");
        hilo.setDaemon(true);
        return hilo;
    });
    private volatile boolean fallando;

    public IndicadoresNegocioMetricas(
            MeterRegistry registro,
            IndicadoresNegocioQueryPort fuente,
            @Value("${nexovital.metricas.negocio.intervalo-ms:10000}") long intervaloMs) {
        this.fuente = fuente;
        this.intervaloMs = intervaloMs;
        registrar(registro, EMERGENCIAS, "Emergencias reportadas en la base de datos",
                IndicadoresNegocio::emergenciasReportadas);
        registrar(registro, DONACIONES, "Donaciones acreditadas (INSUMO_DONADO en la bitácora)",
                IndicadoresNegocio::donacionesCompletadas);
        registrar(registro, ASIGNACION_PROMEDIO,
                "Segundos promedio entre pedir una ambulancia y que una unidad la acepte",
                IndicadoresNegocio::segundosPromedioAsignacion);
        registrar(registro, ASIGNACIONES, "Asignaciones de ambulancia con las que se calcula el promedio",
                IndicadoresNegocio::asignacionesMedidas);
        for (String nivel : NIVELES_SEMAFORO) {
            Gauge.builder(CENTROS, this, metricas -> metricas.valor(indicadores -> indicadores.centrosEn(nivel)))
                    .description("Centros de acopio con inventario, por su peor nivel del semáforo")
                    .tag("semaforo", nivel)
                    .register(registro);
        }
    }

    /** Arranca la lectura periódica cuando la aplicación ya creó las tablas. */
    @EventListener(ApplicationReadyEvent.class)
    public void iniciar() {
        reloj.scheduleWithFixedDelay(this::refrescar, 0, intervaloMs, TimeUnit.MILLISECONDS);
    }

    /** Lee una foto nueva de la base. Público para las pruebas (T43). */
    public void refrescar() {
        try {
            ultimo.set(fuente.consultar());
            if (fallando) {
                LOG.info("indicadores_negocio disponibles=true");
                fallando = false;
            }
        } catch (RuntimeException e) {
            // Se conserva la última foto: un fallo puntual de la base no debe
            // borrar el tablero. El tablero técnico ya muestra la base caída.
            if (!fallando) {
                LOG.warn("indicadores_negocio disponibles=false motivo={}", e.getClass().getSimpleName());
                fallando = true;
            }
        }
    }

    @Override
    public void destroy() {
        reloj.shutdownNow();
    }

    private void registrar(MeterRegistry registro, String nombre, String descripcion,
                           ToDoubleFunction<IndicadoresNegocio> lectura) {
        Gauge.builder(nombre, this, metricas -> metricas.valor(lectura))
                .description(descripcion)
                .register(registro);
    }

    private double valor(ToDoubleFunction<IndicadoresNegocio> lectura) {
        IndicadoresNegocio indicadores = ultimo.get();
        return indicadores == null ? Double.NaN : lectura.applyAsDouble(indicadores);
    }
}
