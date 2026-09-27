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

    @Column(nullable = false)
    private UUID emergenciaId;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private EstadoSolicitud estado;

    @Column(nullable = false)
    private UUID centroAyudaId;

    @Column(nullable = false)
    private String zonaId;

    @Column(nullable = false)
    private Instant solicitadaEn;

    @Column(nullable = false)
    private Instant timeoutEn;

    @ElementCollection
    @CollectionTable(name = "solicitud_ambulancia_notificadas", joinColumns = @JoinColumn(name = "solicitud_id"))
    @Column(name = "ambulancia_id", nullable = false)
    private List<UUID> ambulanciasNotificadas = new ArrayList<>();

    @Column
    private UUID ambulanciaAsignadaId;

    @Version
    private long version;

    protected SolicitudJpaEntity() {
    }

    public SolicitudJpaEntity(UUID id, UUID emergenciaId, EstadoSolicitud estado, UUID centroAyudaId,
                              String zonaId, Instant solicitadaEn, Instant timeoutEn,
                              List<UUID> ambulanciasNotificadas, UUID ambulanciaAsignadaId) {
        this.id = id;
        this.emergenciaId = emergenciaId;
        this.estado = estado;
        this.centroAyudaId = centroAyudaId;
        this.zonaId = zonaId;
        this.solicitadaEn = solicitadaEn;
        this.timeoutEn = timeoutEn;
        this.ambulanciasNotificadas = ambulanciasNotificadas == null
                ? new ArrayList<>()
                : new ArrayList<>(ambulanciasNotificadas);
        this.ambulanciaAsignadaId = ambulanciaAsignadaId;
    }

    public UUID getId() {
        return id;
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

    public List<UUID> getAmbulanciasNotificadas() {
        return ambulanciasNotificadas;
    }

    public UUID getAmbulanciaAsignadaId() {
        return ambulanciaAsignadaId;
    }

    public long getVersion() {
        return version;
    }
}
