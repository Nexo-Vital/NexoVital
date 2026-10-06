package co.edu.escuelaing.nexovital.flota.infrastructure.adapter.out;

import co.edu.escuelaing.nexovital.flota.domain.enums.EstadoSolicitud;
import jakarta.persistence.CollectionTable;
import jakarta.persistence.Column;
import jakarta.persistence.ElementCollection;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.Table;
import jakarta.persistence.Version;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

@Entity
@Table(name = "solicitudes_ambulancia")
public class SolicitudJpaEntity {

    @Id
    private UUID id;

    /** Pickup point: mandatory, the only required geographic field. */
    @Column(nullable = false)
    private double lat;

    @Column(nullable = false)
    private double lng;

    /** Optional emergency reference; a standalone request has none. */
    @Column
    private UUID emergenciaId;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private EstadoSolicitud estado;

    /** Optional aid-center reference; a standalone request has none. */
    @Column
    private UUID centroAyudaId;

    /** Optional zone context; the zone is a map warning, never a dispatch key. */
    @Column
    private String zonaId;

    @Column(nullable = false)
    private Instant solicitadaEn;

    @Column(nullable = false)
    private Instant timeoutEn;

    /** Requester's user id; nullable only to tolerate rows persisted before tracking. */
    @Column
    private UUID solicitanteId;

    @ElementCollection
    @CollectionTable(name = "solicitud_ambulancia_notificadas", joinColumns = @JoinColumn(name = "solicitud_id"))
    @Column(name = "ambulancia_id", nullable = false)
    private List<UUID> ambulanciasNotificadas = new ArrayList<>();

    @Column
    private UUID ambulanciaAsignadaId;

    /** Arrival milestone of the winning unit; null until it declares arrival. */
    @Column
    private Instant llegadaEn;

    /** Retries already spent by the sweep (EP-04.F2.US4); 0 on creation. */
    @Column(nullable = false)
    private int reintentos;

    @Version
    private long version;

    protected SolicitudJpaEntity() {
    }

    public SolicitudJpaEntity(UUID id, double lat, double lng, UUID emergenciaId, EstadoSolicitud estado,
                              UUID centroAyudaId, String zonaId, Instant solicitadaEn, Instant timeoutEn,
                              UUID solicitanteId, List<UUID> ambulanciasNotificadas,
                              UUID ambulanciaAsignadaId, Instant llegadaEn, int reintentos) {
        this.id = id;
        this.lat = lat;
        this.lng = lng;
        this.emergenciaId = emergenciaId;
        this.estado = estado;
        this.centroAyudaId = centroAyudaId;
        this.zonaId = zonaId;
        this.solicitadaEn = solicitadaEn;
        this.timeoutEn = timeoutEn;
        this.solicitanteId = solicitanteId;
        this.ambulanciasNotificadas = ambulanciasNotificadas == null
                ? new ArrayList<>()
                : new ArrayList<>(ambulanciasNotificadas);
        this.ambulanciaAsignadaId = ambulanciaAsignadaId;
        this.llegadaEn = llegadaEn;
        this.reintentos = Math.max(0, reintentos);
    }

    public UUID getId() {
        return id;
    }

    public double getLat() {
        return lat;
    }

    public double getLng() {
        return lng;
    }

    public UUID getEmergenciaId() {
        return emergenciaId;
    }

    public EstadoSolicitud getEstado() {
        return estado;
    }

    public UUID getCentroAyudaId() {
        return centroAyudaId;
    }

    public String getZonaId() {
        return zonaId;
    }

    public Instant getSolicitadaEn() {
        return solicitadaEn;
    }

    public Instant getTimeoutEn() {
        return timeoutEn;
    }

    public UUID getSolicitanteId() {
        return solicitanteId;
    }

    public List<UUID> getAmbulanciasNotificadas() {
        return ambulanciasNotificadas;
    }

    public UUID getAmbulanciaAsignadaId() {
        return ambulanciaAsignadaId;
    }

    public Instant getLlegadaEn() {
        return llegadaEn;
    }

    public long getVersion() {
        return version;
    }

    public int getReintentos() {
        return reintentos;
    }

    /**
     * Replaces the notified set in place. Called ONLY after this row was claimed
     * atomically by {@code reintentarAtomico}: since a single sweeper wins the
     * conditional update, no other writer is rewriting the collection.
     */
    public void reemplazarNotificadas(List<UUID> nuevasNotificadas) {
        this.ambulanciasNotificadas.clear();
        if (nuevasNotificadas != null) {
            this.ambulanciasNotificadas.addAll(nuevasNotificadas);
        }
    }
}
