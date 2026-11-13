/**
 * Trazabilidad de acciones críticas (Maintain Audit Trail).
 *
 * <p>Registra quién hizo qué, sobre qué recurso y cuándo, para las operaciones
 * que cambian el estado del sistema: reporte de emergencia, despacho y donación
 * de insumos, asignación de ambulancia y cierre de servicio.
 *
 * <p>El registro es append-only: la API solo expone consultas. No hay endpoint
 * de modificación ni de borrado, y el repositorio no declara esos métodos.
 */
package co.edu.escuelaing.nexovital.auditoria;
