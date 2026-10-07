package co.edu.escuelaing.nexovital.flota;

import co.edu.escuelaing.nexovital.flota.application.usecase.FlotaPushListener;
import co.edu.escuelaing.nexovital.flota.application.usecase.FlotaPushListener.PosicionPushPayload;
import co.edu.escuelaing.nexovital.flota.domain.enums.EstadoAmbulancia;
import co.edu.escuelaing.nexovital.flota.domain.enums.FuentePosicion;
import co.edu.escuelaing.nexovital.flota.domain.port.in.DetectarSenalPerdidaUseCase;
import co.edu.escuelaing.nexovital.flota.domain.port.in.ReportarPosicionUseCase;
import co.edu.escuelaing.nexovital.flota.infrastructure.adapter.out.AmbulanciaJpaEntity;
import co.edu.escuelaing.nexovital.flota.infrastructure.adapter.out.AmbulanciaJpaRepository;
import co.edu.escuelaing.nexovital.support.LoginTestBase;
import co.edu.escuelaing.nexovital.support.PushPortDePruebaConfig;
import co.edu.escuelaing.nexovital.support.PushPortDePruebaConfig.PublicacionCapturada;
import co.edu.escuelaing.nexovital.support.PushPortDePruebaConfig.PushPortDePrueba;
import co.edu.escuelaing.nexovital.support.TestClockConfig;
import com.fasterxml.jackson.databind.JsonNode;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MvcResult;

import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * Signal loss of a fleet unit (EP-04.F1.US1, scenarios 3 and 4; design D4, D5
 * and D6; test cases P3 to P7 of the design).
 *
 * <p>The scheduled sweep is disabled by the test profile (one-hour initial
 * delay), so {@link DetectarSenalPerdidaUseCase} is driven directly against the
 * controllable clock: the 30-second threshold is verified by controlled deltas,
 * never by sleeping the suite.
 *
 * <p>Each test seeds its own units and deletes them afterwards, because the
 * test H2 is shared and other fleet tests assert the seeded catalog. The sweep
 * looks at the whole table, so every assertion filters by the unit this test
 * owns: a row another test left behind can never make these pass or fail.
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
@Import({TestClockConfig.class, PushPortDePruebaConfig.class})
class SenalFlotaTest extends LoginTestBase {

    private static final String CIUDADANO = "ciudadano@nexovital.co";
    private static final String CIUDADANO_PASSWORD = "ciudadano123";

    /** The threshold of the story: more than 30 seconds without a report. */
    private static final Duration UMBRAL = Duration.ofSeconds(30);

    /** Concurrent sweeps of P7. */
    private static final int BARRIDOS_SIMULTANEOS = 8;
    /** Rounds to sample distinct interleavings of the report-versus-sweep race. */
    private static final int RONDAS = 12;
    /** Generous window so lock contention is not the failure. */
    private static final long ESPERA_MAXIMA_SEGUNDOS = 60L;

    @Autowired
    private AmbulanciaJpaRepository ambulanciaJpaRepository;

    @Autowired
    private ReportarPosicionUseCase reportarPosicionUseCase;

    @Autowired
    private DetectarSenalPerdidaUseCase detectarSenalPerdidaUseCase;

    @Autowired
    private PushPortDePrueba pushPortDePrueba;

    private final List<UUID> sembradas = new ArrayList<>();

    @BeforeEach
    void limpiarPublicaciones() {
        // LoginTestBase already put the clock back at INSTANTE_BASE.
        pushPortDePrueba.limpiar();
    }

    @AfterEach
    void limpiar() {
        ambulanciaJpaRepository.deleteAllById(sembradas);
        sembradas.clear();
        pushPortDePrueba.limpiar();
        clock.fijar(TestClockConfig.INSTANTE_BASE);
    }

