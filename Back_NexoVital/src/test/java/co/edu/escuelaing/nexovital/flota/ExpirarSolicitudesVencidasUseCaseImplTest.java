package co.edu.escuelaing.nexovital.flota;

import co.edu.escuelaing.nexovital.flota.application.usecase.ExpirarSolicitudesVencidasUseCaseImpl;
import co.edu.escuelaing.nexovital.flota.domain.enums.EstadoAmbulancia;
import co.edu.escuelaing.nexovital.flota.domain.enums.EstadoSolicitud;
import co.edu.escuelaing.nexovital.flota.domain.event.SolicitudExpiradaEvent;
import co.edu.escuelaing.nexovital.flota.domain.event.SolicitudReintentadaEvent;
import co.edu.escuelaing.nexovital.flota.domain.model.Ambulancia;
import co.edu.escuelaing.nexovital.flota.domain.model.SolicitudAmbulancia;
import co.edu.escuelaing.nexovital.flota.domain.port.out.AmbulanciaRepository;
import co.edu.escuelaing.nexovital.flota.domain.port.out.SolicitudRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.context.ApplicationEventPublisher;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/**
 * Branch selection of the sweep (EP-04.F2.US4): retry vs. final expiry. The
 * retry depends on the retry counter and the available fleet, so the two edges
 * that are hard to seed in the shared H2 (retries exhausted and no unit
 * available) are pinned here with stubs.
 *
 * <p>The race-lost case (the conditional update returns 0) must emit nothing:
 * another sweep already handled the row.
 */
@ExtendWith(MockitoExtension.class)
class ExpirarSolicitudesVencidasUseCaseImplTest {

    private static final int MAX_REINTENTOS = 2;
    private static final long TIMEOUT_SEGUNDOS = 60L;
    private static final Instant AHORA = Instant.parse("2026-01-01T00:00:00Z");
    private static final Clock CLOCK = Clock.fixed(AHORA, ZoneOffset.UTC);

    @Mock
    private SolicitudRepository solicitudRepository;

    @Mock
    private AmbulanciaRepository ambulanciaRepository;

    @Mock
    private ApplicationEventPublisher eventPublisher;

    private final UUID solicitudId = UUID.randomUUID();
    private final UUID solicitanteId = UUID.randomUUID();
    private final UUID unidad = UUID.randomUUID();
    private final UUID conductor = UUID.randomUUID();

    private ExpirarSolicitudesVencidasUseCaseImpl useCase;

    @BeforeEach
    void setUp() {
        useCase = new ExpirarSolicitudesVencidasUseCaseImpl(
                solicitudRepository, ambulanciaRepository, eventPublisher, CLOCK,
                MAX_REINTENTOS, TIMEOUT_SEGUNDOS);
    }

    @Test
    @DisplayName("US4: con reintentos y una unidad disponible, reintenta y NO expira")
    void reintentaCuandoHayReintentosYUnidadDisponible() {
        SolicitudAmbulancia vencida = solicitudVencida(0);
        Instant nuevaVentana = AHORA.plus(TIMEOUT_SEGUNDOS, ChronoUnit.SECONDS);
        when(solicitudRepository.listarPendientesVencidas(AHORA)).thenReturn(List.of(vencida));
        when(ambulanciaRepository.listarDisponibles()).thenReturn(List.of(unidadDisponible()));
        when(solicitudRepository.reintentarAtomico(
                solicitudId, EstadoSolicitud.PENDIENTE, nuevaVentana, List.of(unidad), MAX_REINTENTOS, AHORA))
                .thenReturn(1);

        int expiradas = useCase.expirarVencidas();

        assertEquals(0, expiradas, "un reintento no cuenta como expiración");
        ArgumentCaptor<SolicitudReintentadaEvent> evento =
                ArgumentCaptor.forClass(SolicitudReintentadaEvent.class);
        verify(eventPublisher).publishEvent(evento.capture());
        assertEquals(solicitudId, evento.getValue().solicitudId());
        assertEquals(1, evento.getValue().reintento());
        assertEquals(nuevaVentana, evento.getValue().timeoutEn());
        assertTrue(evento.getValue().ambulanciasNotificadas().contains(unidad),
                "el evento lleva el conjunto disponible actual");
        verify(solicitudRepository, never()).transicionAtomicaExpirar(any(), any(), any(), any());
    }

    @Test
    @DisplayName("US4: agotados los reintentos, expira como antes y no consulta la flota")
    void expiraCuandoSeAgotaronLosReintentos() {
        when(solicitudRepository.listarPendientesVencidas(AHORA)).thenReturn(List.of(solicitudVencida(MAX_REINTENTOS)));
        when(solicitudRepository.transicionAtomicaExpirar(
                solicitudId, EstadoSolicitud.PENDIENTE, EstadoSolicitud.TIMEOUT, AHORA)).thenReturn(1);

        int expiradas = useCase.expirarVencidas();

        assertEquals(1, expiradas);
        verify(eventPublisher).publishEvent(any(SolicitudExpiradaEvent.class));
        verify(ambulanciaRepository, never()).listarDisponibles();
        verify(solicitudRepository, never()).reintentarAtomico(any(), any(), any(), anyList(), anyInt(), any());
    }

    @Test
    @DisplayName("US4: sin unidades disponibles, expira como antes")
    void expiraCuandoNoHayUnidadesDisponibles() {
        when(solicitudRepository.listarPendientesVencidas(AHORA)).thenReturn(List.of(solicitudVencida(0)));
        when(ambulanciaRepository.listarDisponibles()).thenReturn(List.of());
        when(solicitudRepository.transicionAtomicaExpirar(
                solicitudId, EstadoSolicitud.PENDIENTE, EstadoSolicitud.TIMEOUT, AHORA)).thenReturn(1);

        int expiradas = useCase.expirarVencidas();

        assertEquals(1, expiradas);
        verify(eventPublisher).publishEvent(any(SolicitudExpiradaEvent.class));
        verify(solicitudRepository, never()).reintentarAtomico(any(), any(), any(), anyList(), anyInt(), any());
    }

    @Test
    @DisplayName("US4: si pierde la carrera del reintento, no emite ni expira")
    void noEmiteNadaSiPierdeLaCarreraDelReintento() {
        when(solicitudRepository.listarPendientesVencidas(AHORA)).thenReturn(List.of(solicitudVencida(0)));
        when(ambulanciaRepository.listarDisponibles()).thenReturn(List.of(unidadDisponible()));
        when(solicitudRepository.reintentarAtomico(
                any(), any(), any(), anyList(), anyInt(), any())).thenReturn(0);

        int expiradas = useCase.expirarVencidas();

        assertEquals(0, expiradas);
        verifyNoInteractions(eventPublisher);
        verify(solicitudRepository, never()).transicionAtomicaExpirar(any(), any(), any(), any());
    }

    /** A PENDIENTE request whose window already elapsed, with {@code reintentos} spent. */
    private SolicitudAmbulancia solicitudVencida(int reintentos) {
        return SolicitudAmbulancia.restaurar(
                solicitudId, 4.73d, -74.08d, null, EstadoSolicitud.PENDIENTE, null, "zona",
                AHORA.minus(120, ChronoUnit.SECONDS), AHORA.minus(60, ChronoUnit.SECONDS), solicitanteId,
                List.of(unidad), null, null, 3L, reintentos);
    }

    private Ambulancia unidadDisponible() {
        return new Ambulancia(unidad, "NVX-001", EstadoAmbulancia.DISPONIBLE, 4.73d, -74.08d, "zona", conductor, 0L);
    }
}
