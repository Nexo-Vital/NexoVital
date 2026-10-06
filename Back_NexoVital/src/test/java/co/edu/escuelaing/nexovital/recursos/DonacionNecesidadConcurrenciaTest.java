package co.edu.escuelaing.nexovital.recursos;

import co.edu.escuelaing.nexovital.recursos.domain.exception.NecesidadCubiertaException;
import co.edu.escuelaing.nexovital.recursos.domain.model.DonacionAceptada;
import co.edu.escuelaing.nexovital.recursos.domain.port.in.RegistrarDonacionUseCase;
import co.edu.escuelaing.nexovital.recursos.infrastructure.adapter.out.ItemInventarioJpaEntity;
import co.edu.escuelaing.nexovital.recursos.infrastructure.adapter.out.ItemInventarioJpaRepository;
import co.edu.escuelaing.nexovital.support.LoginTestBase;
import co.edu.escuelaing.nexovital.support.TestClockConfig;
import co.edu.escuelaing.nexovital.usuarios.domain.model.Organizacion;
import co.edu.escuelaing.nexovital.usuarios.domain.model.TipoOrganizacion;
import co.edu.escuelaing.nexovital.usuarios.domain.port.in.ListarOrganizacionesUseCase;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.ActiveProfiles;

import java.util.ArrayList;
import java.util.List;
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
 * Concurrencia de la donación acotada (EP-03.F1.US2): varios donantes compiten
 * por la misma necesidad y la suma de lo aceptado NUNCA pasa de lo que faltaba.
 *
 * <p>Los hilos se alinean en una {@link CyclicBarrier} justo antes del caso de
 * uso, así que la carrera es real y no un test secuencial disfrazado. El item es
 * propio de cada test (prefijo, id aleatorio) y se borra después.
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
@Import(TestClockConfig.class)
class DonacionNecesidadConcurrenciaTest extends LoginTestBase {

    private static final String PREFIJO_PRUEBA = "Prueba DON-NEC ";
    private static final long ESPERA_MAXIMA_SEGUNDOS = 60L;

    @Autowired
    private RegistrarDonacionUseCase registrarDonacionUseCase;

    @Autowired
    private ListarOrganizacionesUseCase listarOrganizacionesUseCase;

    @Autowired
    private ItemInventarioJpaRepository itemInventarioJpaRepository;

    @AfterEach
    void limpiar() {
        List<ItemInventarioJpaEntity> aBorrar = itemInventarioJpaRepository.findAll().stream()
                .filter(entidad -> entidad.getNombre().startsWith(PREFIJO_PRUEBA))
                .toList();
        itemInventarioJpaRepository.deleteAll(aBorrar);
    }

    @Test
    @DisplayName("Necesidad de 10 y 5 donantes ofrecen 10 a la vez: exactamente 1 dona, los otros 4 reciben NECESIDAD_CUBIERTA")
    void cincoDonantesPorUnaNecesidadGanaUno() throws Exception {
        UUID centroId = centroSembrado();
        UUID itemId = sembrarItem(centroId, 0, 10);

        List<Object> resultados = donarEnParalelo(centroId, itemId, List.of(10, 10, 10, 10, 10));

        long aceptadas = resultados.stream().filter(r -> r instanceof DonacionAceptada).count();
        long rechazadas = resultados.stream().filter(r -> r instanceof NecesidadCubiertaException).count();
        assertEquals(1, aceptadas, "solo un donante cubre la necesidad: " + resultados);
        assertEquals(4, rechazadas, "los otros cuatro pierden la carrera: " + resultados);
        assertEquals(10, itemInventarioJpaRepository.findById(itemId).orElseThrow().getDisponible(),
                "el stock queda exactamente en el requerido");
    }

    @Test
    @DisplayName("Necesidad de 10 y dos donantes ofrecen 6: uno da 6 y el otro solo los 4 que completan")
    void elSegundoDonanteSoloCompleta() throws Exception {
        UUID centroId = centroSembrado();
        UUID itemId = sembrarItem(centroId, 0, 10);

        List<Object> resultados = donarEnParalelo(centroId, itemId, List.of(6, 6));

        List<Integer> aceptadas = resultados.stream()
                .filter(r -> r instanceof DonacionAceptada)
                .map(r -> ((DonacionAceptada) r).aceptada())
                .sorted()
                .toList();
        assertEquals(List.of(4, 6), aceptadas, "uno da todo y el otro solo lo suficiente: " + resultados);
        assertEquals(10, itemInventarioJpaRepository.findById(itemId).orElseThrow().getDisponible());
    }

    @Test
    @DisplayName("Muchos donantes con cantidades distintas: lo aceptado suma exactamente lo que faltaba, nunca más")
    void laSumaAceptadaNuncaPasaDeLoQueFaltaba() throws Exception {
        UUID centroId = centroSembrado();
        UUID itemId = sembrarItem(centroId, 4, 50);

        List<Object> resultados = donarEnParalelo(centroId, itemId, List.of(7, 9, 11, 13, 15, 17, 19, 21));

        int totalAceptado = resultados.stream()
                .filter(r -> r instanceof DonacionAceptada)
                .mapToInt(r -> ((DonacionAceptada) r).aceptada())
                .sum();
        assertEquals(46, totalAceptado, "lo aceptado es exactamente el faltante (50 - 4): " + resultados);
        assertEquals(50, itemInventarioJpaRepository.findById(itemId).orElseThrow().getDisponible());
        assertTrue(resultados.stream().allMatch(r -> r instanceof DonacionAceptada || r instanceof NecesidadCubiertaException),
                "ningún donante falla por otra razón: " + resultados);
    }

    private UUID centroSembrado() {
        return listarOrganizacionesUseCase.listar(TipoOrganizacion.CENTRO_ACOPIO).stream()
                .filter(organizacion -> organizacion.getNombre().equals("Acopio Suba Norte"))
                .map(Organizacion::getId)
                .findFirst()
                .orElseThrow(() -> new AssertionError("seeded center not found: Acopio Suba Norte"));
    }

    private UUID sembrarItem(UUID centroId, int disponible, int requerido) {
        UUID itemId = UUID.randomUUID();
        itemInventarioJpaRepository.save(new ItemInventarioJpaEntity(
                itemId, centroId, PREFIJO_PRUEBA + itemId, disponible, requerido, null, null));
        return itemId;
    }

    /** Un hilo por donante; devuelve el resultado o la excepción de cada uno. */
    private List<Object> donarEnParalelo(UUID centroId, UUID itemId, List<Integer> cantidades) throws Exception {
        ExecutorService pool = Executors.newFixedThreadPool(cantidades.size());
        try {
            CyclicBarrier barrera = new CyclicBarrier(cantidades.size());
            List<Future<Object>> futuros = new ArrayList<>();
            for (int cantidad : cantidades) {
                Callable<Object> donante = () -> {
                    barrera.await(ESPERA_MAXIMA_SEGUNDOS, TimeUnit.SECONDS);
                    try {
                        return registrarDonacionUseCase.donar(centroId, itemId, cantidad);
                    } catch (RuntimeException e) {
                        return e;
                    }
                };
                futuros.add(pool.submit(donante));
            }
            List<Object> resultados = new ArrayList<>();
            for (Future<Object> futuro : futuros) {
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
}
