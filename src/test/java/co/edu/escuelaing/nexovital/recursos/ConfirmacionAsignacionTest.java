package co.edu.escuelaing.nexovital.recursos;

import co.edu.escuelaing.nexovital.recursos.domain.exception.StockInsuficienteException;
import co.edu.escuelaing.nexovital.recursos.domain.port.in.DespacharStockUseCase;
import co.edu.escuelaing.nexovital.recursos.infrastructure.adapter.out.ItemInventarioJpaEntity;
import co.edu.escuelaing.nexovital.recursos.infrastructure.adapter.out.ItemInventarioJpaRepository;
import co.edu.escuelaing.nexovital.support.LoginTestBase;
import co.edu.escuelaing.nexovital.support.PushPortDePruebaConfig;
import co.edu.escuelaing.nexovital.support.PushPortDePruebaConfig.PushPortDePrueba;
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
import org.springframework.http.MediaType;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.RequestBuilder;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
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
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * Los <b>tres escenarios del criterio de aceptación</b> de la historia Azure
 * <b>194</b> ({@code EP-03.F1.US2 Confirmar la asignación de un recurso}), con
 * los números EXACTOS que el AC fija: {@code 1/1}, {@code 5/1 simultáneos} y
 * {@code 0/1}.
 *
 * <p>No reemplazan ni debilitan las pruebas existentes del despacho: el
 * invariante general (100 solicitudes sobre stock 3 → exactamente 3 éxitos)
 * sigue viviendo en {@code DespachoConcurrenciaTest}, y el camino HTTP
 * 3×200 + 4º 409 en {@code DespachoHttpTest}. Estas pruebas <b>se suman</b> para
 * que el AC quede verificado escenario por escenario.
 *
 * <p>El escenario 2 es una <b>carrera real</b>: 5 hilos se alinean en una
 * {@link CyclicBarrier} justo antes de entrar al caso de uso, de modo que los
 * cinco tienen que llegar antes de que alguno sea liberado. Un {@code for}
 * secuencial pasaría incluso con la concurrencia rota, por eso no se usa. La
 * garantía la da el CAS de la base
 * ({@code ItemInventarioJpaRepository.transicionAtomicaDespacho}, un único
 * {@code UPDATE ... WHERE disponible >= :cantidad}), nunca un bloqueo en
 * memoria ni un chequeo previo en el dominio.
 *
 * <p>Cada test crea su PROPIO item (id aleatorio, nombre con prefijo) y lo
 * borra al final: la H2 de test es compartida y otros tests leen cantidades
 * exactas del inventario sembrado (mismo patrón que {@code DespachoHttpTest} y
 * {@code DespachoConcurrenciaTest}). Se usa el doble del {@code PushPort} para
 * no depender del broker ni de una sesión STOMP.
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
@Import({TestClockConfig.class, PushPortDePruebaConfig.class})
class ConfirmacionAsignacionTest extends LoginTestBase {

    private static final String CIUDADANO = "ciudadano@nexovital.co";
    private static final String CIUDADANO_PASSWORD = "ciudadano123";

    /** Prefix of the items created only by this test, removed afterwards. */
    private static final String PREFIJO_PRUEBA = "Prueba US2-CONF ";

    /** Escenario 2 del AC: exactamente 5 solicitantes simultáneos sobre 1 unidad. */
    private static final int SOLICITANTES_SIMULTANEOS = 5;

    /**
     * El escenario 2 repite la carrera para muestrear interleavings distintos:
     * el AC exige "sin importar el orden de llegada" y una sola carrera muestra
     * un único orden. Cada ronda sigue siendo 5 solicitantes sobre 1 unidad.
     */
    private static final int RONDAS_DE_CARRERA = 20;

    /** Generous window so lock contention is not the failure. */
    private static final long ESPERA_MAXIMA_SEGUNDOS = 60L;

    @Autowired
    private DespacharStockUseCase despacharStockUseCase;

