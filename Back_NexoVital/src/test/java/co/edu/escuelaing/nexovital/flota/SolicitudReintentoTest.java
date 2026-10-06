package co.edu.escuelaing.nexovital.flota;

import co.edu.escuelaing.nexovital.flota.application.usecase.FlotaPushListener;
import co.edu.escuelaing.nexovital.flota.domain.enums.EstadoAmbulancia;
import co.edu.escuelaing.nexovital.flota.domain.enums.EstadoSolicitud;
import co.edu.escuelaing.nexovital.flota.domain.model.ResultadoAceptarSolicitud;
import co.edu.escuelaing.nexovital.flota.domain.port.in.AceptarSolicitudUseCase;
import co.edu.escuelaing.nexovital.flota.domain.port.in.ExpirarSolicitudesVencidasUseCase;
import co.edu.escuelaing.nexovital.flota.domain.port.in.SolicitarAmbulanciaUseCase;
import co.edu.escuelaing.nexovital.flota.infrastructure.adapter.out.AmbulanciaJpaEntity;
import co.edu.escuelaing.nexovital.flota.infrastructure.adapter.out.AmbulanciaJpaRepository;
import co.edu.escuelaing.nexovital.flota.infrastructure.adapter.out.SolicitudJpaEntity;
import co.edu.escuelaing.nexovital.flota.infrastructure.adapter.out.SolicitudJpaRepository;
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
import org.springframework.test.context.TestPropertySource;

import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Retry of an unattended request (EP-04.F2.US4). When the accept window closes
 * with no winner, the sweep re-emits the request to the units available RIGHT
 * NOW (new window, new notified set) while retries remain and a unit exists; only
 * when the retries are exhausted — or no unit is available — does it expire to
 * {@code TIMEOUT} as before.
 *
 * <p>The retry is a re-emission, not a new lifecycle state: the request stays
 * {@code PENDIENTE} and a unit that accepts during the new window still wins the
 * same CAS.
 *
 * <p>This class pins {@code max-reintentos=2} (the production default) so the
 * retry path is exercised. The legacy expiry path is covered by
 * {@code SolicitudExpiracionTest}, which pins {@code max-reintentos=0}.
 *
 * <p>The scheduled sweep is disabled by the test profile (one-hour initial
 * delay), so the use case is driven directly against the controllable clock.
 */
@SpringBootTest
@ActiveProfiles("test")
@TestPropertySource(properties = "nexovital.solicitud.max-reintentos=2")
@Import({TestClockConfig.class, PushPortDePruebaConfig.class})
class SolicitudReintentoTest {

    @Autowired
    private ExpirarSolicitudesVencidasUseCase expirarSolicitudesVencidasUseCase;

    @Autowired
    private SolicitarAmbulanciaUseCase solicitarAmbulanciaUseCase;

    @Autowired
    private AceptarSolicitudUseCase aceptarSolicitudUseCase;

    @Autowired
    private AmbulanciaJpaRepository ambulanciaJpaRepository;

    @Autowired
    private SolicitudJpaRepository solicitudJpaRepository;

    @Autowired
    private PushPortDePrueba pushPortDePrueba;

    @Autowired
    private MutableClock clock;

    private String zona;
    private UUID unidad;
    private UUID conductorId;
    private final List<UUID> unidadesSembradas = new ArrayList<>();
    private final List<UUID> solicitudesCreadas = new ArrayList<>();

    @BeforeEach
    void sembrar() {
        clock.fijar(TestClockConfig.INSTANTE_BASE);
        pushPortDePrueba.limpiar();
        zona = "PruebaReintento-" + UUID.randomUUID();
        unidad = UUID.randomUUID();
        conductorId = UUID.randomUUID();
        ambulanciaJpaRepository.save(new AmbulanciaJpaEntity(
                unidad, "RET1", EstadoAmbulancia.DISPONIBLE, 4.73d, -74.08d, zona, conductorId));
        unidadesSembradas.add(unidad);
    }

    @AfterEach
    void limpiar() {
        ambulanciaJpaRepository.deleteAllById(unidadesSembradas);
        solicitudJpaRepository.deleteAllById(solicitudesCreadas);
        unidadesSembradas.clear();
        solicitudesCreadas.clear();
        pushPortDePrueba.limpiar();
    }

    @Test
    @DisplayName("US4: una solicitud vencida con reintentos se re-notifica y sigue PENDIENTE")
    void solicitudVencidaSeReintentaYSiguePendiente() {
        UUID solicitanteId = UUID.randomUUID();
        UUID solicitudId = crearSolicitudVencida(solicitanteId);
        // Drop the creation frames: only the retry emission is asserted here.
        pushPortDePrueba.limpiar();

        expirarSolicitudesVencidasUseCase.expirarVencidas();

        SolicitudJpaEntity entidad = solicitudJpaRepository.findById(solicitudId).orElseThrow();
        assertEquals(EstadoSolicitud.PENDIENTE, entidad.getEstado(),
                "con reintentos disponibles la solicitud NO expira");
        assertEquals(1, entidad.getReintentos(), "el contador de reintentos avanza");
        assertTrue(entidad.getTimeoutEn().isAfter(clock.instant()),
                "la ventana se reposiciona hacia el futuro");

        assertTrue(alSolicitanteConEstado(solicitanteId, "PENDIENTE"),
                "el solicitante recibe el reintento como PENDIENTE");
        assertTrue(alConductorConEstado(conductorId, "PENDIENTE"),
                "la unidad disponible es re-notificada en el destino de su conductor");
    }

