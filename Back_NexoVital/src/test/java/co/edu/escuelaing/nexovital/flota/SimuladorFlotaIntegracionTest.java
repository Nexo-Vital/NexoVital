package co.edu.escuelaing.nexovital.flota;

import co.edu.escuelaing.nexovital.flota.application.usecase.FlotaPushListener;
import co.edu.escuelaing.nexovital.flota.application.usecase.FlotaPushListener.PosicionPushPayload;
import co.edu.escuelaing.nexovital.flota.domain.enums.EstadoAmbulancia;
import co.edu.escuelaing.nexovital.flota.domain.enums.FuentePosicion;
import co.edu.escuelaing.nexovital.flota.domain.model.Ambulancia;
import co.edu.escuelaing.nexovital.flota.domain.port.in.ReportarPosicionUseCase;
import co.edu.escuelaing.nexovital.flota.domain.port.out.FlotaQueryPort;
import co.edu.escuelaing.nexovital.flota.infrastructure.adapter.in.FlotaSimulationScheduler;
import co.edu.escuelaing.nexovital.flota.infrastructure.adapter.out.AmbulanciaJpaEntity;
import co.edu.escuelaing.nexovital.flota.infrastructure.adapter.out.AmbulanciaJpaRepository;
import co.edu.escuelaing.nexovital.support.MutableClock;
import co.edu.escuelaing.nexovital.support.PushPortDePruebaConfig;
import co.edu.escuelaing.nexovital.support.PushPortDePruebaConfig.PublicacionCapturada;
import co.edu.escuelaing.nexovital.support.PushPortDePruebaConfig.PushPortDePrueba;
import co.edu.escuelaing.nexovital.support.TestClockConfig;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.ActiveProfiles;

import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.stream.Collectors;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * The fleet simulator against the REAL database and the REAL use case
 * (EP-04.F1.US1, scenario 1; design D2 and D3; test cases P8 and P9).
 *
 * <p>{@code SimulacionFlotaTest} proves with mocks WHICH units the simulator
 * picks. This class proves what ends up in the table and on
 * {@code /topic/flota}: the continuous position every 5 seconds, and the rule
 * "the device wins over the simulator" as the database enforces it, including
 * the race where both write at the same moment.
 *
 * <p>The test profile turns the simulator bean off, so the scheduler is built
 * by hand over the real {@link ReportarPosicionUseCase} and a view of the real
 * fleet read that only returns the units this test seeded. That keeps the
 * shared seeded catalog untouched: other fleet tests assert its positions.
 */
@SpringBootTest
@ActiveProfiles("test")
@Import({TestClockConfig.class, PushPortDePruebaConfig.class})
class SimuladorFlotaIntegracionTest {

    /** Position interval of the story: one report every 5 seconds. */
    private static final Duration INTERVALO = Duration.ofSeconds(5);
    /** The simulator moves a unit about 0.0003 degrees per step. */
    private static final double PASO_MAXIMO_GRADOS = 0.001d;

    /** Rounds to sample distinct interleavings of the device-versus-simulator race. */
    private static final int RONDAS = 15;
    /** Generous window so lock contention is not the failure. */
    private static final long ESPERA_MAXIMA_SEGUNDOS = 60L;

    @Autowired
    private AmbulanciaJpaRepository ambulanciaJpaRepository;

    @Autowired
    private ReportarPosicionUseCase reportarPosicionUseCase;

    @Autowired
    private FlotaQueryPort flotaQueryPort;

    @Autowired
    private PushPortDePrueba pushPortDePrueba;

    @Autowired
    private MutableClock clock;

    private final List<UUID> sembradas = new ArrayList<>();
    private FlotaSimulationScheduler simulador;

    @BeforeEach
    void preparar() {
        clock.fijar(TestClockConfig.INSTANTE_BASE);
        pushPortDePrueba.limpiar();
        simulador = new FlotaSimulationScheduler(soloLasSembradas(), reportarPosicionUseCase);
    }

    @AfterEach
    void limpiar() {
        ambulanciaJpaRepository.deleteAllById(sembradas);
        sembradas.clear();
        pushPortDePrueba.limpiar();
        clock.fijar(TestClockConfig.INSTANTE_BASE);
    }

