package co.edu.escuelaing.nexovital.mapa.domain.port.out;

import co.edu.escuelaing.nexovital.mapa.domain.model.Emergencia;

/**
 * Puerto de salida de persistencia de emergencias (tabla privada del módulo
 * {@code mapa}). Devuelve el agregado de dominio {@link Emergencia}, nunca la
 * entidad JPA.
 */
public interface EmergenciaRepository {

    Emergencia guardar(Emergencia emergencia);
}
