package co.edu.escuelaing.nexovital.auditoria.domain.port.in;

import co.edu.escuelaing.nexovital.auditoria.domain.model.FiltroBitacora;
import co.edu.escuelaing.nexovital.auditoria.domain.model.PeticionRegistrada;

import java.util.List;

/**
 * Consulta de la bitácora de peticiones (T15): por petición, usuario,
 * emergencia o centro.
 */
public interface ConsultarBitacoraUseCase {

    /** Límite por defecto cuando el llamante no lo indica. */
    int LIMITE_POR_DEFECTO = 100;

    /** Límite máximo: una consulta no puede traerse la tabla entera. */
    int LIMITE_MAXIMO = 1000;

    List<PeticionRegistrada> buscar(FiltroBitacora filtro);
}
