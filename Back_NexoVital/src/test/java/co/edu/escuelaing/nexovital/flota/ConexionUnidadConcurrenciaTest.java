package co.edu.escuelaing.nexovital.flota;

import co.edu.escuelaing.nexovital.flota.domain.enums.EstadoAmbulancia;
import co.edu.escuelaing.nexovital.flota.domain.enums.EstadoSolicitud;
import co.edu.escuelaing.nexovital.flota.domain.exception.AmbulanciaNoDisponibleException;
import co.edu.escuelaing.nexovital.flota.domain.exception.SolicitudEnCursoException;
import co.edu.escuelaing.nexovital.flota.domain.model.ResultadoAceptarSolicitud;
import co.edu.escuelaing.nexovital.flota.domain.model.SolicitudAmbulancia;
import co.edu.escuelaing.nexovital.flota.domain.port.in.AceptarSolicitudUseCase;
import co.edu.escuelaing.nexovital.flota.domain.port.in.DeclararDisponibilidadUseCase;
import co.edu.escuelaing.nexovital.flota.domain.port.in.GestionarConexionUnidadUseCase;
import co.edu.escuelaing.nexovital.flota.domain.port.in.SolicitarAmbulanciaUseCase;
import co.edu.escuelaing.nexovital.flota.infrastructure.adapter.out.AmbulanciaJpaEntity;
import co.edu.escuelaing.nexovital.flota.infrastructure.adapter.out.AmbulanciaJpaRepository;
import co.edu.escuelaing.nexovital.flota.infrastructure.adapter.out.SolicitudJpaEntity;
import co.edu.escuelaing.nexovital.flota.infrastructure.adapter.out.SolicitudJpaRepository;
import co.edu.escuelaing.nexovital.support.PushPortDePruebaConfig;
import co.edu.escuelaing.nexovital.support.TestClockConfig;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;

import java.util.ArrayList;
import java.util.HashSet;
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

/**
 * EP-04.F2.US1 — the races of the connection (design scenarios S13 and S14)
 * and of the late offer.
 *
 * <p>Nothing here is decided in memory: every guarantee is a conditional or
 * versioned write in the database. Real threads are released together by a
 * {@link CountDownLatch} right before they enter the use case, because a
 * sequential loop would pass even with the concurrency broken. Each race is
 * sampled over several rounds with fresh units.
 */
@SpringBootTest
@ActiveProfiles("test")
@Import({TestClockConfig.class, PushPortDePruebaConfig.class})
class ConexionUnidadConcurrenciaTest {

    private static final int RONDAS = 12;

    /** Generous window so lock contention is not the failure. */
    private static final long ESPERA_MAXIMA_SEGUNDOS = 60L;

    @Autowired
    private AceptarSolicitudUseCase aceptarSolicitudUseCase;

    @Autowired
    private SolicitarAmbulanciaUseCase solicitarAmbulanciaUseCase;

    @Autowired
    private GestionarConexionUnidadUseCase gestionarConexionUnidadUseCase;

    @Autowired
    private DeclararDisponibilidadUseCase declararDisponibilidadUseCase;

    @Autowired
    private AmbulanciaJpaRepository ambulanciaJpaRepository;

    @Autowired
    private SolicitudJpaRepository solicitudJpaRepository;

    @Autowired
    private JdbcTemplate jdbcTemplate;

