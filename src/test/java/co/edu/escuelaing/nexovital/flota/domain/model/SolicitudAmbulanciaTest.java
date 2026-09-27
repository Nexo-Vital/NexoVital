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
        return SolicitudAmbulancia.solicitar(solicitudId, emergenciaId, centroAyudaId, "zona-1",
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
    void expiroSoloDesdePendiente() {
        SolicitudAmbulancia vencida = pendiente().expiro();
        assertEquals(EstadoSolicitud.TIMEOUT, vencida.getEstado());
        assertThrows(IllegalStateException.class, () -> pendiente().aceptar(ambulanciaA).expiro());
    }

    @Test
    void estaVencidaCuandoTimeoutQuedaAtras() {
        SolicitudAmbulancia vencida = SolicitudAmbulancia.solicitar(solicitudId, emergenciaId, centroAyudaId,
                "zona-1", Instant.now().minus(120, ChronoUnit.SECONDS),
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
