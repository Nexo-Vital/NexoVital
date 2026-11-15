package co.edu.escuelaing.nexovital.mapa.domain.port.in;

import co.edu.escuelaing.nexovital.mapa.domain.model.Emergencia;
import co.edu.escuelaing.nexovital.mapa.domain.model.NivelEmergencia;
import co.edu.escuelaing.nexovital.mapa.domain.model.TipoEmergencia;
import co.edu.escuelaing.nexovital.usuarios.domain.model.Ubicacion;

import java.util.UUID;

/**
 * Puerto de entrada: reportar una emergencia. Una intencion por caso de uso.
 *
 * <p>Reportar una emergencia NO pide ambulancia: eso es otra accion del
 * ciudadano ({@code POST /solicitudes}).
 */
public interface ReportarEmergenciaUseCase {

    /**
     * Resultado del reporte.
     *
     * @param emergencia  emergencia persistida, con su zona resuelta
     * @param solicitudId siempre {@code null}: reportar ya no crea una solicitud
     *                    de ambulancia. Se conserva para no romper el contrato
     *                    ({@code solicitudId} opcional en la respuesta)
     */
    record EmergenciaReportada(Emergencia emergencia, UUID solicitudId) {
    }

    /**
     * Registra una emergencia sobre el punto reportado. El servidor asigna
     * {@code id}, {@code estado} y {@code createdAt} y resuelve la
     * {@code zonaId} del punto con el punto-en-poligono de {@link
     * co.edu.escuelaing.nexovital.mapa.domain.model.Zona}.
     *
     * @param ubicacion     punto afectado
     * @param tipo          que esta pasando (lista cerrada)
     * @param nivel         severidad del contrato
     * @param descripcion   comentario libre del reporte
     * @param direccion     direccion legible del punto, o {@code null}; no se
     *                      persiste en la emergencia
     * @param solicitanteId usuario autenticado que reporta (queda en la
     *                      bitacora), o {@code null} para llamadores internos
     * @return la emergencia persistida
     * @throws IllegalArgumentException si falta algun campo obligatorio
     */
    EmergenciaReportada reportar(Ubicacion ubicacion, TipoEmergencia tipo, NivelEmergencia nivel,
                                 String descripcion, String direccion, UUID solicitanteId);
}
