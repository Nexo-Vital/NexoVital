package co.edu.escuelaing.nexovital.mapa.domain.port.in;

import co.edu.escuelaing.nexovital.mapa.domain.model.Emergencia;
import co.edu.escuelaing.nexovital.mapa.domain.model.EstadoEmergencia;
import co.edu.escuelaing.nexovital.mapa.domain.model.NivelEmergencia;

import java.util.UUID;

/**
 * Puerto de entrada: actualizar el estado y/o el nivel de una emergencia. Una
 * intención por caso de uso.
 *
 * <p>Refleja el PATCH del contrato ({@code updateEmergencia}): los dos campos
 * son opcionales; un {@code null} significa "no cambies este campo". El
 * contrato no admite {@code ubicacion}, {@code descripcion} ni {@code zonaId},
 * así que no viajan por aquí (decisión D1 del ODD).
 */
public interface ActualizarEmergenciaUseCase {

    /**
     * Actualiza una emergencia existente.
     *
     * @param id     identificador de la emergencia a actualizar
     * @param estado nuevo estado, o {@code null} para conservarlo
     * @param nivel  nuevo nivel, o {@code null} para conservarlo
     * @return la emergencia persistida, ya actualizada
     * @throws IllegalArgumentException     si no viene ni {@code estado} ni
     *                                      {@code nivel} (no habría nada que
     *                                      actualizar)
     * @throws co.edu.escuelaing.nexovital.mapa.domain.exception.EmergenciaNoEncontradaException
     *                                      si no existe una emergencia con ese
     *                                      {@code id}
     */
    Emergencia actualizar(UUID id, EstadoEmergencia estado, NivelEmergencia nivel);
}
