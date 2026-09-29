package co.edu.escuelaing.nexovital.flota.domain.model;

import co.edu.escuelaing.nexovital.flota.domain.enums.EstadoSolicitud;
import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Domain state machine of the C2 request. It has no framework dependency: the
 * forbidden transitions throw {@link IllegalStateException} and the accept is
 * the only path to ASIGNADA.
 */
class SolicitudAmbulanciaTest {

    private final UUID solicitudId = UUID.randomUUID();
    private final UUID emergenciaId = UUID.randomUUID();
    private final UUID centroAyudaId = UUID.randomUUID();
    private final UUID solicitanteId = UUID.randomUUID();
    private final UUID ambulanciaA = UUID.randomUUID();
    private final UUID ambulanciaB = UUID.randomUUID();

    private SolicitudAmbulancia pendiente() {
        return SolicitudAmbulancia.solicitar(solicitudId, 4.73d, -74.08d, emergenciaId, centroAyudaId, "zona-1",
                Instant.now(), Instant.now().plus(60, ChronoUnit.SECONDS), solicitanteId,
                List.of(ambulanciaA, ambulanciaB));
    }

    @Test
    void solicitarNaceEnPendienteSinAsignacion() {
        SolicitudAmbulancia solicitud = pendiente();
        assertEquals(EstadoSolicitud.PENDIENTE, solicitud.getEstado());
        assertNull(solicitud.getAmbulanciaAsignadaId());
        assertEquals(List.of(ambulanciaA, ambulanciaB), solicitud.getAmbulanciasNotificadas());
        assertEquals(solicitanteId, solicitud.getSolicitanteId());
        assertEquals(0, solicitud.getVersion());
    }

    @Test
    void laUbicacionEsObligatoriaYViajaEnLasTransiciones() {
        assertEquals(4.73d, pendiente().getLat());
        assertEquals(-74.08d, pendiente().getLng());
        // The pickup point is the request's own data: every transition carries it.
        SolicitudAmbulancia asignada = pendiente().aceptar(ambulanciaA).llegar(Instant.now());
        assertEquals(4.73d, asignada.getLat());
        assertEquals(-74.08d, asignada.getLng());
        // A non-finite coordinate is never a valid request.
        assertThrows(IllegalArgumentException.class, () -> SolicitudAmbulancia.solicitar(
                solicitudId, Double.NaN, -74.08d, emergenciaId, centroAyudaId, "zona-1",
                Instant.now(), Instant.now().plus(60, ChronoUnit.SECONDS), solicitanteId,
                List.of(ambulanciaA)));
    }

    @Test
    void laEmergenciaElCentroYLaZonaSonOpcionales() {
        // A standalone citizen request carries no emergency, center or zone.
        SolicitudAmbulancia suelta = SolicitudAmbulancia.solicitar(solicitudId, 4.73d, -74.08d,
                null, null, null, Instant.now(), Instant.now().plus(60, ChronoUnit.SECONDS),
                solicitanteId, List.of(ambulanciaA));
        assertEquals(EstadoSolicitud.PENDIENTE, suelta.getEstado());
        assertNull(suelta.getEmergenciaId());
        assertNull(suelta.getCentroAyudaId());
        assertNull(suelta.getZonaId());
        assertEquals(4.73d, suelta.getLat());
    }

    @Test
    void elSolicitanteSobreviveALasTransiciones() {
        SolicitudAmbulancia confirmada = pendiente().aceptar(ambulanciaA).confirmar();
        assertEquals(solicitanteId, confirmada.getSolicitanteId(),
                "the requester must be carried through the state transitions");
    }

    @Test
    void aceptarEnPendientePasaAAsignadaConLaAmbulancia() {
        SolicitudAmbulancia asignada = pendiente().aceptar(ambulanciaA);
        assertEquals(EstadoSolicitud.ASIGNADA, asignada.getEstado());
        assertEquals(ambulanciaA, asignada.getAmbulanciaAsignadaId());
    }

