package co.edu.escuelaing.nexovital.mapa.domain.port.in;

import co.edu.escuelaing.nexovital.mapa.domain.model.Emergencia;
import co.edu.escuelaing.nexovital.mapa.domain.model.NivelEmergencia;
import co.edu.escuelaing.nexovital.mapa.domain.model.TipoEmergencia;
import co.edu.escuelaing.nexovital.usuarios.domain.model.Ubicacion;

/**
 * Puerto de entrada: reportar una emergencia. Una intención por caso de uso.
 */
public interface ReportarEmergenciaUseCase {

    /**
     * Registra una emergencia sobre el punto reportado. El servidor asigna
     * {@code id}, {@code estado} y {@code createdAt}, y resuelve la
     * {@code zonaId} del punto con el punto-en-polígono de {@link
     * co.edu.escuelaing.nexovital.mapa.domain.model.Zona}.
     *
     * @param ubicacion   punto afectado
     * @param tipo        qué está pasando (lista cerrada)
     * @param nivel       severidad del contrato
     * @param descripcion comentario libre del reporte
     * @return la emergencia persistida, con su zona resuelta (o {@code null} si
     *         el punto cae fuera de todo el catálogo)
     * @throws IllegalArgumentException si falta algún campo obligatorio
     */
    Emergencia reportar(Ubicacion ubicacion, TipoEmergencia tipo, NivelEmergencia nivel, String descripcion);
}