    // -----------------------------------------------------------------------
    // Scenario 1 — a continuous position every 5 seconds
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("Escenario 1: cada ciclo de 5 s el simulador guarda una posición nueva y publica un frame con versión creciente")
    void escenario1_posicionContinuaCadaCincoSegundos() {
        Unidad unidad = sembrar(EstadoAmbulancia.DISPONIBLE, UUID.randomUUID());

        double latAnterior = 4.70d;
        double lngAnterior = -74.00d;
        for (int ciclo = 1; ciclo <= 3; ciclo++) {
            clock.avanzar(INTERVALO);
            Instant instanteDelCiclo = clock.instant();
            pushPortDePrueba.limpiar();

            simulador.simularMovimiento();

            AmbulanciaJpaEntity fila = fila(unidad);
            assertTrue(fila.getLat() != latAnterior || fila.getLng() != lngAnterior,
                    "ciclo " + ciclo + ": la posición guardada cambió");
            assertTrue(Math.abs(fila.getLat() - latAnterior) <= PASO_MAXIMO_GRADOS
                            && Math.abs(fila.getLng() - lngAnterior) <= PASO_MAXIMO_GRADOS,
                    "ciclo " + ciclo + ": es un paso corto, no un salto");
            assertEquals(FuentePosicion.SIMULADA, fila.getFuentePosicion());
            assertEquals(instanteDelCiclo, fila.getUltimaPosicionEn(),
                    "ciclo " + ciclo + ": el instante del reporte avanza 5 s por ciclo");
            assertFalse(fila.isSinSenal());
            assertEquals((long) ciclo, fila.getVersion(), "ciclo " + ciclo + ": una escritura por ciclo");
            assertEquals(EstadoAmbulancia.DISPONIBLE, fila.getEstado(), "la posición no cambia el estado");

            List<PosicionPushPayload> frames = framesDe(unidad);
            assertEquals(1, frames.size(), "ciclo " + ciclo + ": un frame por ciclo");
            PosicionPushPayload frame = frames.get(0);
            assertEquals(fila.getLat(), frame.ubicacion().lat(), "el frame lleva lo que se guardó");
            assertEquals(fila.getLng(), frame.ubicacion().lng(), "el frame lleva lo que se guardó");
            assertEquals("simulated", frame.source());
            assertEquals("AVAILABLE", frame.estado());
            assertFalse(frame.sinSenal());
            assertEquals(instanteDelCiclo.toString(), frame.ultimaPosicionEn());
            assertEquals(fila.getVersion(), frame.version(),
                    "ciclo " + ciclo + ": la versión del frame es la de la fila");

            latAnterior = fila.getLat();
            lngAnterior = fila.getLng();
        }
    }

    // -----------------------------------------------------------------------
    // P9 — which units the simulator moves
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("P9: mueve la unidad disponible y la que está en misión; omite mantenimiento y la que no tiene conductor")
    void p9_mueveLasActivasYOmiteElResto() {
        Unidad disponible = sembrar(EstadoAmbulancia.DISPONIBLE, UUID.randomUUID());
        Unidad enMision = sembrar(EstadoAmbulancia.EN_MISION, UUID.randomUUID());
        Unidad enMantenimiento = sembrar(EstadoAmbulancia.MANTENIMIENTO, UUID.randomUUID());
        Unidad sinConductor = sembrar(EstadoAmbulancia.DISPONIBLE, null);

        simulador.simularMovimiento();

        for (Unidad movida : List.of(disponible, enMision)) {
            AmbulanciaJpaEntity fila = fila(movida);
            assertTrue(fila.getLat() != 4.70d || fila.getLng() != -74.00d, "la unidad activa se movió");
            assertEquals(FuentePosicion.SIMULADA, fila.getFuentePosicion());
            assertEquals(1L, fila.getVersion());
            assertEquals(1, framesDe(movida).size(), "y se publicó su frame");
        }
        assertEquals(EstadoAmbulancia.EN_MISION, fila(enMision).getEstado(),
                "una unidad en misión se mueve y sigue en misión");
        assertEquals("ASSIGNED", framesDe(enMision).get(0).estado());

        for (Unidad quieta : List.of(enMantenimiento, sinConductor)) {
            AmbulanciaJpaEntity fila = fila(quieta);
            assertEquals(4.70d, fila.getLat(), "la unidad no activa no se mueve");
            assertEquals(-74.00d, fila.getLng(), "la unidad no activa no se mueve");
            assertNull(fila.getUltimaPosicionEn(), "nunca reportó");
            assertNull(fila.getFuentePosicion());
            assertEquals(0L, fila.getVersion());
            assertTrue(framesDe(quieta).isEmpty(), "y no se publica nada sobre ella");
        }
    }

