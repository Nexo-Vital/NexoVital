package co.edu.escuelaing.nexovital.recursos;

import co.edu.escuelaing.nexovital.recursos.domain.exception.StockInsuficienteException;
import co.edu.escuelaing.nexovital.recursos.domain.port.in.DespacharStockUseCase;
import co.edu.escuelaing.nexovital.recursos.infrastructure.adapter.out.AlertaEscasezJpaEntity;
import co.edu.escuelaing.nexovital.recursos.infrastructure.adapter.out.AlertaEscasezJpaRepository;
import co.edu.escuelaing.nexovital.recursos.infrastructure.adapter.out.ItemInventarioJpaEntity;
import co.edu.escuelaing.nexovital.recursos.infrastructure.adapter.out.ItemInventarioJpaRepository;
import co.edu.escuelaing.nexovital.support.LoginTestBase;
import co.edu.escuelaing.nexovital.support.TestClockConfig;
import co.edu.escuelaing.nexovital.usuarios.domain.model.Organizacion;
import co.edu.escuelaing.nexovital.usuarios.domain.model.TipoOrganizacion;
import co.edu.escuelaing.nexovital.usuarios.domain.port.in.ListarOrganizacionesUseCase;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.ActiveProfiles;

import java.util.ArrayList;
import java.util.List;
import java.util.Objects;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * C1 sobre el camino de escritura del despacho: <b>stock finito 3, 100
 * solicitudes concurrentes → exactamente 3 éxitos y 97 rechazos</b>, y el stock
 * termina en 0 sin sobre-asignación.
 *
 * <p>La garantía la da el CAS de la base
 * ({@code UPDATE ... WHERE disponible >= :cantidad}, ver
 * {@link co.edu.escuelaing.nexovital.recursos.domain.port.out.InventarioRepository#transicionAtomicaDespacho}),
 * no un bloqueo en memoria. Se fuerzan hilos reales contra la base real,
 * liberados por una {@link CountDownLatch} justo antes de entrar al caso de uso:
 * un test secuencial no probaría la carrera, hay que forzarla.
 *
 * <p>El item es propio de este test (id aleatorio, prefijo), se siembra antes y
 * se borra después: la H2 de test es compartida y otros tests cuentan filas o
 * leen cantidades exactas del inventario sembrado (mismo patrón que
 * {@code DonacionConcurrenciaTest}).
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
@Import(TestClockConfig.class)
class DespachoConcurrenciaTest extends LoginTestBase {

    private static final String PREFIJO_PRUEBA = "Prueba DESP-CONC ";

    private static final int DISPONIBLE_INICIAL = 3;
    private static final int SOLICITUDES = 100;
    private static final int HILOS = 16;

    /** Generous window so lock contention is not the failure. */
    private static final long ESPERA_MAXIMA_SEGUNDOS = 60L;

    @Autowired
    private DespacharStockUseCase despacharStockUseCase;

    @Autowired
    private ListarOrganizacionesUseCase listarOrganizacionesUseCase;

    @Autowired
    private ItemInventarioJpaRepository itemInventarioJpaRepository;

    @Autowired
    private AlertaEscasezJpaRepository alertaEscasezJpaRepository;

    private UUID centroId;
    private UUID itemId;

    @BeforeEach
    void sembrarItemDePrueba() {
        centroId = listarOrganizacionesUseCase.listar(TipoOrganizacion.CENTRO_ACOPIO).stream()
                .filter(organizacion -> organizacion.getNombre().equals("Acopio Suba Norte"))
                .map(Organizacion::getId)
                .findFirst()
                .orElseThrow(() -> new AssertionError("seeded center not found: Acopio Suba Norte"));
        itemId = UUID.randomUUID();
        itemInventarioJpaRepository.save(new ItemInventarioJpaEntity(
                itemId,
                centroId,
                PREFIJO_PRUEBA + itemId,
                DISPONIBLE_INICIAL,
                1,
                null,
                null));
    }

    @AfterEach
    void limpiarItemDePrueba() {
        List<ItemInventarioJpaEntity> aBorrar = itemInventarioJpaRepository.findAll().stream()
                .filter(entidad -> entidad.getNombre().startsWith(PREFIJO_PRUEBA))
                .toList();
        itemInventarioJpaRepository.deleteAll(aBorrar);
        // Los rechazos dejan su alerta de escasez: se borra con el item para que
        // no quede huérfana en la H2 compartida.
        alertaEscasezJpaRepository.deleteAll(alertaEscasezJpaRepository.findAll().stream()
                .filter(alerta -> alerta.getNombre().startsWith(PREFIJO_PRUEBA))
                .toList());
    }

    @Test
    @DisplayName("C1: 100 despachos concurrentes sobre stock 3 dan exactamente 3 éxitos y 97 rechazos")
    void invarianteC1_100DespachosSobreStock3() throws Exception {
        List<Throwable> resultados = ejecutarDespachosConcurrentes();

        long exitos = resultados.stream().filter(Objects::isNull).count();
        long rechazos = resultados.stream().filter(StockInsuficienteException.class::isInstance).count();

        assertTrue(resultados.stream().allMatch(t -> t == null || t instanceof StockInsuficienteException),
                "ningún despacho debe fallar por algo distinto al stock insuficiente: " + describir(resultados));
        assertEquals(DISPONIBLE_INICIAL, exitos,
                "Invariante C1: exactamente 3 despachos exitosos sobre stock 3");
        assertEquals(SOLICITUDES - DISPONIBLE_INICIAL, rechazos,
                "Invariante C1: exactamente 97 rechazos por stock insuficiente");

        int stockFinal = itemInventarioJpaRepository.findById(itemId).orElseThrow().getDisponible();
        assertEquals(0, stockFinal, "el stock termina agotado, nunca negativo");

        // EP-03.F1.US5 (M-05): los 97 rechazos compiten por registrar la alerta
        // del MISMO item. Buscar y crear no es atómico, así que sin la
        // restricción única cada hilo podía dejar su propia fila.
        List<AlertaEscasezJpaEntity> alertas = alertasDelItem();
        assertEquals(1, alertas.size(),
                "97 rechazos simultáneos del mismo item dejan UNA sola alerta de escasez");
        assertEquals(1, alertas.get(0).getCantidadSolicitada(),
                "todos pidieron 1 unidad: la demanda registrada es 1");
    }

    @Test
    @DisplayName("M-05: rechazos concurrentes con demandas distintas dejan una alerta con la mayor demanda")
    void rechazosConcurrentesDejanUnaAlertaConLaMayorDemanda() throws Exception {
        // Stock 3 y cada hilo pide entre 4 y 43 unidades: TODOS son rechazados, y
        // todos compiten por crear o subir la alerta del mismo item.
        int rechazosEsperados = 40;
        int demandaMinima = DISPONIBLE_INICIAL + 1;
        int demandaMaxima = DISPONIBLE_INICIAL + rechazosEsperados;

        ExecutorService pool = Executors.newFixedThreadPool(HILOS);
        List<Throwable> resultados = new ArrayList<>();
        try {
            CountDownLatch largada = new CountDownLatch(1);
            List<Future<Throwable>> futuros = new ArrayList<>();
            for (int cantidad = demandaMinima; cantidad <= demandaMaxima; cantidad++) {
                int demanda = cantidad;
                Callable<Throwable> despacho = () -> {
                    largada.await(ESPERA_MAXIMA_SEGUNDOS, TimeUnit.SECONDS);
                    try {
                        despacharStockUseCase.despachar(centroId, itemId, demanda);
                        return null;
                    } catch (RuntimeException e) {
                        return e;
                    }
                };
                futuros.add(pool.submit(despacho));
            }
            largada.countDown();
            for (Future<Throwable> futuro : futuros) {
                try {
                    resultados.add(futuro.get(ESPERA_MAXIMA_SEGUNDOS, TimeUnit.SECONDS));
                } catch (ExecutionException e) {
                    resultados.add(e.getCause());
                }
            }
        } finally {
            pool.shutdownNow();
        }

        assertEquals(rechazosEsperados, resultados.size());
        assertTrue(resultados.stream().allMatch(StockInsuficienteException.class::isInstance),
                "todos piden más que el stock: todos deben ser rechazados con 409, nunca con otro error: "
                        + describir(resultados));
        assertEquals(DISPONIBLE_INICIAL, itemInventarioJpaRepository.findById(itemId).orElseThrow().getDisponible(),
                "un rechazo no mueve el stock");

        List<AlertaEscasezJpaEntity> alertas = alertasDelItem();
        assertEquals(1, alertas.size(), "una sola alerta por item, aunque 40 rechazos compitan por crearla");
        // FA-4 bajo carrera: una demanda menor que llega después no puede pisar
        // a una mayor que se escribió entre su lectura y su escritura.
        assertEquals(demandaMaxima, alertas.get(0).getCantidadSolicitada(),
                "la alerta conserva la MAYOR demanda rechazada");
    }

    private List<AlertaEscasezJpaEntity> alertasDelItem() {
        return alertaEscasezJpaRepository.findAll().stream()
                .filter(alerta -> alerta.getItemId().equals(itemId))
                .toList();
    }

    /**
     * Dispara un despacho por tarea (100 en total, {@value HILOS} hilos) y
     * devuelve lo que cada uno lanzó, o {@code null} si el despacho tuvo éxito.
     * Los hilos se alinean en la largada justo antes del caso de uso: es
     * exactamente la carrera que el CAS debe resistir.
     */
    private List<Throwable> ejecutarDespachosConcurrentes() throws Exception {
        ExecutorService pool = Executors.newFixedThreadPool(HILOS);
        try {
            CountDownLatch largada = new CountDownLatch(1);
            List<Future<Throwable>> futuros = new ArrayList<>();
            for (int i = 0; i < SOLICITUDES; i++) {
                Callable<Throwable> despacho = () -> {
                    largada.await(ESPERA_MAXIMA_SEGUNDOS, TimeUnit.SECONDS);
                    try {
                        despacharStockUseCase.despachar(centroId, itemId, 1);
                        return null;
                    } catch (RuntimeException e) {
                        return e;
                    }
                };
                futuros.add(pool.submit(despacho));
            }
            largada.countDown();

            List<Throwable> resultados = new ArrayList<>();
            for (Future<Throwable> futuro : futuros) {
                try {
                    resultados.add(futuro.get(ESPERA_MAXIMA_SEGUNDOS, TimeUnit.SECONDS));
                } catch (ExecutionException e) {
                    resultados.add(e.getCause());
                }
            }
            return resultados;
        } finally {
            pool.shutdownNow();
        }
    }

    private static String describir(List<Throwable> resultados) {
        return resultados.stream()
                .map(t -> t == null ? "ok" : t.getClass().getSimpleName() + ": " + t.getMessage())
                .toList()
                .toString();
    }
}
