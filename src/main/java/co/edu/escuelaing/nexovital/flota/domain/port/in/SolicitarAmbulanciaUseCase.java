package co.edu.escuelaing.nexovital.flota.domain.port.in;

import co.edu.escuelaing.nexovital.flota.domain.model.SolicitudAmbulancia;

import java.time.Instant;
import java.util.UUID;

/** Creates a PENDIENTE request and notifies every available unit (AC1). */
public interface SolicitarAmbulanciaUseCase {

    SolicitudAmbulancia solicitar(UUID emergenciaId, UUID centroAyudaId, String zonaId, Instant timeoutEn);
}
