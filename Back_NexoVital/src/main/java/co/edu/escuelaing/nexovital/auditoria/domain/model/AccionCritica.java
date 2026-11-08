package co.edu.escuelaing.nexovital.auditoria.domain.model;

/**
 * Acciones que la bitácora considera críticas: las que cambian el estado de una
 * emergencia, del inventario o de la flota.
 *
 * <p>Se persisten como texto ({@code @Enumerated(EnumType.STRING)}): el valor
 * sobrevive a un reordenamiento del enum y es legible en una consulta SQL.
 */
public enum AccionCritica {
    EMERGENCIA_REPORTADA,
    INSUMO_DESPACHADO,
    INSUMO_DONADO,
    AMBULANCIA_ASIGNADA,
    SOLICITUD_RECHAZADA,
    LLEGADA_REPORTADA,
    LLEGADA_CONFIRMADA,
    SERVICIO_FINALIZADO
}
