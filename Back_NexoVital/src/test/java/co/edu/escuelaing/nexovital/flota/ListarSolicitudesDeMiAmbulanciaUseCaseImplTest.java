package co.edu.escuelaing.nexovital.flota;

import co.edu.escuelaing.nexovital.flota.application.usecase.ListarSolicitudesDeMiAmbulanciaUseCaseImpl;
import co.edu.escuelaing.nexovital.flota.domain.enums.EstadoSolicitud;
import co.edu.escuelaing.nexovital.flota.domain.model.SolicitudAmbulancia;
import co.edu.escuelaing.nexovital.flota.domain.port.out.SolicitudRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Unit cases of the driver's own-unit history (task CON-3).
 *
 * <p>The out port already filters by assigned unit at the database, but the use
 * case enforces the invariant itself: the history contains ONLY requests whose
 * assigned unit is the caller's, newest first. A request that was merely
 * broadcast (PENDIENTE), closed before any assignment (TIMEOUT/CANCELADA) or
 * assigned to another unit must never leak into the response.
 */
@ExtendWith(MockitoExtension.class)
class ListarSolicitudesDeMiAmbulanciaUseCaseImplTest {

    @Mock
    private SolicitudRepository solicitudRepository;

    private final UUID unidad = UUID.randomUUID();
    private final UUID otraUnidad = UUID.randomUUID();

    private static final Instant BASE = Instant.parse("2026-03-01T10:00:00Z");

    private ListarSolicitudesDeMiAmbulanciaUseCaseImpl useCase;

    @BeforeEach
    void setUp() {
        useCase = new ListarSolicitudesDeMiAmbulanciaUseCaseImpl(solicitudRepository);
    }

    @Test
    @DisplayName("Solo los servicios ASIGNADOS a la unidad entran, ordenados del mas nuevo al mas viejo")
    void soloAsignadosYMasNuevosPrimero() {
        SolicitudAmbulancia asignadaVieja = enEstado(UUID.randomUUID(), BASE).aceptar(unidad);
        SolicitudAmbulancia asignadaNueva = enEstado(UUID.randomUUID(), BASE.plusSeconds(300)).aceptar(unidad)
                .llegar(BASE.plusSeconds(320));
        SolicitudAmbulancia pendiente = enEstado(UUID.randomUUID(), BASE.plusSeconds(600));
        SolicitudAmbulancia cancelada = enEstado(UUID.randomUUID(), BASE.plusSeconds(700)).cancelar();
        SolicitudAmbulancia expirada = enEstado(UUID.randomUUID(), BASE.plusSeconds(800)).expiro();
        SolicitudAmbulancia ajena = enEstado(UUID.randomUUID(), BASE.plusSeconds(900)).aceptar(otraUnidad);

        when(solicitudRepository.listarPorAmbulanciaAsignada(unidad))
                .thenReturn(List.of(pendiente, asignadaVieja, ajena, cancelada, asignadaNueva, expirada));

        List<SolicitudAmbulancia> historial = useCase.listar(unidad);

        assertEquals(2, historial.size(), "solo las dos solicitudes asignadas a la unidad entran al historial");
        assertEquals(List.of(asignadaNueva.getId(), asignadaVieja.getId()),
                historial.stream().map(SolicitudAmbulancia::getId).toList(),
                "el historial va del mas nuevo al mas viejo");
        assertEquals(EstadoSolicitud.ASIGNADA, historial.get(0).getEstado());
        assertEquals(unidad, historial.get(0).getAmbulanciaAsignadaId(),
                "cada entrada lleva la unidad asignada");
        assertEquals(BASE.plusSeconds(320), historial.get(0).getLlegadaEn(),
                "la llegada se conserva cuando existe");

        verify(solicitudRepository).listarPorAmbulanciaAsignada(unidad);
    }

    @Test
    @DisplayName("Una unidad sin servicios atendidos devuelve una lista vacia")
    void unidadSinHistorialDevuelveVacio() {
        when(solicitudRepository.listarPorAmbulanciaAsignada(unidad)).thenReturn(List.of());

        List<SolicitudAmbulancia> historial = useCase.listar(unidad);

        assertTrue(historial.isEmpty(), "sin servicios asignados el historial es una lista vacia");
    }

    /** A PENDIENTE request (broadcast, not yet assigned) with a given creation instant. */
    private SolicitudAmbulancia enEstado(UUID id, Instant solicitadaEn) {
        return SolicitudAmbulancia.solicitar(
                id, 4.71d, -74.07d, null, null, null,
                solicitadaEn, solicitadaEn.plusSeconds(60), UUID.randomUUID(), List.of(unidad));
    }
}