    @Test
    @DisplayName("S13: aceptar y desconectar a la vez → gana exactamente uno; nunca una unidad en misión y desconectada")
    void s13_aceptarContraDesconectar() throws Exception {
        ExecutorService pool = Executors.newFixedThreadPool(2);
        try {
            for (int ronda = 0; ronda < RONDAS; ronda++) {
                UUID conductor = UUID.randomUUID();
                UUID unidad = sembrarUnidad(EstadoAmbulancia.DISPONIBLE, conductor);
                UUID solicitudId = solicitar().getId();

                CountDownLatch largada = new CountDownLatch(1);
                Future<Object> aceptacion = pool.submit(alDarLaLargada(largada,
                        () -> aceptarSolicitudUseCase.aceptar(solicitudId, unidad, conductor)));
                Future<Object> desconexion = pool.submit(alDarLaLargada(largada,
                        () -> gestionarConexionUnidadUseCase.desconectar(conductor)));
                largada.countDown();
                Object resultadoAceptar = obtener(aceptacion);
                Object resultadoDesconectar = obtener(desconexion);

                AmbulanciaJpaEntity unidadFinal = ambulanciaJpaRepository.findById(unidad).orElseThrow();
                EstadoSolicitud estadoSolicitud =
                        solicitudJpaRepository.findById(solicitudId).orElseThrow().getEstado();
                String detalle = "ronda " + ronda + ": aceptar=" + describir(resultadoAceptar)
                        + ", desconectar=" + describir(resultadoDesconectar);

                assertFalse(unidadFinal.getEstado() == EstadoAmbulancia.EN_MISION && !unidadFinal.isConectada(),
                        "nunca una unidad en misión y desconectada. " + detalle);

                boolean ganoAceptar = resultadoAceptar instanceof ResultadoAceptarSolicitud resultado
                        && resultado.ganador();
                if (ganoAceptar) {
                    // The accept occupied the unit: the disconnection was refused.
                    assertEquals(EstadoAmbulancia.EN_MISION, unidadFinal.getEstado(), detalle);
                    assertTrue(unidadFinal.isConectada(), detalle);
                    assertEquals(EstadoSolicitud.ASIGNADA, estadoSolicitud, detalle);
                    assertTrue(resultadoDesconectar instanceof SolicitudEnCursoException,
                            "la desconexión que pierde recibe SOLICITUD_EN_CURSO. " + detalle);
                } else {
                    // The disconnection applied first: the accept found the unit
                    // unavailable and left the request open, with nothing occupied.
                    assertTrue(resultadoAceptar instanceof AmbulanciaNoDisponibleException,
                            "el accept que pierde recibe AMBULANCIA_NO_DISPONIBLE, nunca un 500. " + detalle);
                    assertEquals(EstadoAmbulancia.DISPONIBLE, unidadFinal.getEstado(), detalle);
                    assertFalse(unidadFinal.isConectada(), detalle);
                    assertEquals(EstadoSolicitud.PENDIENTE, estadoSolicitud, detalle);
                }

                solicitudJpaRepository.deleteById(solicitudId);
                ambulanciaJpaRepository.deleteById(unidad);
            }
        } finally {
            pool.shutdownNow();
        }
    }

    @Test
    @DisplayName("S14: solicitudes creadas mientras una unidad se conecta y desconecta → listas coherentes, sin errores")
    void s14_solicitarMientrasUnaUnidadCambiaSuConexion() throws Exception {
        ExecutorService pool = Executors.newFixedThreadPool(2);
        try {
            for (int ronda = 0; ronda < RONDAS; ronda++) {
                UUID conductorFijo = UUID.randomUUID();
                UUID fija = sembrarUnidad(EstadoAmbulancia.DISPONIBLE, conductorFijo);
                UUID conductorInquieto = UUID.randomUUID();
                UUID inquieta = sembrarUnidad(EstadoAmbulancia.DISPONIBLE, conductorInquieto);

                CountDownLatch largada = new CountDownLatch(1);
                Future<Object> solicitudes = pool.submit(alDarLaLargada(largada, () -> {
                    List<SolicitudAmbulancia> creadas = new ArrayList<>();
                    for (int i = 0; i < 6; i++) {
                        creadas.add(solicitar());
                    }
                    return creadas;
                }));
                Future<Object> conexion = pool.submit(alDarLaLargada(largada, () -> {
                    for (int i = 0; i < 6; i++) {
                        gestionarConexionUnidadUseCase.desconectar(conductorInquieto);
                        gestionarConexionUnidadUseCase.conectar(conductorInquieto);
                    }
                    return "ok";
                }));
                largada.countDown();
                Object resultadoSolicitudes = obtener(solicitudes);
                Object resultadoConexion = obtener(conexion);

                assertEquals("ok", resultadoConexion,
                        "ronda " + ronda + ": conectar y desconectar no fallan: " + describir(resultadoConexion));
                assertTrue(resultadoSolicitudes instanceof List<?>,
                        "ronda " + ronda + ": ninguna solicitud falla: " + describir(resultadoSolicitudes));

                List<UUID> ids = new ArrayList<>();
                for (Object creada : (List<?>) resultadoSolicitudes) {
                    SolicitudAmbulancia solicitud = (SolicitudAmbulancia) creada;
                    ids.add(solicitud.getId());
                    List<UUID> notificadas = solicitud.getAmbulanciasNotificadas();
                    assertEquals(new HashSet<>(notificadas).size(), notificadas.size(),
                            "ronda " + ronda + ": ninguna unidad aparece dos veces");
                    assertTrue(notificadas.contains(fija),
                            "ronda " + ronda + ": la unidad que no cambió siempre es notificada");
                    // The unit that keeps toggling may or may not be there: it
                    // depends on the instant of the query. Later it may have been
                    // added as a late offer, but never more than once.
                    assertTrue(vecesNotificada(solicitud.getId(), inquieta) <= 1,
                            "ronda " + ronda + ": la unidad inquieta aparece como mucho una vez");
                    assertEquals(EstadoSolicitud.PENDIENTE,
                            solicitudJpaRepository.findById(solicitud.getId()).orElseThrow().getEstado(),
                            "ronda " + ronda + ": la solicitud sigue abierta");
                }

                solicitudJpaRepository.deleteAllById(ids);
                ambulanciaJpaRepository.deleteAllById(List.of(fija, inquieta));
            }
        } finally {
            pool.shutdownNow();
        }
    }

