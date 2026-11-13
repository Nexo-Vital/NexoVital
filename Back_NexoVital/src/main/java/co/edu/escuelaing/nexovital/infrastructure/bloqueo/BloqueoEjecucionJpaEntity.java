package co.edu.escuelaing.nexovital.infrastructure.bloqueo;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

import java.time.Instant;

/**
 * Fila de bloqueo de una tarea programada. El nombre de la tarea es la clave:
 * una fila por tarea, compartida por todas las instancias.
 *
 * <p>No hay setters: la fila se escribe solo con el UPDATE condicional de
 * {@link BloqueoEjecucionJpaRepository}, igual que las columnas atómicas de la
 * flota. Así no hay dos caminos para dejar el bloqueo en un estado inválido.
 */
@Entity
@Table(name = "bloqueos_ejecucion", schema = "infraestructura")
public class BloqueoEjecucionJpaEntity {

    @Id
    @Column(name = "nombre", length = 80, nullable = false)
    private String nombre;

    @Column(name = "propietario", length = 80, nullable = false)
    private String propietario;

    @Column(name = "expira_en", nullable = false)
    private Instant expiraEn;

    protected BloqueoEjecucionJpaEntity() {
        // JPA
    }

    public BloqueoEjecucionJpaEntity(String nombre, String propietario, Instant expiraEn) {
        this.nombre = nombre;
        this.propietario = propietario;
        this.expiraEn = expiraEn;
    }

    public String getNombre() {
        return nombre;
    }

    public String getPropietario() {
        return propietario;
    }

    public Instant getExpiraEn() {
        return expiraEn;
    }
}
