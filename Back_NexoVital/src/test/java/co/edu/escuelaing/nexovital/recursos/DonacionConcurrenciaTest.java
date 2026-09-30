package co.edu.escuelaing.nexovital.recursos;

import co.edu.escuelaing.nexovital.recursos.domain.port.in.RegistrarDonacionUseCase;
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
import java.util.concurrent.CyclicBarrier;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * C1 sobre el camino de escritura: <b>dos donaciones concurrentes al mismo item
 * no pierden una actualización</b>. El crédito se aplica con una sola sentencia
 * atómica ({@code disponible = disponible + :cantidad}), nunca con un
 * read-modify-write en Java, así que el stock final debe ser la suma de las dos.
 *
 * <p>Se fuerzan dos hilos reales contra la base real, liberados por una
 * {@link CyclicBarrier} justo antes de entrar al caso de uso (misma mecánica que
 * {@code IntentosConcurrentesTest}). Un test secuencial no probaría la carrera;
 * hay que forzarla.
 *
 * <p>El item es propio de este test (id aleatorio, prefijo), se siembra antes y
 * se borra después: la H2 de test es compartida y otros tests cuentan filas o
 * leen cantidades exactas del inventario sembrado.
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
@Import(TestClockConfig.class)
class DonacionConcurrenciaTest extends LoginTestBase {

    private static final String PREFIJO_PRUEBA = "Prueba DON-CONC ";

    private static final int DISPONIBLE_INICIAL = 100;
    private static final int APORTE_A = 7;
    private static final int APORTE_B = 13;

    /** Generous window so lock contention is not the failure. */
    private static final long ESPERA_MAXIMA_SEGUNDOS = 60L;

    @Autowired
    private RegistrarDonacionUseCase registrarDonacionUseCase;

    @Autowired
    private ListarOrganizacionesUseCase listarOrganizacionesUseCase;

    @Autowired
    private ItemInventarioJpaRepository itemInventarioJpaRepository;

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
                1000,
                null,
                null));
    }

    @AfterEach
    void limpiarItemDePrueba() {
        List<ItemInventarioJpaEntity> aBorrar = itemInventarioJpaRepository.findAll().stream()
                .filter(entidad -> entidad.getNombre().startsWith(PREFIJO_PRUEBA))
                .toList();
        itemInventarioJpaRepository.deleteAll(aBorrar);
    }

    @Test
    @DisplayName("Dos donaciones concurrentes al mismo item: el stock final es la suma, sin actualización perdida")
    void dosDonacionesConcurrentesNoPierdenActualizacion() throws Exception {
        List<Throwable> resultados = ejecutarDonacionesConcurrentes();

        assertTrue(resultados.stream().noneMatch(Objects::nonNull),
                "ninguna donación concurrente debe fallar: " + describir(resultados));

        int stockFinal = itemInventarioJpaRepository.findById(itemId).orElseThrow().getDisponible();
        assertEquals(DISPONIBLE_INICIAL + APORTE_A + APORTE_B, stockFinal,
                "el crédito atómico no debe perder ninguna de las dos donaciones");
    }

    /**
     * Dispara una donación por hilo (una cantidad distinta cada uno) y devuelve
     * lo que cada uno lanzó, o {@code null} si la donación se registró. Los hilos
     * se alinean en la barrera justo antes del caso de uso para que lean el stock
     * casi al mismo tiempo: es exactamente la carrera que el crédito atómico debe
     * resistir.
     */
    private List<Throwable> ejecutarDonacionesConcurrentes() throws Exception {
        List<Integer> cantidades = List.of(APORTE_A, APORTE_B);
        ExecutorService pool = Executors.newFixedThreadPool(cantidades.size());
        try {
            CyclicBarrier barrera = new CyclicBarrier(cantidades.size());
            List<Future<Throwable>> futuros = new ArrayList<>();
            for (int cantidad : cantidades) {
                Callable<Throwable> donacion = () -> {
                    barrera.await(ESPERA_MAXIMA_SEGUNDOS, TimeUnit.SECONDS);
                    try {
                        registrarDonacionUseCase.donar(centroId, itemId, cantidad);
                        return null;
                    } catch (RuntimeException e) {
                        return e;
                    }
                };
                futuros.add(pool.submit(donacion));
            }

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