    // -----------------------------------------------------------------------
    // P4 — more than 30 s without a report: "sin señal", keeping the position
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("P4: a los 30 s exactos la unidad aún tiene señal; pasados 31 s queda sin señal con su última posición")
    void p4_pasadosMasDe30SegundosQuedaSinSenal() {
        Unidad unidad = sembrar(EstadoAmbulancia.DISPONIBLE);
        reportar(unidad, 4.7411d, -74.0822d);
        long versionDelReporte = fila(unidad).getVersion();
        pushPortDePrueba.limpiar();

        // Exactly 30 s is NOT "more than 30 seconds": the unit keeps its signal.
        clock.avanzar(UMBRAL);
        detectarSenalPerdidaUseCase.detectar();
        assertFalse(fila(unidad).isSinSenal(), "a los 30 s exactos la unidad todavía tiene señal");
        assertTrue(framesDe(unidad).isEmpty(), "sin marca no se publica nada");

        // One second later it has gone MORE than 30 s without reporting.
        clock.avanzar(Duration.ofSeconds(1));
        int marcadas = detectarSenalPerdidaUseCase.detectar();
        assertTrue(marcadas >= 1, "el barrido debe marcar al menos la unidad vencida");

        AmbulanciaJpaEntity marcada = fila(unidad);
        assertTrue(marcada.isSinSenal(), "pasados 31 s la unidad queda sin señal");
        assertEquals(4.7411d, marcada.getLat(), "conserva la última latitud conocida");
        assertEquals(-74.0822d, marcada.getLng(), "conserva la última longitud conocida");
        assertEquals(TestClockConfig.INSTANTE_BASE, marcada.getUltimaPosicionEn(),
                "el instante del último reporte no cambia al marcarla");
        assertEquals(EstadoAmbulancia.DISPONIBLE, marcada.getEstado(),
                "sin señal es un dato: el estado de la unidad no cambia");
        assertEquals(versionDelReporte + 1, marcada.getVersion(), "la marca sube la versión de la fila");

        List<PosicionPushPayload> frames = framesDe(unidad);
        assertEquals(1, frames.size(), "la pérdida de señal se avisa con exactamente un frame");
        PosicionPushPayload aviso = frames.get(0);
        assertTrue(aviso.sinSenal(), "el frame dice sin señal");
        assertEquals(4.7411d, aviso.ubicacion().lat(), "el frame lleva la última posición conocida");
        assertEquals(-74.0822d, aviso.ubicacion().lng(), "el frame lleva la última posición conocida");
        assertEquals("AVAILABLE", aviso.estado());
        assertNull(aviso.heading(), "el aviso de sin señal no inventa un rumbo");
        assertEquals("device", aviso.source());
        assertEquals(TestClockConfig.INSTANTE_BASE.toString(), aviso.ultimaPosicionEn());
        assertEquals(marcada.getVersion(), aviso.version(),
                "el frame lleva la versión que produjo la marca");

        // The second sweep finds the unit already marked: nothing is published.
        pushPortDePrueba.limpiar();
        detectarSenalPerdidaUseCase.detectar();
        assertTrue(framesDe(unidad).isEmpty(), "un segundo barrido no vuelve a avisar");
        assertEquals(marcada.getVersion(), fila(unidad).getVersion(),
                "un segundo barrido no toca la fila");
    }

    @Test
    @DisplayName("P4: una unidad en misión que pierde la señal sigue en misión")
    void p4_unaUnidadEnMisionConservaSuEstado() {
        Unidad unidad = sembrar(EstadoAmbulancia.EN_MISION);
        reportar(unidad, 4.75d, -74.07d);
        pushPortDePrueba.limpiar();

        clock.avanzar(UMBRAL.plusSeconds(1));
        detectarSenalPerdidaUseCase.detectar();

        AmbulanciaJpaEntity marcada = fila(unidad);
        assertTrue(marcada.isSinSenal());
        assertEquals(EstadoAmbulancia.EN_MISION, marcada.getEstado(),
                "perder la señal no libera ni ocupa la unidad");
        List<PosicionPushPayload> frames = framesDe(unidad);
        assertEquals(1, frames.size());
        assertEquals("ASSIGNED", frames.get(0).estado(), "el frame conserva el estado de la unidad");
    }

    // -----------------------------------------------------------------------
    // P5 — the unit reports again: it has signal again
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("P5: la unidad sin señal vuelve a reportar y recupera la señal, en la fila y en el frame")
    void p5_alVolverAReportarRecuperaLaSenal() {
        Unidad unidad = sembrar(EstadoAmbulancia.DISPONIBLE);
        reportar(unidad, 4.74d, -74.08d);
        clock.avanzar(UMBRAL.plusSeconds(1));
        detectarSenalPerdidaUseCase.detectar();
        long versionSinSenal = fila(unidad).getVersion();
        assertTrue(fila(unidad).isSinSenal(), "precondición: la unidad está sin señal");
        pushPortDePrueba.limpiar();

        Instant instanteDelRegreso = clock.instant();
        reportar(unidad, 4.7433d, -74.0811d);

        AmbulanciaJpaEntity conSenal = fila(unidad);
        assertFalse(conSenal.isSinSenal(), "al reportar la unidad vuelve a tener señal");
        assertEquals(4.7433d, conSenal.getLat());
        assertEquals(instanteDelRegreso, conSenal.getUltimaPosicionEn());
        assertTrue(conSenal.getVersion() > versionSinSenal, "el reporte sube la versión");

        List<PosicionPushPayload> frames = framesDe(unidad);
        assertEquals(1, frames.size(), "el reporte publica un frame");
        assertFalse(frames.get(0).sinSenal(), "el frame del regreso dice que hay señal");
        assertTrue(frames.get(0).version() > versionSinSenal,
                "el frame del regreso lleva una versión mayor que la del aviso de sin señal: "
                        + "si llegaran invertidos, el cliente descarta el aviso viejo (D6)");

        // Nothing is stale any more: the next sweep leaves the unit alone.
        pushPortDePrueba.limpiar();
        detectarSenalPerdidaUseCase.detectar();
        assertFalse(fila(unidad).isSinSenal());
        assertTrue(framesDe(unidad).isEmpty());
    }