    @Test
    @DisplayName("Oferta tardía contra accept: la solicitud queda ASIGNADA a quien aceptó y la oferta no la reabre ni la pisa")
    void ofertaTardiaContraAceptar() throws Exception {
        ExecutorService pool = Executors.newFixedThreadPool(2);
        try {
            for (int ronda = 0; ronda < RONDAS; ronda++) {
                UUID conductorQueAcepta = UUID.randomUUID();
                UUID queAcepta = sembrarUnidad(EstadoAmbulancia.DISPONIBLE, conductorQueAcepta);
                UUID conductorTardio = UUID.randomUUID();
                UUID tardia = sembrarUnidad(EstadoAmbulancia.MANTENIMIENTO, conductorTardio);
                UUID solicitudId = solicitar().getId();
                assertEquals(0, vecesNotificada(solicitudId, tardia));

                // One unit accepts while the other one becomes available and is
                // offered every open request, this one included if still open.
                CountDownLatch largada = new CountDownLatch(1);
                Future<Object> aceptacion = pool.submit(alDarLaLargada(largada,
                        () -> aceptarSolicitudUseCase.aceptar(solicitudId, queAcepta, conductorQueAcepta)));
                Future<Object> disponibilidad = pool.submit(alDarLaLargada(largada,
                        () -> declararDisponibilidadUseCase.declarar(conductorTardio, true)));
                largada.countDown();
                Object resultadoAceptar = obtener(aceptacion);
                Object resultadoDisponibilidad = obtener(disponibilidad);
                String detalle = "ronda " + ronda + ": aceptar=" + describir(resultadoAceptar)
                        + ", disponibilidad=" + describir(resultadoDisponibilidad);

                assertTrue(resultadoAceptar instanceof ResultadoAceptarSolicitud resultado && resultado.ganador(),
                        "el accept gana: nadie más compite por la solicitud. " + detalle);
                assertFalse(resultadoDisponibilidad instanceof Throwable,
                        "declararse disponible no falla aunque la solicitud se mueva a la vez. " + detalle);

                SolicitudJpaEntity solicitud = solicitudJpaRepository.findById(solicitudId).orElseThrow();
                assertEquals(EstadoSolicitud.ASIGNADA, solicitud.getEstado(),
                        "la oferta tardía nunca devuelve la solicitud a PENDIENTE. " + detalle);
                assertEquals(queAcepta, solicitud.getAmbulanciaAsignadaId(), detalle);
                assertEquals(EstadoAmbulancia.EN_MISION,
                        ambulanciaJpaRepository.findById(queAcepta).orElseThrow().getEstado(), detalle);
                assertEquals(EstadoAmbulancia.DISPONIBLE,
                        ambulanciaJpaRepository.findById(tardia).orElseThrow().getEstado(), detalle);
                assertTrue(vecesNotificada(solicitudId, tardia) <= 1,
                        "la unidad tardía aparece como mucho una vez. " + detalle);
                assertEquals(1, vecesNotificada(solicitudId, queAcepta),
                        "la unidad que aceptó sigue entre las notificadas. " + detalle);

                solicitudJpaRepository.deleteById(solicitudId);
                ambulanciaJpaRepository.deleteAllById(List.of(queAcepta, tardia));
            }
        } finally {
            pool.shutdownNow();
        }
    }