    // -----------------------------------------------------------------------
    // P8 — the device wins over the simulator (D3)
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("P8: el simulador no mueve una unidad que reporta un dispositivo: 0 filas y ningún frame")
    void p8_elSimuladorNoMueveUnaUnidadDeDispositivo() {
        Unidad unidad = sembrar(EstadoAmbulancia.DISPONIBLE, UUID.randomUUID());

        // The simulator moves it first: nobody has claimed it yet.
        simulador.simularMovimiento();
        assertEquals(FuentePosicion.SIMULADA, fila(unidad).getFuentePosicion());

        // The driver connects and reports: the unit is now the device's.
        clock.avanzar(INTERVALO);
        Instant instanteDelDispositivo = clock.instant();
        reportarPosicionUseCase.reportarPosicion(
                unidad.id(), unidad.conductorId(), 4.7412d, -74.0834d, 180, FuentePosicion.DEVICE);
        AmbulanciaJpaEntity delDispositivo = fila(unidad);
        assertEquals(FuentePosicion.DEVICE, delDispositivo.getFuentePosicion());
        long versionDelDispositivo = delDispositivo.getVersion();
        pushPortDePrueba.limpiar();

        // Several simulator cycles later the real position is still there.
        for (int ciclo = 0; ciclo < 3; ciclo++) {
            clock.avanzar(INTERVALO);
            simulador.simularMovimiento();
        }
        assertFilaDelDispositivo(unidad, instanteDelDispositivo, versionDelDispositivo);
        assertTrue(framesDe(unidad).isEmpty(), "el simulador no publica nada sobre una unidad de dispositivo");

        // Same result when the simulated write reaches the database directly,
        // skipping the in-memory filter of the scheduler: this is the case where
        // the device reported between the simulator's read and its write. The
        // conditional UPDATE affects 0 rows.
        Ambulancia devuelta = reportarPosicionUseCase.reportarPosicion(
                unidad.id(), unidad.conductorId(), 4.9999d, -73.9999d, 10, FuentePosicion.SIMULADA);
        assertNotEquals(4.9999d, devuelta.getLat(), "la respuesta no finge que la unidad se movió");
        assertFilaDelDispositivo(unidad, instanteDelDispositivo, versionDelDispositivo);
        assertTrue(framesDe(unidad).isEmpty(), "0 filas escritas, 0 frames publicados");
    }

