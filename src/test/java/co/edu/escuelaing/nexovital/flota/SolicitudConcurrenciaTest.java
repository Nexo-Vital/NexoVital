package co.edu.escuelaing.nexovital.flota;

import co.edu.escuelaing.nexovital.flota.domain.enums.EstadoAmbulancia;
import co.edu.escuelaing.nexovital.flota.domain.enums.EstadoSolicitud;
import co.edu.escuelaing.nexovital.flota.domain.exception.AmbulanciaNoDisponibleException;
import co.edu.escuelaing.nexovital.flota.domain.exception.SolicitudNoAsignableException;
import co.edu.escuelaing.nexovital.flota.domain.model.ResultadoAceptarSolicitud;
import co.edu.escuelaing.nexovital.flota.domain.port.in.AceptarSolicitudUseCase;
import co.edu.escuelaing.nexovital.flota.domain.port.in.SolicitarAmbulanciaUseCase;
import co.edu.escuelaing.nexovital.flota.infrastructure.adapter.out.AmbulanciaJpaEntity;
import co.edu.escuelaing.nexovital.flota.infrastructure.adapter.out.AmbulanciaJpaRepository;
import co.edu.escuelaing.nexovital.flota.infrastructure.adapter.out.SolicitudJpaRepository;
import co.edu.escuelaing.nexovital.support.PushPortDePruebaConfig;
import co.edu.escuelaing.nexovital.support.TestClockConfig;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.ActiveProfiles;