    @Test
    void aceptarEnAsignadaLanzaIllegalState() {
        SolicitudAmbulancia asignada = pendiente().aceptar(ambulanciaA);
        IllegalStateException error = assertThrows(IllegalStateException.class, () -> asignada.aceptar(ambulanciaB));
        assertTrue(error.getMessage().contains("ASIGNADA"), "the error must name the blocking state");
    }

    @Test
    void marcarTomadaSoloDesdeAsignada() {
        SolicitudAmbulancia tomada = pendiente().aceptar(ambulanciaA).marcarTomada();
        assertEquals(EstadoSolicitud.TOMADA, tomada.getEstado());
        assertThrows(IllegalStateException.class, () -> pendiente().marcarTomada());
    }

    @Test
    void confirmarSoloDesdeAsignada() {
        SolicitudAmbulancia confirmada = pendiente().aceptar(ambulanciaA).confirmar();
        assertEquals(EstadoSolicitud.CONFIRMADA, confirmada.getEstado());
        assertEquals(ambulanciaA, confirmada.getAmbulanciaAsignadaId());
        assertThrows(IllegalStateException.class, () -> pendiente().confirmar());
    }

    @Test
    void llegarSoloDesdeAsignadaYNoCambiaElEstado() {
        SolicitudAmbulancia asignada = pendiente().aceptar(ambulanciaA);
        Instant llegada = Instant.now();
        SolicitudAmbulancia conLlegada = asignada.llegar(llegada);
        // Arrival is a milestone, not a state: the enum is reused unchanged.
        assertEquals(EstadoSolicitud.ASIGNADA, conLlegada.getEstado());
        assertEquals(llegada, conLlegada.getLlegadaEn());
        assertNull(asignada.getLlegadaEn());
        assertThrows(IllegalStateException.class, () -> pendiente().llegar(llegada));
    }

    @Test
    void finalizarSoloDesdeServicioActivo() {
        // From ASIGNADA and from CONFIRMADA the request closes as TOMADA.
        SolicitudAmbulancia desdeAsignada = pendiente().aceptar(ambulanciaA).finalizar();
        assertEquals(EstadoSolicitud.TOMADA, desdeAsignada.getEstado());
        assertEquals(ambulanciaA, desdeAsignada.getAmbulanciaAsignadaId());
        assertEquals(solicitanteId, desdeAsignada.getSolicitanteId());

        SolicitudAmbulancia desdeConfirmada = pendiente().aceptar(ambulanciaA).confirmar().finalizar();
        assertEquals(EstadoSolicitud.TOMADA, desdeConfirmada.getEstado());

        // PENDIENTE has no mission to finish.
        assertThrows(IllegalStateException.class, () -> pendiente().finalizar());
        // A closed request cannot be closed twice.
        assertThrows(IllegalStateException.class, desdeAsignada::finalizar);
    }

    @Test
    void expiroSoloDesdePendiente() {
        SolicitudAmbulancia vencida = pendiente().expiro();
        assertEquals(EstadoSolicitud.TIMEOUT, vencida.getEstado());
        assertThrows(IllegalStateException.class, () -> pendiente().aceptar(ambulanciaA).expiro());
    }

    @Test
    void estaVencidaCuandoTimeoutQuedaAtras() {
        SolicitudAmbulancia vencida = SolicitudAmbulancia.solicitar(solicitudId, 4.73d, -74.08d,
                emergenciaId, centroAyudaId, "zona-1", Instant.now().minus(120, ChronoUnit.SECONDS),
                Instant.now().minus(60, ChronoUnit.SECONDS), solicitanteId, List.of(ambulanciaA));
        assertTrue(vencida.estaVencida());
        assertFalse(pendiente().estaVencida());
    }

    @Test
    void fueNotificadaSoloParaLasUnidadesDelBroadcast() {
        SolicitudAmbulancia solicitud = pendiente();
        assertTrue(solicitud.fueNotificada(ambulanciaA));
        assertTrue(solicitud.fueNotificada(ambulanciaB));
        assertFalse(solicitud.fueNotificada(UUID.randomUUID()));
    }
}
