package co.edu.escuelaing.nexovital.auditoria.domain.port.out;

import co.edu.escuelaing.nexovital.auditoria.domain.model.FiltroBitacora;
import co.edu.escuelaing.nexovital.auditoria.domain.model.PeticionRegistrada;

import java.util.List;

/**
 * Puerto de salida de la bitácora de peticiones.
 *
 * <p>Igual que {@link RegistroAuditoriaPort}: solo agregar y leer. No hay
 * actualizar ni borrar.
 */
public interface BitacoraPeticionesPort {

    /**
     * Encola la petición para escribirla en el siguiente lote. No bloquea al
     * llamante ni toca la base en su hilo.
     */
    void registrar(PeticionRegistrada peticion);

    /** Peticiones que cumplen el filtro, de la más reciente a la más antigua. */
    List<PeticionRegistrada> buscar(FiltroBitacora filtro);
}
