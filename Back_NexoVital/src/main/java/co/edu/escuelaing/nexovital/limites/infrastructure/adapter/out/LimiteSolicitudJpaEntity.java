package co.edu.escuelaing.nexovital.limites.infrastructure.adapter.out;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

import java.time.Instant;

/**
 * Fila del contador de límites. La clave es texto y ya viene compuesta
 * ({@code u:<usuario>:<recurso>} o {@code ip:<ip>:<recurso>}), así que no hace
 * falta una tabla de dimensiones.
 *
 * <p>{@code ventana_hasta} es lo que permite reiniciar sin un job programado: si
 * la ventana ya venció, la fila se reutiliza con contador 1. Sin barrido, sin
 * cron y sin filas zombis que crezcan para siempre.
 */
@Entity
@Table(name = "limite_solicitudes")
public class LimiteSolicitudJpaEntity {

    @Id
    @Column(length = 160)
    private String clave;

    @Column(nullable = false)
    private int contador;

    @Column(name = "ventana_hasta", nullable = false)
    private Instant ventanaHasta;

    protected LimiteSolicitudJpaEntity() {
        // Requerido por JPA.
    }

    public LimiteSolicitudJpaEntity(String clave, int contador, Instant ventanaHasta) {
        this.clave = clave;
        this.contador = contador;
        this.ventanaHasta = ventanaHasta;
    }

    public String getClave() {
        return clave;
    }

    public int getContador() {
        return contador;
    }

    public Instant getVentanaHasta() {
        return ventanaHasta;
    }
}
