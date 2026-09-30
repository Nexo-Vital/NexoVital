package co.edu.escuelaing.nexovital.mapa.domain.port.out;

import co.edu.escuelaing.nexovital.mapa.domain.model.Emergencia;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * Puerto de salida de persistencia de emergencias (tabla privada del módulo
 * {@code mapa}). Devuelve el agregado de dominio {@link Emergencia}, nunca la
 * entidad JPA.
 */
public interface EmergenciaRepository {

    Emergencia guardar(Emergencia emergencia);

    /**
     * Busca una emergencia por su id: lo necesita el PATCH, que actualiza el
     * agregado existente y debe distinguir "no existe" (404) de "datos
     * inválidos" (400).
     *
     * @param id identificador del agregado
     * @return la emergencia con ese id, o vacío si no existe
     */
    Optional<Emergencia> buscarPorId(UUID id);

    /**
     * @return las emergencias registradas, de la más reciente a la más antigua
     */
    List<Emergencia> listar();
}