    @Autowired
    private ListarOrganizacionesUseCase listarOrganizacionesUseCase;

    @Autowired
    private ItemInventarioJpaRepository itemInventarioJpaRepository;

    @Autowired
    private PushPortDePrueba pushPortDePrueba;

    private UUID centroId;

    @BeforeEach
    void resolverCentroDePrueba() {
        centroId = centroIdPorNombre("Acopio Suba Norte");
        pushPortDePrueba.limpiar();
    }

    @AfterEach
    void limpiarItemsDePrueba() {
        List<ItemInventarioJpaEntity> aBorrar = itemInventarioJpaRepository.findAll().stream()
                .filter(entidad -> entidad.getNombre().startsWith(PREFIJO_PRUEBA))
                .toList();
        itemInventarioJpaRepository.deleteAll(aBorrar);
        pushPortDePrueba.limpiar();
    }

    // -----------------------------------------------------------------------
    // Escenario 1 — único solicitante obtiene el recurso
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("US2 Escenario 1: un único solicitante sobre 1 unidad confirma la asignación y el inventario queda en 0")
    void escenario1_unicoSolicitanteObtieneElRecurso() throws Exception {
        UUID itemId = sembrarItem(1);
        String token = tokenDe(CIUDADANO, CIUDADANO_PASSWORD);

        mockMvc.perform(despachoDeUnaUnidad(itemId, token))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.id").value(itemId.toString()))
                .andExpect(jsonPath("$.disponible").value(0));

        assertEquals(0, stockDe(itemId),
                "tras confirmar la asignación, el recurso queda en 0 unidades disponibles");
    }

    // -----------------------------------------------------------------------
    // Escenario 2 — múltiples solicitantes compiten por el mismo recurso
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("US2 Escenario 2: 5 solicitantes simultáneos sobre 1 unidad — exactamente 1 éxito, 4 rechazos y stock 0 sin importar el orden")
    void escenario2_multiplesSolicitantesSimultaneosSobreUnaUnidad() throws Exception {
        ExecutorService pool = Executors.newFixedThreadPool(SOLICITANTES_SIMULTANEOS);
        try {
            // Todos deben llegar a la barrera antes de que cualquiera sea
            // liberado: así los cinco corren de verdad dentro del CAS.
            CyclicBarrier largada = new CyclicBarrier(SOLICITANTES_SIMULTANEOS);
            for (int ronda = 0; ronda < RONDAS_DE_CARRERA; ronda++) {
                UUID itemId = sembrarItem(1);
                List<Throwable> resultados = correrCarrera(pool, largada, itemId);

                long exitos = resultados.stream().filter(Objects::isNull).count();
                long rechazos = resultados.stream()
                        .filter(StockInsuficienteException.class::isInstance)
                        .count();

                assertTrue(resultados.stream().allMatch(t -> t == null || t instanceof StockInsuficienteException),
                        "ronda " + ronda + ": solo se admite un éxito o un rechazo por stock insuficiente: "
                                + describir(resultados));
                assertEquals(1, exitos,
                        "ronda " + ronda + ": exactamente 1 solicitante obtiene el recurso");
                assertEquals(SOLICITANTES_SIMULTANEOS - 1, rechazos,
                        "ronda " + ronda + ": los otros 4 solicitantes son rechazados");
                assertEquals(0, stockDe(itemId),
                        "ronda " + ronda + ": el stock termina en 0 sea cual sea el orden de llegada");
            }
        } finally {
            pool.shutdownNow();
        }
    }