    @Test
    @DisplayName("Dos unidades quedan disponibles a la vez: las dos entran a la solicitud abierta, cada una una sola vez")
    void dosOfertasTardiasALaVez() throws Exception {
        ExecutorService pool = Executors.newFixedThreadPool(2);
        try {
            for (int ronda = 0; ronda < RONDAS; ronda++) {
                UUID conductorNotificado = UUID.randomUUID();
                UUID notificada = sembrarUnidad(EstadoAmbulancia.DISPONIBLE, conductorNotificado);
                UUID conductorA = UUID.randomUUID();
                UUID tardiaA = sembrarUnidad(EstadoAmbulancia.MANTENIMIENTO, conductorA);
                UUID conductorB = UUID.randomUUID();
                UUID tardiaB = sembrarUnidad(EstadoAmbulancia.MANTENIMIENTO, conductorB);
                UUID solicitudId = solicitar().getId();

                CountDownLatch largada = new CountDownLatch(1);
                Future<Object> disponibleA = pool.submit(alDarLaLargada(largada,
                        () -> declararDisponibilidadUseCase.declarar(conductorA, true)));
                Future<Object> disponibleB = pool.submit(alDarLaLargada(largada,
                        () -> declararDisponibilidadUseCase.declarar(conductorB, true)));
                largada.countDown();
                Object resultadoA = obtener(disponibleA);
                Object resultadoB = obtener(disponibleB);
                String detalle = "ronda " + ronda + ": A=" + describir(resultadoA) + ", B=" + describir(resultadoB);

                assertFalse(resultadoA instanceof Throwable, detalle);
                assertFalse(resultadoB instanceof Throwable, detalle);
                // Both writes are versioned on the same request: when they collide
                // the one that loses reads the request again and tries once more,
                // so neither unit is left out and neither appears twice.
                assertEquals(1, vecesNotificada(solicitudId, tardiaA),
                        "la primera unidad entra a la solicitud, una sola vez. " + detalle);
                assertEquals(1, vecesNotificada(solicitudId, tardiaB),
                        "la segunda unidad entra a la solicitud, una sola vez. " + detalle);
                assertEquals(1, vecesNotificada(solicitudId, notificada),
                        "la unidad que ya estaba notificada no se pierde. " + detalle);
                assertEquals(EstadoSolicitud.PENDIENTE,
                        solicitudJpaRepository.findById(solicitudId).orElseThrow().getEstado(), detalle);
                assertNull(solicitudJpaRepository.findById(solicitudId).orElseThrow().getAmbulanciaAsignadaId(),
                        detalle);

                solicitudJpaRepository.deleteById(solicitudId);
                ambulanciaJpaRepository.deleteAllById(List.of(notificada, tardiaA, tardiaB));
            }
        } finally {
            pool.shutdownNow();
        }
    }

    // -----------------------------------------------------------------------
    // Helpers
    // -----------------------------------------------------------------------

    private UUID sembrarUnidad(EstadoAmbulancia estado, UUID conductorId) {
        UUID id = UUID.randomUUID();
        String placa = "R" + id.toString().substring(0, 7).toUpperCase();
        ambulanciaJpaRepository.save(new AmbulanciaJpaEntity(
                id, placa, estado, 4.73d, -74.08d, "PruebaCarrera", conductorId));
        return id;
    }

    private SolicitudAmbulancia solicitar() {
        return solicitarAmbulanciaUseCase.solicitar(
                4.73d, -74.08d, UUID.randomUUID(), UUID.randomUUID(), "PruebaCarrera", UUID.randomUUID());
    }

    private int vecesNotificada(UUID solicitudId, UUID unidad) {
        Integer veces = jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM solicitud_ambulancia_notificadas WHERE solicitud_id = '" + solicitudId
                        + "' AND ambulancia_id = '" + unidad + "'", Integer.class);
        return veces == null ? 0 : veces;
    }

    /**
     * Wraps a call so it starts when the latch opens and returns what happened:
     * the value the call produced, or the exception it threw.
     */
    private static Callable<Object> alDarLaLargada(CountDownLatch largada, Callable<Object> llamada) {
        return () -> {
            largada.await(ESPERA_MAXIMA_SEGUNDOS, TimeUnit.SECONDS);
            try {
                return llamada.call();
            } catch (RuntimeException e) {
                return e;
            }
        };
    }

    private static Object obtener(Future<Object> futuro) throws Exception {
        try {
            return futuro.get(ESPERA_MAXIMA_SEGUNDOS, TimeUnit.SECONDS);
        } catch (ExecutionException e) {
            return e.getCause();
        }
    }

    private static String describir(Object resultado) {
        if (resultado == null) {
            return "null";
        }
        if (resultado instanceof ResultadoAceptarSolicitud aceptacion) {
            return aceptacion.ganador() ? "gano" : "perdio";
        }
        return resultado.getClass().getSimpleName();
    }
}
