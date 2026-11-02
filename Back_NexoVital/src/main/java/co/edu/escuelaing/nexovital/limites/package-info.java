/**
 * Protección ante abuso y saturación (Limit Access / Detect Service Denial).
 *
 * <p>Limita cuántas solicitudes puede disparar un mismo actor contra los
 * endpoints que crean estado y que un script podría inundar: reportar una
 * emergencia y donar insumos.
 *
 * <p>El contador vive en la base de datos, no en memoria. Es deliberado: con dos
 * instancias detrás de un balanceador, un contador en RAM daría el doble del
 * límite y no vería lo que hizo la otra instancia — exactamente el problema que
 * aparece cuando se escala horizontalmente sin sacar el estado del proceso.
 */
package co.edu.escuelaing.nexovital.limites;