    // -----------------------------------------------------------------------
    // P6 — a unit that never reported is not marked
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("P6: una unidad que nunca reportó no se marca sin señal, por más tiempo que pase")
    void p6_unaUnidadQueNuncaReportoNoSeMarca() {
        Unidad unidad = sembrar(EstadoAmbulancia.DISPONIBLE);

        clock.avanzar(Duration.ofHours(1));
        detectarSenalPerdidaUseCase.detectar();

        AmbulanciaJpaEntity intacta = fila(unidad);
        assertFalse(intacta.isSinSenal(), "sin señal significa que la tenía y la perdió");
        assertNull(intacta.getUltimaPosicionEn());
        assertEquals(0L, intacta.getVersion(), "el barrido no toca la fila");
        assertTrue(framesDe(unidad).isEmpty(), "no se publica nada sobre una unidad que nunca reportó");
    }

    // -----------------------------------------------------------------------
    // P3 — a client that arrives late reads the last state over REST
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("P3: quien se conecta tarde ve por REST la última posición de cada unidad, su instante, su versión y si está sin señal")
    void p3_elClienteTardioVeElUltimoEstadoPorRest() throws Exception {
        Unidad primera = sembrar(EstadoAmbulancia.DISPONIBLE);
        Unidad segunda = sembrar(EstadoAmbulancia.DISPONIBLE);
        Unidad tercera = sembrar(EstadoAmbulancia.EN_MISION);

        // The first unit reports and then goes silent.
        reportar(primera, 4.7011d, -74.0111d);

        // 31 s later the other two report; the first one is marked.
        clock.avanzar(UMBRAL.plusSeconds(1));
        Instant instanteReciente = clock.instant();
        reportar(segunda, 4.7022d, -74.0222d);
        reportar(tercera, 4.7033d, -74.0333d);
        // A unit reports several times: only the LAST position must be visible.
        reportar(tercera, 4.7044d, -74.0444d);
        detectarSenalPerdidaUseCase.detectar();

        // Nobody was listening: the late client has only the REST snapshot.
        String token = tokenDe(CIUDADANO, CIUDADANO_PASSWORD);
        MvcResult respuesta = mockMvc.perform(get("/api/v1/flota/ambulancias")
                        .header("Authorization", "Bearer " + token))
                .andExpect(status().isOk())
                .andReturn();
        JsonNode flota = objectMapper.readTree(respuesta.getResponse().getContentAsString());

        JsonNode dtoPrimera = unidadEn(flota, primera);
        assertEquals(4.7011d, dtoPrimera.get("ubicacion").get("lat").asDouble());
        assertEquals(-74.0111d, dtoPrimera.get("ubicacion").get("lng").asDouble());
        assertTrue(dtoPrimera.get("sinSenal").asBoolean(),
                "el cliente tardío también ve que la unidad está sin señal");
        assertEquals(TestClockConfig.INSTANTE_BASE,
                Instant.parse(dtoPrimera.get("ultimaPosicionEn").asText()));
        assertEquals(fila(primera).getVersion(), dtoPrimera.get("version").asLong());

        JsonNode dtoSegunda = unidadEn(flota, segunda);
        assertEquals(4.7022d, dtoSegunda.get("ubicacion").get("lat").asDouble());
        assertFalse(dtoSegunda.get("sinSenal").asBoolean());
        assertEquals(instanteReciente, Instant.parse(dtoSegunda.get("ultimaPosicionEn").asText()));
        assertEquals(fila(segunda).getVersion(), dtoSegunda.get("version").asLong());

        JsonNode dtoTercera = unidadEn(flota, tercera);
        assertEquals(4.7044d, dtoTercera.get("ubicacion").get("lat").asDouble(),
                "se ve la ÚLTIMA posición reportada, no una anterior");
        assertEquals(-74.0444d, dtoTercera.get("ubicacion").get("lng").asDouble());
        assertEquals("EN_MISION", dtoTercera.get("estado").asText());
        assertFalse(dtoTercera.get("sinSenal").asBoolean());
        assertEquals(2L, dtoTercera.get("version").asLong(), "dos reportes, versión 2");
        // The driver id is never part of the fleet read.
        assertFalse(dtoTercera.has("conductorId"));
    }

