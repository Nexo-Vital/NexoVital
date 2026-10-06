package co.edu.escuelaing.nexovital.recursos.domain.port.out;

import co.edu.escuelaing.nexovital.recursos.domain.model.CentroPropio;

import java.util.Optional;
import java.util.UUID;

/**
 * Puerto de salida hacia el módulo {@code usuarios}, dueño de los centros:
 * {@code recursos} consulta y registra el centro de un administrador a través
 * de este puerto y nunca con un acceso a su esquema (frontera de datos,
 * ADR-0003). Es el hermano de {@link CentroAcopioQueryPort}.
 */
public interface CentroPropioPort {

    /**
     * @param adminId id del usuario administrador
     * @return su centro, o vacío si todavía no creó uno
     */
    Optional<CentroPropio> buscarPorAdmin(UUID adminId);

    /**
     * @param adminId id del usuario administrador
     * @param nombre  nombre del centro
     * @param lat     latitud del centro; {@code null} si no se envió
     * @param lng     longitud del centro; {@code null} si no se envió
     * @return el centro registrado
     * @throws IllegalArgumentException si falta un dato o la coordenada está fuera de rango
     * @throws co.edu.escuelaing.nexovital.recursos.domain.exception.CentroYaRegistradoException
     *                                  si el administrador ya tiene un centro
     * @throws co.edu.escuelaing.nexovital.recursos.domain.exception.NombreCentroDuplicadoException
     *                                  si ya existe un centro con ese nombre
     */
    CentroPropio registrar(UUID adminId, String nombre, Double lat, Double lng);
}
