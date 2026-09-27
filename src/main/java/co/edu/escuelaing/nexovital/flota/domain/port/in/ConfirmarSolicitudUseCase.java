package co.edu.escuelaing.nexovital.flota.domain.port.in;

import co.edu.escuelaing.nexovital.flota.domain.model.SolicitudAmbulancia;

import java.util.UUID;

/** The help center confirms the assigned unit (ASIGNADA → CONFIRMADA). */
public interface ConfirmarSolicitudUseCase {

    SolicitudAmbulancia confirmar(UUID solicitudId, UUID centroAyudaId);
}
