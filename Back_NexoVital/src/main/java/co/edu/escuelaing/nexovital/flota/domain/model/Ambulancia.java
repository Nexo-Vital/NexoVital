package co.edu.escuelaing.nexovital.flota.domain.model;

import co.edu.escuelaing.nexovital.flota.domain.enums.EstadoAmbulancia;
import co.edu.escuelaing.nexovital.flota.domain.enums.FuentePosicion;

import java.time.Instant;
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
 *
 * <p><b>Signal is data, not a state (EP-04.F1.US1, D4).</b>
 * {@code ultimaPosicionEn}, {@code fuentePosicion} and {@code sinSenal} describe
 * the position feed of the unit. They never change {@code estado}: a unit can be
 * {@code DISPONIBLE} or {@code EN_MISION} and, on top of that, have lost its
 * signal.
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
    private final Instant ultimaPosicionEn;
    private final FuentePosicion fuentePosicion;
    private final boolean sinSenal;

    /**
     * A unit that has never reported a position: no report instant, no source
     * and, therefore, no lost signal.
     */
    public Ambulancia(UUID id, String placa, EstadoAmbulancia estado,
                      double lat, double lng, String zona, UUID conductorId, long version) {
        this(id, placa, estado, lat, lng, zona, conductorId, version, null, null, false);
    }

    public Ambulancia(UUID id, String placa, EstadoAmbulancia estado,
                      double lat, double lng, String zona, UUID conductorId, long version,
                      Instant ultimaPosicionEn, FuentePosicion fuentePosicion, boolean sinSenal) {
        this.id = Objects.requireNonNull(id, "id is required");
        this.placa = Objects.requireNonNull(placa, "placa is required");
        this.estado = Objects.requireNonNull(estado, "estado is required");
        this.lat = lat;
        this.lng = lng;
        this.zona = Objects.requireNonNull(zona, "zona is required");
        this.conductorId = conductorId;
        this.version = version;
        this.ultimaPosicionEn = ultimaPosicionEn;
        this.fuentePosicion = fuentePosicion;
        this.sinSenal = sinSenal;
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
        return new Ambulancia(id, placa, EstadoAmbulancia.EN_MISION, lat, lng, zona, conductorId,
                version + 1, ultimaPosicionEn, fuentePosicion, sinSenal);
    }

    /**
     * Moves the unit to a new position. Position is DATA, not a state (D-T5):
     * the unit keeps its {@code estado}, so a unit in a mission keeps moving on
     * the map while it is {@code EN_MISION}. This method only expresses the new
     * aggregate; the position columns are persisted atomically by the outbound
     * port so the state can never be touched by a report.
     *
     * @param lat latitude in degrees
     * @param lng longitude in degrees
     * @return a new aggregate with the same identity, driver and state, and the
     *         new coordinates
     * @throws IllegalArgumentException if a coordinate is not a finite number
     */
    public Ambulancia actualizarPosicion(double lat, double lng) {
        if (!Double.isFinite(lat) || !Double.isFinite(lng)) {
            throw new IllegalArgumentException("Position coordinates must be finite numbers");
        }
        return new Ambulancia(id, placa, estado, lat, lng, zona, conductorId,
                version + 1, ultimaPosicionEn, fuentePosicion, sinSenal);
    }

    /**
     * Releases the unit at the end of the service: only a unit that is
     * {@code EN_MISION} can be freed. It returns to {@code DISPONIBLE} so it can
     * take a new mission (EP-04.F2.US11).
     *
     * @throws IllegalStateException if the unit is not in a mission
     */
    public Ambulancia liberar() {
        if (estado != EstadoAmbulancia.EN_MISION) {
            throw new IllegalStateException(
                    "Ambulance " + placa + " in state " + estado + " cannot be released");
        }
        return new Ambulancia(id, placa, EstadoAmbulancia.DISPONIBLE, lat, lng, zona, conductorId,
                version + 1, ultimaPosicionEn, fuentePosicion, sinSenal);
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

    /** Instant of the last accepted position report, or {@code null} if it never reported. */
    public Instant getUltimaPosicionEn() {
        return ultimaPosicionEn;
    }

    /** Who produced the last accepted report, or {@code null} if it never reported. */
    public FuentePosicion getFuentePosicion() {
        return fuentePosicion;
    }

    /** {@code true} while the unit has gone longer than the threshold without reporting. */
    public boolean isSinSenal() {
        return sinSenal;
    }
}