import java.util.ArrayList;
import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
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
 * C2 on the accept path: <b>N simultaneous accepts over one broadcast request →
 * exactly one winner, the rest are losers</b> (AC2). At the HTTP layer every
 * loser is a 409; the loser result and the two conflict exceptions the use case
 * may raise are exactly what the controller maps to 409.
 *
 * <p>The guarantee is the database CAS (a single
 * {@code UPDATE ... WHERE estado = PENDIENTE}, see
 * {@link co.edu.escuelaing.nexovital.flota.domain.port.out.SolicitudRepository#transicionAtomicaAsignar}),
 * never an in-memory lock or a client flag. Real threads are released by a
 * {@link CountDownLatch} just before entering the use case: a sequential loop
 * would pass even with concurrency broken, so the race is forced. The race is
 * sampled over several rounds with fresh units.
 */
@SpringBootTest
@ActiveProfiles("test")
@Import({TestClockConfig.class, PushPortDePruebaConfig.class})
class SolicitudConcurrenciaTest {

    /** Rounds to sample distinct interleavings (each round is N over M units). */
    private static final int RONDAS = 8;
    private static final int UNIDADES_POR_RONDA = 3;
    private static final int ACEPTACIONES_POR_RONDA = 12;

    /** Generous window so lock contention is not the failure. */
    private static final long ESPERA_MAXIMA_SEGUNDOS = 60L;

    @Autowired
    private AceptarSolicitudUseCase aceptarSolicitudUseCase;

    @Autowired
    private SolicitarAmbulanciaUseCase solicitarAmbulanciaUseCase;

    @Autowired
    private AmbulanciaJpaRepository ambulanciaJpaRepository;

    @Autowired
    private SolicitudJpaRepository solicitudJpaRepository;

    @Test
    @DisplayName("AC2: 12 accept simultáneos sobre una solicitud → exactamente un ganador; los demás pierden")
    void ac2_unSoloGanadorPorCarrera() throws Exception {
        ExecutorService pool = Executors.newFixedThreadPool(ACEPTACIONES_POR_RONDA);
        try {
            for (int ronda = 0; ronda < RONDAS; ronda++) {
                String zona = "PruebaC2-" + UUID.randomUUID();
                Map<UUID, UUID> unidades = sembrarUnidades(zona, UNIDADES_POR_RONDA);
                UUID solicitudId = solicitarAmbulanciaUseCase
                        .solicitar(UUID.randomUUID(), UUID.randomUUID(), zona, UUID.randomUUID(), null)
                        .getId();

                List<Throwable> resultados = correrCarrera(pool, solicitudId, unidades);

                long ganadores = resultados.stream()
                        .filter(resultado -> resultado instanceof Ganador)
                        .count();
                boolean soloPerdidas = resultados.stream().allMatch(resultado -> resultado == null
                        || resultado instanceof Ganador
                        || resultado instanceof Perdedor
                        || resultado instanceof SolicitudNoAsignableException
                        || resultado instanceof AmbulanciaNoDisponibleException);

                assertEquals(1, ganadores, "ronda " + ronda + ": exactamente un accept gana la carrera");
                assertTrue(soloPerdidas, "ronda " + ronda + ": lo demás solo puede perder: " + describir(resultados));

                assertEquals(co.edu.escuelaing.nexovital.flota.domain.enums.EstadoSolicitud.ASIGNADA,
                        solicitudJpaRepository.findById(solicitudId).orElseThrow().getEstado(),
                        "ronda " + ronda + ": la solicitud queda ASIGNADA");
                assertEquals(1, unidadesEnMision(unidades.keySet()),
                        "ronda " + ronda + ": exactamente una unidad queda ocupada");

                ambulanciaJpaRepository.deleteAllById(unidades.keySet());
            }
        } finally {
            pool.shutdownNow();
        }
    }

    @Test
    @DisplayName("DEBT5: dos solicitudes DISTINTAS sobre la MISMA unidad → una gana; la otra recibe AMBULANCIA_NO_DISPONIBLE")
    void debt5_dosSolicitudesSobreLaMismaUnidad() throws Exception {
        ExecutorService pool = Executors.newFixedThreadPool(2);
        try {
            for (int ronda = 0; ronda < RONDAS; ronda++) {
                String zona = "PruebaUnidad-" + UUID.randomUUID();
                Map<UUID, UUID> unidades = sembrarUnidades(zona, 1);
                UUID unidad = unidades.keySet().iterator().next();
                UUID conductor = unidades.get(unidad);

                // Two DIFFERENT requests in the zone: each one notifies the SAME
                // unit, so each request's own CAS can win. The unit's row is the
                // only thing that can pick a single winner.
                UUID solicitudA = solicitarAmbulanciaUseCase
                        .solicitar(UUID.randomUUID(), UUID.randomUUID(), zona, UUID.randomUUID(), null).getId();
                UUID solicitudB = solicitarAmbulanciaUseCase
                        .solicitar(UUID.randomUUID(), UUID.randomUUID(), zona, UUID.randomUUID(), null).getId();

                CountDownLatch largada = new CountDownLatch(1);
                Future<Throwable> futuroA = pool.submit(aceptarDeLaMismaUnidad(largada, solicitudA, unidad, conductor));
                Future<Throwable> futuroB = pool.submit(aceptarDeLaMismaUnidad(largada, solicitudB, unidad, conductor));
                largada.countDown();

                List<Throwable> resultados = new ArrayList<>();
                resultados.add(obtener(futuroA));
                resultados.add(obtener(futuroB));

                long ganadores = resultados.stream().filter(resultado -> resultado instanceof Ganador).count();
                long conflictos = resultados.stream()
                        .filter(resultado -> resultado instanceof AmbulanciaNoDisponibleException)
                        .count();

                assertEquals(1, ganadores,
                        "ronda " + ronda + ": exactamente una solicitud ocupa la unidad: " + describir(resultados));
                assertEquals(1, conflictos, "ronda " + ronda + ": la perdedora recibe el 409 "
                        + "AMBULANCIA_NO_DISPONIBLE (nunca un 500): " + describir(resultados));

                assertEquals(1, unidadesEnMision(unidades.keySet()),
                        "ronda " + ronda + ": la unidad queda EN_MISION exactamente una vez");

                long asignadas = List.of(solicitudA, solicitudB).stream()
                        .map(id -> solicitudJpaRepository.findById(id).orElseThrow().getEstado())
                        .filter(estado -> estado == EstadoSolicitud.ASIGNADA)
                        .count();
                assertEquals(1, asignadas,
                        "ronda " + ronda + ": solo una solicitud queda ASIGNADA; la otra vuelve a PENDIENTE");

                ambulanciaJpaRepository.deleteAllById(unidades.keySet());
                solicitudJpaRepository.deleteAllById(List.of(solicitudA, solicitudB));
            }
        } finally {
            pool.shutdownNow();
        }
    }

    /**
     * Fires one accept per task, cycling through the units, and returns what
     * each call produced: {@code null} for a plain loss, a {@link Ganador} for
     * the single win, a {@link Perdedor} for a lost CAS, or the conflict the use
     * case raised.
     */
    private List<Throwable> correrCarrera(ExecutorService pool, UUID solicitudId, Map<UUID, UUID> unidades)
            throws Exception {
        CountDownLatch largada = new CountDownLatch(1);
        List<Future<Throwable>> futuros = new ArrayList<>();
        List<UUID> ids = new ArrayList<>(unidades.keySet());
        for (int i = 0; i < ACEPTACIONES_POR_RONDA; i++) {
            UUID unidad = ids.get(i % ids.size());
            UUID conductor = unidades.get(unidad);
            Callable<Throwable> aceptacion = () -> {
                largada.await(ESPERA_MAXIMA_SEGUNDOS, TimeUnit.SECONDS);
                try {
                    ResultadoAceptarSolicitud resultado =
                            aceptarSolicitudUseCase.aceptar(solicitudId, unidad, conductor);
                    return resultado.ganador() ? new Ganador() : new Perdedor();
                } catch (SolicitudNoAsignableException | AmbulanciaNoDisponibleException e) {
                    return e;
                } catch (RuntimeException e) {
                    return e;
                }
            };
            futuros.add(pool.submit(aceptacion));
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
    }

    /** One accept task for the same-unit race: both contenders target one unit. */
    private Callable<Throwable> aceptarDeLaMismaUnidad(CountDownLatch largada, UUID solicitudId,
                                                       UUID unidad, UUID conductor) {
        return () -> {
            largada.await(ESPERA_MAXIMA_SEGUNDOS, TimeUnit.SECONDS);
            try {
                ResultadoAceptarSolicitud resultado =
                        aceptarSolicitudUseCase.aceptar(solicitudId, unidad, conductor);
                return resultado.ganador() ? new Ganador() : new Perdedor();
            } catch (RuntimeException e) {
                return e;
            }
        };
    }

    private static Throwable obtener(Future<Throwable> futuro) throws Exception {
        try {
            return futuro.get(ESPERA_MAXIMA_SEGUNDOS, TimeUnit.SECONDS);
        } catch (ExecutionException e) {
            return e.getCause();
        }
    }

    /**
     * Seeds {@code cantidad} available units in the zone, each linked to its OWN
     * driver. The race passes each unit back together with its driver id, so the
     * accept can prove the caller owns the unit (the ownership check added to the
     * use case) without changing what the race measures: "first accept wins".
     */
    private Map<UUID, UUID> sembrarUnidades(String zona, int cantidad) {
        Map<UUID, UUID> conductorPorUnidad = new LinkedHashMap<>();
        for (int i = 0; i < cantidad; i++) {
            UUID id = UUID.randomUUID();
            UUID conductorId = UUID.randomUUID();
            ambulanciaJpaRepository.save(new AmbulanciaJpaEntity(
                    id, "CON" + i, EstadoAmbulancia.DISPONIBLE,
                    4.73d, -74.08d, zona, conductorId));
            conductorPorUnidad.put(id, conductorId);
        }
        return conductorPorUnidad;
    }

    private long unidadesEnMision(Collection<UUID> unidades) {
        return unidades.stream()
                .map(id -> ambulanciaJpaRepository.findById(id).orElseThrow())
                .filter(entidad -> entidad.getEstado() == EstadoAmbulancia.EN_MISION)
                .count();
    }

    private static String describir(List<Throwable> resultados) {
        return resultados.stream()
                .map(t -> t == null ? "ok" : t.getClass().getSimpleName())
                .toList()
                .toString();
    }

    /** Marker for the single winning accept. */
    private static final class Ganador extends RuntimeException {
    }

    /** Marker for a lost CAS. */
    private static final class Perdedor extends RuntimeException {
    }
}