    @Test
    @DisplayName("P8 en carrera: dispositivo y simulador escriben a la vez y la unidad SIEMPRE termina en la posición del dispositivo")
    void p8_carreraDispositivoContraSimulador() throws Exception {
        ExecutorService pool = Executors.newFixedThreadPool(2);
        try {
            for (int ronda = 0; ronda < RONDAS; ronda++) {
                // A fresh unit nobody has claimed: both writes can apply, so the
                // order they commit in is what the race decides.
                Unidad unidad = sembrar(EstadoAmbulancia.DISPONIBLE, UUID.randomUUID());
                double latDispositivo = 4.80d + ronda * 0.001d;
                pushPortDePrueba.limpiar();

                CountDownLatch largada = new CountDownLatch(1);
                List<Future<Throwable>> futuros = new ArrayList<>();
                futuros.add(pool.submit(tarea(largada, () -> reportarPosicionUseCase.reportarPosicion(
                        unidad.id(), unidad.conductorId(), latDispositivo, -74.10d, 90,
                        FuentePosicion.DEVICE))));
                futuros.add(pool.submit(tarea(largada, () -> reportarPosicionUseCase.reportarPosicion(
                        unidad.id(), unidad.conductorId(), 4.60d, -74.20d, 270,
                        FuentePosicion.SIMULADA))));
                largada.countDown();
                List<Throwable> errores = recoger(futuros);
                assertTrue(errores.isEmpty(), "ronda " + ronda + ": ninguna escritura falla: " + errores);

                // Simulator first: the device overwrites it. Device first: the
                // simulator's conditional UPDATE affects 0 rows. Either way:
                AmbulanciaJpaEntity fila = fila(unidad);
                assertEquals(FuentePosicion.DEVICE, fila.getFuentePosicion(),
                        "ronda " + ronda + ": la unidad queda en manos del dispositivo");
                assertEquals(latDispositivo, fila.getLat(),
                        "ronda " + ronda + ": con la posición real, nunca la simulada");
                assertEquals(-74.10d, fila.getLng(), "ronda " + ronda);

                // What a client ends up painting is the frame with the highest
                // version (D6): it must be the device's.
                List<PosicionPushPayload> frames = framesDe(unidad);
                assertFalse(frames.isEmpty(), "ronda " + ronda + ": el dispositivo siempre publica");
                assertEquals(fila.getVersion(), (long) frames.size(),
                        "ronda " + ronda + ": un frame por cada escritura que sí se aplicó");
                PosicionPushPayload masNuevo = frames.stream()
                        .max(Comparator.comparingLong(PosicionPushPayload::version))
                        .orElseThrow();
                assertEquals("device", masNuevo.source(),
                        "ronda " + ronda + ": el frame de mayor versión es el del dispositivo");
                assertEquals(latDispositivo, masNuevo.ubicacion().lat(), "ronda " + ronda);
                assertEquals(fila.getVersion(), masNuevo.version(), "ronda " + ronda);
                Set<Long> versiones = frames.stream()
                        .map(PosicionPushPayload::version)
                        .collect(Collectors.toSet());
                assertEquals(frames.size(), versiones.size(),
                        "ronda " + ronda + ": dos escrituras nunca comparten versión");
            }
        } finally {
            pool.shutdownNow();
        }
    }

    // -----------------------------------------------------------------------
    // Helpers
    // -----------------------------------------------------------------------

    /** A seeded unit and the driver that owns it ({@code null} when it has none). */
    private record Unidad(UUID id, UUID conductorId) {
    }

    private Unidad sembrar(EstadoAmbulancia estado, UUID conductorId) {
        UUID id = UUID.randomUUID();
        ambulanciaJpaRepository.save(new AmbulanciaJpaEntity(
                id, "SIM" + id.toString().substring(0, 8), estado,
                4.70d, -74.00d, "Simulador-" + id, conductorId));
        sembradas.add(id);
        return new Unidad(id, conductorId);
    }

    /**
     * The real fleet read, narrowed to the units this test seeded: the simulator
     * under test then cannot move the shared seeded catalog.
     */
    private FlotaQueryPort soloLasSembradas() {
        return new FlotaQueryPort() {
            @Override
            public List<Ambulancia> consultarFlota() {
                return flotaQueryPort.consultarFlota().stream()
                        .filter(unidad -> sembradas.contains(unidad.getId()))
                        .toList();
            }

            @Override
            public Optional<Ambulancia> buscarPorConductor(UUID conductorId) {
                return flotaQueryPort.buscarPorConductor(conductorId);
            }
        };
    }

    /** Persisted row of the unit, read in a fresh JPA session. */
    private AmbulanciaJpaEntity fila(Unidad unidad) {
        return ambulanciaJpaRepository.findById(unidad.id()).orElseThrow();
    }

    private void assertFilaDelDispositivo(Unidad unidad, Instant instante, long version) {
        AmbulanciaJpaEntity fila = fila(unidad);
        assertEquals(4.7412d, fila.getLat(), "la posición real sigue ahí");
        assertEquals(-74.0834d, fila.getLng(), "la posición real sigue ahí");
        assertEquals(FuentePosicion.DEVICE, fila.getFuentePosicion());
        assertEquals(instante, fila.getUltimaPosicionEn(),
                "el simulador no refresca el latido de una unidad de dispositivo");
        assertEquals(version, fila.getVersion(), "la fila no se volvió a escribir");
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

    /**
     * Wraps an action so both contenders wait for the same start signal: a
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

    /** Waits for both contenders and returns only the failures. */
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
}
