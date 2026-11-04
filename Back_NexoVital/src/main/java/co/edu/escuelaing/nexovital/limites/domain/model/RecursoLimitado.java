package co.edu.escuelaing.nexovital.limites.domain.model;

/**
 * Endpoints que se protegen. Cada uno lleva su propio contador: agotar el cupo
 * de reportes no debe impedir donar, porque son acciones distintas con perfiles
 * de uso distintos.
 */
public enum RecursoLimitado {
    EMERGENCIA,
    DONACION
}
