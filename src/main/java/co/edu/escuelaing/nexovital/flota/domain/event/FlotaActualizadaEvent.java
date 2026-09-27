package co.edu.escuelaing.nexovital.flota.domain.event;

import co.edu.escuelaing.nexovital.flota.domain.enums.EstadoAmbulancia;

import java.util.UUID;

/** A unit changed state (position/state feed). Published to {@code /topic/flota}. */
public record FlotaActualizadaEvent(UUID ambulanciaId, EstadoAmbulancia estado) {
}