    // -----------------------------------------------------------------------
    // P7 — concurrent sweeps publish the notice exactly once
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("P7: 8 barridos simultáneos sobre la misma unidad vencida publican exactamente un aviso de sin señal")
    void p7_barridosSimultaneosAvisanUnaSolaVez() throws Exception {
        Unidad unidad = sembrar(EstadoAmbulancia.DISPONIBLE);
        reportar(unidad, 4.71d, -74.03d);
        long versionDelReporte = fila(unidad).getVersion();
        clock.avanzar(UMBRAL.plusSeconds(1));
        pushPortDePrueba.limpiar();

        ExecutorService pool = Executors.newFixedThreadPool(BARRIDOS_SIMULTANEOS);
        try {
            CountDownLatch largada = new CountDownLatch(1);
            List<Future<Throwable>> futuros = new ArrayList<>();
            for (int i = 0; i < BARRIDOS_SIMULTANEOS; i++) {
                futuros.add(pool.submit(tarea(largada, () -> detectarSenalPerdidaUseCase.detectar())));
            }
            largada.countDown();
            List<Throwable> errores = recoger(futuros);

            assertTrue(errores.isEmpty(), "ningún barrido debe fallar: " + errores);
        } finally {
            pool.shutdownNow();
        }

        AmbulanciaJpaEntity marcada = fila(unidad);
        assertTrue(marcada.isSinSenal(), "la unidad queda sin señal");
        assertEquals(versionDelReporte + 1, marcada.getVersion(),
                "solo UN barrido escribió la fila: la versión subió una vez");

        List<PosicionPushPayload> frames = framesDe(unidad);
        assertEquals(1, frames.size(),
                "ocho barridos simultáneos publican exactamente un aviso, no ocho");
        assertTrue(frames.get(0).sinSenal());
        assertEquals(marcada.getVersion(), frames.get(0).version());
    }

    // -----------------------------------------------------------------------
    // D5 — a report racing with the sweep: the unit always ends with signal
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("Carrera reporte contra barrido: gane quien gane, la unidad termina con señal y el frame más nuevo lo dice")
    void carrera_reporteContraBarridoTerminaConSenal() throws Exception {
        Unidad unidad = sembrar(EstadoAmbulancia.DISPONIBLE);
        reportar(unidad, 4.72d, -74.04d);

        ExecutorService pool = Executors.newFixedThreadPool(2);
        try {
            for (int ronda = 0; ronda < RONDAS; ronda++) {
                // The last report is now older than the threshold: the unit is a
                // candidate for the sweep at the very moment it reports again.
                clock.avanzar(UMBRAL.plusSeconds(1));
                Instant instanteDeLaRonda = clock.instant();
                double lat = 4.72d + (ronda + 1) * 0.001d;
                pushPortDePrueba.limpiar();

                CountDownLatch largada = new CountDownLatch(1);
                List<Future<Throwable>> futuros = new ArrayList<>();
                futuros.add(pool.submit(tarea(largada, () -> detectarSenalPerdidaUseCase.detectar())));
                futuros.add(pool.submit(tarea(largada, () -> reportar(unidad, lat, -74.04d))));
                largada.countDown();
                List<Throwable> errores = recoger(futuros);
                assertTrue(errores.isEmpty(), "ronda " + ronda + ": ninguna de las dos escrituras falla: " + errores);

                // If the report won, the sweep found nothing to mark. If the
                // sweep won, the report cleared the mark right after. Either way:
                AmbulanciaJpaEntity actual = fila(unidad);
                assertFalse(actual.isSinSenal(), "ronda " + ronda + ": la unidad termina con señal");
                assertEquals(lat, actual.getLat(), "ronda " + ronda + ": con la posición recién reportada");
                assertEquals(instanteDeLaRonda, actual.getUltimaPosicionEn());

                // What a client ends up painting is the frame with the highest
                // version (D6). It must be the report, never the stale notice.
                List<PosicionPushPayload> frames = framesDe(unidad);
                assertFalse(frames.isEmpty(), "ronda " + ronda + ": el reporte siempre publica su frame");
                assertTrue(frames.size() <= 2, "ronda " + ronda + ": a lo sumo el aviso y el reporte");
                PosicionPushPayload masNuevo = frames.stream()
                        .max(Comparator.comparingLong(PosicionPushPayload::version))
                        .orElseThrow();
                assertFalse(masNuevo.sinSenal(),
                        "ronda " + ronda + ": el frame de mayor versión dice que hay señal");
                assertEquals(lat, masNuevo.ubicacion().lat());
                assertEquals(actual.getVersion(), masNuevo.version(),
                        "ronda " + ronda + ": y su versión es la de la fila");
                if (frames.size() == 2) {
                    PosicionPushPayload masViejo = frames.stream()
                            .min(Comparator.comparingLong(PosicionPushPayload::version))
                            .orElseThrow();
                    assertTrue(masViejo.sinSenal(), "ronda " + ronda + ": el otro frame es el aviso de sin señal");
                    assertTrue(masViejo.version() < masNuevo.version(),
                            "ronda " + ronda + ": las versiones nunca empatan entre dos escrituras");
                }
            }
        } finally {
            pool.shutdownNow();
        }
    }

