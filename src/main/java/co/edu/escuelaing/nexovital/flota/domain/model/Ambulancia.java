package co.edu.escuelaing.nexovital.flota.domain.model;

import co.edu.escuelaing.nexovital.flota.domain.enums.EstadoAmbulancia;

import java.util.Objects;
import java.util.UUID;

/**
 * Ambulance aggregate. Immutable and framework-free: it knows neither Spring
 * nor JPA.
 *
 * <p>{@code conductorId} is the driver user id. It is the key the C2 broadcast
 * uses to reach each notified unit by its OWN user destination (D-F1): the
 * STOMP Principal is the {@code Usuario} and {@code Usuario.getName()} resolves
 * to its id, so a per-user push is addressed to this value.
 */
public final class Ambulancia {

    private final UUID id;
    private final String placa;
    private final EstadoAmbulancia estado;
    private final double lat;
    private final double lng;
    private final String zona;
    private final UUID conductorId;
    private final long version;

    public Ambulancia(UUID id, String placa, EstadoAmbulancia estado,
                      double lat, double lng, String zona, UUID conductorId, long version) {
        this.id = Objects.requireNonNull(id, "id is required");
        this.placa = Objects.requireNonNull(placa, "placa is required");
        this.estado = Objects.requireNonNull(estado, "estado is required");
        this.lat = lat;
        this.lng = lng;
        this.zona = Objects.requireNonNull(zona, "zona is required");
        this.conductorId = conductorId;
        this.version = version;
    }

    /**
     * Occupies the unit. Only a {@code DISPONIBLE} ambulance can take a mission;
     * any other state means another flow already claimed it.
     *
     * @throws IllegalStateException if the unit is not available
     */
    public Ambulancia marcarEnMision() {
        if (estado != EstadoAmbulancia.DISPONIBLE) {
            throw new IllegalStateException(
                    "Ambulance " + placa + " in state " + estado + " cannot enter a mission");
        }
        return new Ambulancia(id, placa, EstadoAmbulancia.EN_MISION, lat, lng, zona, conductorId, version + 1);
    }

    public UUID getId() {
        return id;
    }

    public String getPlaca() {
        return placa;
    }

    public EstadoAmbulancia getEstado() {
        return estado;
    }

    public double getLat() {
        return lat;
    }

    public double getLng() {
        return lng;
    }

    public String getZona() {
        return zona;
    }

    /** Driver user id, or {@code null} when the unit has no driver assigned. */
    public UUID getConductorId() {
        return conductorId;
    }

    public long getVersion() {
        return version;
    }
}
