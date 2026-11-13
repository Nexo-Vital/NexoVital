package co.edu.escuelaing.nexovital.mapa.domain.port.in;

import co.edu.escuelaing.nexovital.mapa.domain.model.Emergencia;
import co.edu.escuelaing.nexovital.mapa.domain.model.NivelEmergencia;
import co.edu.escuelaing.nexovital.mapa.domain.model.TipoEmergencia;
import co.edu.escuelaing.nexovital.usuarios.domain.model.Ubicacion;

import java.util.UUID;

/**
 * Puerto de entrada: reportar una emergencia. Una intencion por caso de uso.
 *
 * <p>Reportar una emergencia DISPARA el despacho: el backend crea la solicitud
 * de ambulancia en el mismo acto, sin que el cliente tenga que pedirla aparte.
 */
public interface ReportarEmergenciaUseCase {

    /**
     * Resultado del reporte.
     *
     * @param emergencia  emergencia persistida, con su zona resuelta
     * @param solicitudId id de la solicitud de ambulancia creada, o {@code null}
     *                    si no habia ninguna unidad disponible (o si el
     *                    solicitante no se identifico)
     */
    record EmergenciaReportada(Emergencia emergencia, UUID solicitudId) {
    }

    /**
     * Registra una emergencia sobre el punto reportado y despacha una ambulancia
     * para ella. El servidor asigna {@code id}, {@code estado} y
     * {@code createdAt}, resuelve la {@code zonaId} del punto con el
     * punto-en-poligono de {@link
     * co.edu.escuelaing.nexovital.mapa.domain.model.Zona}, y crea la solicitud
     * con ese punto como recogida.
     *
     * @param ubicacion     punto afectado
     * @param tipo          que esta pasando (lista cerrada)
     * @param nivel         severidad del contrato
     * @param descripcion   comentario libre del reporte
     * @param direccion     direccion legible del punto, o {@code null}
     * @param solicitanteId usuario autenticado que reporta; es el dueno de la
     *                      solicitud creada. {@code null} registra la emergencia
     *                      sin despachar (llamadores internos)
     * @return la emergencia persistida y el id de la solicitud creada, si la hubo
     * @throws IllegalArgumentException si falta algun campo obligatorio
     */
    EmergenciaReportada reportar(Ubicacion ubicacion, TipoEmergencia tipo, NivelEmergencia nivel,
                                 String descripcion, String direccion, UUID solicitanteId);
}