    // -----------------------------------------------------------------------
    // Helpers
    // -----------------------------------------------------------------------

    /** A seeded unit and the driver that owns it. */
    private record Unidad(UUID id, UUID conductorId) {
    }

    private Unidad sembrar(EstadoAmbulancia estado) {
        UUID id = UUID.randomUUID();
        UUID conductorId = UUID.randomUUID();
        ambulanciaJpaRepository.save(new AmbulanciaJpaEntity(
                id, placaUnica(), estado, 4.70d, -74.00d, "Senal-" + id, conductorId));
        sembradas.add(id);
        return new Unidad(id, conductorId);
    }

    /** The plate column is unique: every seeded unit gets its own. */
    private static String placaUnica() {
        return "SNL" + UUID.randomUUID().toString().substring(0, 8);
    }

    /** A report from the unit's own driver, through the same use case the route uses. */
    private void reportar(Unidad unidad, double lat, double lng) {
        reportarPosicionUseCase.reportarPosicion(
                unidad.id(), unidad.conductorId(), lat, lng, 90, FuentePosicion.DEVICE);
    }

    /** Persisted row of the unit, read in a fresh JPA session. */
    private AmbulanciaJpaEntity fila(Unidad unidad) {
        return ambulanciaJpaRepository.findById(unidad.id()).orElseThrow();
    }

    /** Position frames published on {@code /topic/flota} for THIS unit, in order. */
    private List<PosicionPushPayload> framesDe(Unidad unidad) {
        List<PosicionPushPayload> frames = new ArrayList<>();
        for (PublicacionCapturada publicacion : pushPortDePrueba.publicaciones()) {
            if (FlotaPushListener.DESTINO_FLOTA.equals(publicacion.destino())
                    && publicacion.payload() instanceof PosicionPushPayload payload
                    && unidad.id().equals(payload.ambulanceId())) {
                frames.add(payload);
            }
        }
        return frames;
    }

    private static JsonNode unidadEn(JsonNode flota, Unidad unidad) {
        for (JsonNode dto : flota) {
            if (unidad.id().toString().equals(dto.get("id").asText())) {
                return dto;
            }
        }
        throw new AssertionError("la flota no incluye la unidad " + unidad.id());
    }

    /**
     * Wraps an action so every contender waits for the same start signal: a
     * sequential loop would pass even with concurrency broken, so the race is
     * forced. Returns the failure, or {@code null} when the action completed.
     */
    private static Callable<Throwable> tarea(CountDownLatch largada, Runnable accion) {
        return () -> {
            largada.await(ESPERA_MAXIMA_SEGUNDOS, TimeUnit.SECONDS);
            try {
                accion.run();
                return null;
            } catch (RuntimeException e) {
                return e;
            }
        };
    }

    /** Waits for every contender and returns only the failures. */
    private static List<Throwable> recoger(List<Future<Throwable>> futuros) throws Exception {
        List<Throwable> errores = new ArrayList<>();
        for (Future<Throwable> futuro : futuros) {
            try {
                Throwable error = futuro.get(ESPERA_MAXIMA_SEGUNDOS, TimeUnit.SECONDS);
                if (error != null) {
                    errores.add(error);
                }
            } catch (ExecutionException e) {
                errores.add(e.getCause());
            }
        }
        return errores;
    }

    private String tokenDe(String email, String password) throws Exception {
        MvcResult login = intentarLogin(email, password)
                .andExpect(status().isOk())
                .andReturn();
        return objectMapper.readTree(login.getResponse().getContentAsString()).get("token").asText();
    }
}
