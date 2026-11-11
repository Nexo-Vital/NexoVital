package co.edu.escuelaing.nexovital.observabilidad.domain.port.out;

import co.edu.escuelaing.nexovital.observabilidad.domain.model.IndicadoresNegocio;

/**
 * Puerto de salida: lee de la base de datos los indicadores del tablero de
 * negocio (Sprint 2, T40, T41). Es una consulta de solo lectura; nunca modifica
 * los datos de otros módulos.
 */
public interface IndicadoresNegocioQueryPort {

    IndicadoresNegocio consultar();
}
