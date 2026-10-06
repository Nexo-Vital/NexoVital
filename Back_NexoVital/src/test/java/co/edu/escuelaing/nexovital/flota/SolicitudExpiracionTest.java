package co.edu.escuelaing.nexovital.flota;

import co.edu.escuelaing.nexovital.flota.application.usecase.FlotaPushListener;
import co.edu.escuelaing.nexovital.flota.domain.enums.EstadoAmbulancia;
import co.edu.escuelaing.nexovital.flota.domain.enums.EstadoSolicitud;
import co.edu.escuelaing.nexovital.flota.domain.exception.SolicitudNoAsignableException;
import co.edu.escuelaing.nexovital.flota.domain.port.in.AceptarSolicitudUseCase;
import co.edu.escuelaing.nexovital.flota.domain.port.in.ExpirarSolicitudesVencidasUseCase;
import co.edu.escuelaing.nexovital.flota.domain.port.in.SolicitarAmbulanciaUseCase;
import co.edu.escuelaing.nexovital.flota.infrastructure.adapter.out.AmbulanciaJpaEntity;
import co.edu.escuelaing.nexovital.flota.infrastructure.adapter.out.AmbulanciaJpaRepository;
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

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Expiry of an unattended request (EP-04.F2.US9). Expiry is about the request
 * as a whole: while PENDIENTE, the single {@code timeoutEn} window closes and
 * the request becomes TIMEOUT; the notified units were never occupied, so they
 * stay DISPONIBLE. The transition is a conditional update, so a second sweep is
 * a no-op.
 *
 * <p>The scheduled sweep is disabled by the test profile (one-hour initial
 * delay), so the use case is driven directly against the controllable clock.
 *
 * <p><b>US4 interaction.</b> Since US4 a window that closes with a retry left is
 * re-emitted instead of expiring, so this class pins {@code max-reintentos=0}:
 * it exercises the "expiry as before" path (retries exhausted/disabled) exactly
 * as it did before the retry feature. The retry path is covered by
 * {@code SolicitudReintentoTest}, which sets {@code max-reintentos=2}.
 */
@SpringBootTest
@ActiveProfiles("test")
@TestPropertySource(properties = "nexovital.solicitud.max-reintentos=0")
@Import({TestClockConfig.class, PushPortDePruebaConfig.class})
class SolicitudExpiracionTest {

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
        zona = "PruebaExpira-" + UUID.randomUUID();
        unidad = UUID.randomUUID();
        conductorId = UUID.randomUUID();
        ambulanciaJpaRepository.save(new AmbulanciaJpaEntity(
                unidad, "EXP1", EstadoAmbulancia.DISPONIBLE, 4.73d, -74.08d, zona, conductorId));
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
    @DisplayName("US9: la solicitud sin accept expira, avisa al solicitante y deja la unidad disponible")
    void expirarVencidasCierraYNotificaSinOcuparLaUnidad() {
        UUID solicitanteId = UUID.randomUUID();
        UUID solicitudId = crearSolicitudVencida(solicitanteId);

        int expiradas = expirarSolicitudesVencidasUseCase.expirarVencidas();

        assertTrue(expiradas >= 1, "la solicitud vencida de la zona debe expirar");
        assertEquals(EstadoSolicitud.TIMEOUT,
                solicitudJpaRepository.findById(solicitudId).orElseThrow().getEstado());
        // Expiry is a request-level event: no unit was occupied to begin with, so
        // the notified unit is still available for a new request.
        assertEquals(EstadoAmbulancia.DISPONIBLE,
                ambulanciaJpaRepository.findById(unidad).orElseThrow().getEstado());

        assertTrue(alSolicitanteConEstado(solicitanteId, "TIMEOUT"),
                "el solicitante debe recibir TIMEOUT en su destino de usuario");

        // Idempotent: a second sweep does not expire or re-notify anything.
        int segundas = expirarSolicitudesVencidasUseCase.expirarVencidas();
        assertEquals(0, segundas, "una solicitud ya expirada no se vuelve a expirar");
        assertEquals(1, cantidadAlSolicitanteConEstado(solicitanteId, "TIMEOUT"),
                "una expiración repetida no vuelve a notificar");
    }

    @Test
    @DisplayName("US9: aceptar una solicitud ya expirada responde 409 (CAS contra la aceptación)")
    void aceptarUnaSolicitudExpiradaEsRechazado() {
        UUID solicitudId = crearSolicitudVencida(UUID.randomUUID());

        expirarSolicitudesVencidasUseCase.expirarVencidas();

        assertThrows(SolicitudNoAsignableException.class,
                () -> aceptarSolicitudUseCase.aceptar(solicitudId, unidad, conductorId),
                "el accept no puede ganarle a una solicitud ya expirada");
        assertEquals(EstadoAmbulancia.DISPONIBLE,
                ambulanciaJpaRepository.findById(unidad).orElseThrow().getEstado(),
                "un accept rechazado no puede ocupar la unidad");
    }

    @Test
    @DisplayName("US9: una solicitud PENDIENTE dentro de su ventana NO expira")
    void unaSolicitudVigenteNoExpira() {
        UUID solicitudId = solicitarAmbulanciaUseCase.solicitar(
                4.73d, -74.08d, UUID.randomUUID(), UUID.randomUUID(), zona, UUID.randomUUID(),
                clock.instant().plusSeconds(60)).getId();
        solicitudesCreadas.add(solicitudId);

        expirarSolicitudesVencidasUseCase.expirarVencidas();

        // The sweep never touches a request still inside its window.
        assertEquals(EstadoSolicitud.PENDIENTE,
                solicitudJpaRepository.findById(solicitudId).orElseThrow().getEstado());
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
        return cantidadAlSolicitanteConEstado(solicitanteId, estado) > 0;
    }

    private long cantidadAlSolicitanteConEstado(UUID solicitanteId, String estado) {
        return pushPortDePrueba
                .haciaUsuario(solicitanteId.toString(), FlotaPushListener.DESTINO_SOLICITUDES).stream()
                .filter(publicacion -> estado.equals(estadoDe(publicacion)))
                .count();
    }

    private static String estadoDe(PublicacionCapturada publicacion) {
        return ((FlotaPushListener.SolicitudPushPayload) publicacion.payload()).estado();
    }
}
