package co.edu.escuelaing.nexovital.flota.infrastructure.adapter.in.dto;

import co.edu.escuelaing.nexovital.flota.domain.enums.EstadoAmbulancia;
import co.edu.escuelaing.nexovital.flota.domain.model.Ambulancia;

import java.util.UUID;

/** Public projection of a fleet unit (AC5): identity, state, position and zone. */
public record AmbulanciaDto(UUID id, String placa, EstadoAmbulancia estado,
                            UbicacionDto ubicacion, String zona) {

    public static AmbulanciaDto fromDomain(Ambulancia ambulancia) {
        return new AmbulanciaDto(
                ambulancia.getId(),
                ambulancia.getPlaca(),
                ambulancia.getEstado(),
                new UbicacionDto(ambulancia.getLat(), ambulancia.getLng()),
                ambulancia.getZona());
    }
}