    @Test
    @DisplayName("US4: una unidad que se vuelve disponible después de la emisión original entra en el reintento")
    void unidadDisponibleDespuesEntraEnElReintento() {
        UUID solicitanteId = UUID.randomUUID();
        UUID solicitudId = crearSolicitudVencida(solicitanteId);

        // The real repro: a driver reconnects AFTER the first emission, so the
        // unit is available now but was not part of the original broadcast.
        UUID unidadTardia = UUID.randomUUID();
        UUID conductorTardio = UUID.randomUUID();
        ambulanciaJpaRepository.save(new AmbulanciaJpaEntity(
                unidadTardia, "RET2", EstadoAmbulancia.DISPONIBLE, 4.74d, -74.09d, zona, conductorTardio));
        unidadesSembradas.add(unidadTardia);
        pushPortDePrueba.limpiar();

        expirarSolicitudesVencidasUseCase.expirarVencidas();

        // The retry payload carries the whole notified set; read it from the
        // requester's own copy instead of touching the lazy entity collection.
        List<UUID> notificadas = pushPortDePrueba
                .haciaUsuario(solicitanteId.toString(), FlotaPushListener.DESTINO_SOLICITUDES).stream()
                .filter(publicacion -> "PENDIENTE".equals(estadoDe(publicacion)))
                .map(publicacion -> ((FlotaPushListener.SolicitudPushPayload) publicacion.payload())
                        .ambulanciasNotificadas())
                .findFirst()
                .orElseThrow();
        assertTrue(notificadas.contains(unidad),
                "la unidad de la emisión original sigue en el broadcast");
        assertTrue(notificadas.contains(unidadTardia),
                "la unidad que apareció después entra en el reintento");
        assertTrue(alConductorConEstado(conductorTardio, "PENDIENTE"),
                "el conductor de la unidad tardía recibe el reintento");

        // The replaced set must be PERSISTED, not only pushed: the late unit is
        // now notified, so it can win the accept while the request is still open.
        ResultadoAceptarSolicitud resultado =
                aceptarSolicitudUseCase.aceptar(solicitudId, unidadTardia, conductorTardio);
        assertTrue(resultado.ganador(),
                "la unidad que entró por el reintento puede aceptar la solicitud");
        assertEquals(EstadoSolicitud.ASIGNADA,
                solicitudJpaRepository.findById(solicitudId).orElseThrow().getEstado());
    }

    @Test
    @DisplayName("US4: agotados los reintentos, la solicitud expira a TIMEOUT como antes")
    void agotadosLosReintentosExpira() {
        UUID solicitanteId = UUID.randomUUID();
        UUID solicitudId = crearSolicitudVencida(solicitanteId);

        expirarSolicitudesVencidasUseCase.expirarVencidas();               // reintento 1
        clock.avanzar(Duration.ofSeconds(61));
        expirarSolicitudesVencidasUseCase.expirarVencidas();               // reintento 2
        clock.avanzar(Duration.ofSeconds(61));
        int expiradas = expirarSolicitudesVencidasUseCase.expirarVencidas(); // sin reintentos -> TIMEOUT

        SolicitudJpaEntity entidad = solicitudJpaRepository.findById(solicitudId).orElseThrow();
        assertEquals(EstadoSolicitud.TIMEOUT, entidad.getEstado(),
                "sin reintentos la solicitud expira como antes");
        assertEquals(2, entidad.getReintentos(), "se agotaron los dos reintentos");
        assertTrue(expiradas >= 1, "el barrido reporta la expiración");
        assertTrue(alSolicitanteConEstado(solicitanteId, "TIMEOUT"),
                "el solicitante recibe TIMEOUT al agotarse los reintentos");
    }

    /** Creates a PENDIENTE request whose accept window already elapsed. */
    private UUID crearSolicitudVencida(UUID solicitanteId) {
        Instant pasado = clock.instant().minusSeconds(60);
        UUID solicitudId = solicitarAmbulanciaUseCase
                .solicitar(4.73d, -74.08d, UUID.randomUUID(), UUID.randomUUID(), zona, solicitanteId, pasado)
                .getId();
        solicitudesCreadas.add(solicitudId);
        return solicitudId;
    }

    private boolean alSolicitanteConEstado(UUID solicitanteId, String estado) {
        return pushPortDePrueba
                .haciaUsuario(solicitanteId.toString(), FlotaPushListener.DESTINO_SOLICITUDES).stream()
                .anyMatch(publicacion -> estado.equals(estadoDe(publicacion)));
    }

    private boolean alConductorConEstado(UUID conductor, String estado) {
        return pushPortDePrueba
                .haciaUsuario(conductor.toString(), FlotaPushListener.DESTINO_SOLICITUDES).stream()
                .anyMatch(publicacion -> estado.equals(estadoDe(publicacion)));
    }

    private static String estadoDe(PublicacionCapturada publicacion) {
        return ((FlotaPushListener.SolicitudPushPayload) publicacion.payload()).estado();
    }
}
