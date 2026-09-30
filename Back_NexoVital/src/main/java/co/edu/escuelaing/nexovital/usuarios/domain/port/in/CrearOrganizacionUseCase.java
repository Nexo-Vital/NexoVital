package co.edu.escuelaing.nexovital.usuarios.domain.port.in;

import co.edu.escuelaing.nexovital.usuarios.domain.model.Organizacion;
import co.edu.escuelaing.nexovital.usuarios.domain.model.TipoOrganizacion;
import co.edu.escuelaing.nexovital.usuarios.domain.model.Ubicacion;

/**
 * Puerto de entrada: registrar una organización (centro de ayuda o centro de
 * acopio). El servidor asigna el {@code id}; {@code zonaId} es opcional
 * (decisión D2) porque el contrato OpenAPI no lo exige.
 */
public interface CrearOrganizacionUseCase {

    /**
     * Registra una organización nueva.
     *
     * @param nombre    nombre único de la organización; obligatorio
     * @param tipo      tipo canónico; obligatorio
     * @param ubicacion coordenada del centro; obligatoria
     * @param zonaId    zona a la que pertenece; opcional, puede ser {@code null}
     * @return la organización persistida, ya con su {@code id} asignado
     * @throws IllegalArgumentException     si {@code nombre}, {@code tipo} o
     *                                      {@code ubicacion} faltan o están en blanco
     * @throws co.edu.escuelaing.nexovital.usuarios.domain.exception.OrganizacionDuplicadaException
     *                                      si ya existe una organización con ese nombre
     */
    Organizacion crear(String nombre, TipoOrganizacion tipo, Ubicacion ubicacion, String zonaId);
}