    // -----------------------------------------------------------------------
    // Escenario 3 — recurso sin stock disponible
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("US2 Escenario 3: 0 unidades disponibles — la solicitud se rechaza de inmediato con 409 STOCK_INSUFICIENTE")
    void escenario3_recursoSinStockDisponible() throws Exception {
        UUID itemId = sembrarItem(0);
        String token = tokenDe(CIUDADANO, CIUDADANO_PASSWORD);

        // Lo que la API devuelve REALMENTE ante un rechazo. El AC lo redacta
        // como un mensaje de "recurso no disponible"; el endpoint responde el
        // envelope 409 {codigo: STOCK_INSUFICIENTE, mensaje: "No hay unidades
        // suficientes del insumo para atender la solicitud."}. Se asienta el
        // texto real, sin inventar uno equivalente.
        mockMvc.perform(despachoDeUnaUnidad(itemId, token))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.codigo").value("STOCK_INSUFICIENTE"))
                .andExpect(jsonPath("$.mensaje").value(
                        "No hay unidades suficientes del insumo para atender la solicitud."));

        assertEquals(0, stockDe(itemId),
                "un rechazo por stock no debe modificar el inventario");
    }

    // -----------------------------------------------------------------------
    // Helpers
    // -----------------------------------------------------------------------

    /**
     * Dispara un despacho por solicitante ({@value SOLICITANTES_SIMULTANEOS}) y
     * devuelve lo que cada uno lanzó, o {@code null} si el despacho fue
     * confirmado. Todos esperan en la barrera justo antes de entrar al caso de
     * uso: es exactamente la carrera que el CAS debe resistir. La barrera se
     * reinicia sola para la ronda siguiente.
     */
    private List<Throwable> correrCarrera(ExecutorService pool, CyclicBarrier largada, UUID itemId) throws Exception {
        List<Future<Throwable>> futuros = new ArrayList<>();
        for (int i = 0; i < SOLICITANTES_SIMULTANEOS; i++) {
            Callable<Throwable> solicitud = () -> {
                largada.await(ESPERA_MAXIMA_SEGUNDOS, TimeUnit.SECONDS);
                try {
                    despacharStockUseCase.despachar(centroId, itemId, 1);
                    return null;
                } catch (RuntimeException e) {
                    return e;
                }
            };
            futuros.add(pool.submit(solicitud));
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
    }

    /** Seeds an isolated item of this test with the given stock. */
    private UUID sembrarItem(int disponible) {
        UUID itemId = UUID.randomUUID();
        itemInventarioJpaRepository.save(new ItemInventarioJpaEntity(
                itemId,
                centroId,
                PREFIJO_PRUEBA + itemId,
                disponible,
                1,
                null,
                null));
        return itemId;
    }

    /** Fresh read of the item's available stock, straight from the database. */
    private int stockDe(UUID itemId) {
        return itemInventarioJpaRepository.findById(itemId).orElseThrow().getDisponible();
    }

    /** POST del despacho de una unidad de este item, con el token dado. */
    private RequestBuilder despachoDeUnaUnidad(UUID itemId, String token) throws Exception {
        return post("/api/v1/centros-acopio/{id}/inventario/despacho", centroId)
                .header("Authorization", "Bearer " + token)
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(Map.of(
                        "itemId", itemId.toString(),
                        "cantidad", 1)));
    }

    /** Id of a seeded center, resolved through the public use case of usuarios. */
    private UUID centroIdPorNombre(String nombre) {
        return listarOrganizacionesUseCase.listar(TipoOrganizacion.CENTRO_ACOPIO).stream()
                .filter(organizacion -> organizacion.getNombre().equals(nombre))
                .map(Organizacion::getId)
                .findFirst()
                .orElseThrow(() -> new AssertionError("seeded center not found: " + nombre));
    }

    /** Logs in with real credentials and returns the issued token. */
    private String tokenDe(String email, String password) throws Exception {
        MvcResult login = intentarLogin(email, password)
                .andExpect(status().isOk())
                .andReturn();
        return objectMapper.readTree(login.getResponse().getContentAsString()).get("token").asText();
    }

    private static String describir(List<Throwable> resultados) {
        return resultados.stream()
                .map(t -> t == null ? "ok" : t.getClass().getSimpleName() + ": " + t.getMessage())
                .toList()
                .toString();
    }
}
