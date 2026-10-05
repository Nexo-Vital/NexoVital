package co.edu.escuelaing.nexovital.mapa.domain.model;

/**
 * Tipo de emergencia que el ciudadano reporta (EP-02.F1.US3: "reporto la zona
 * indicando tipo de emergencia y ubicación"). Es una lista CERRADA: el front la
 * muestra como una casilla de selección y el servidor rechaza cualquier valor
 * que no esté aquí.
 *
 * <p>No reemplaza a {@link NivelEmergencia}: el tipo dice QUÉ pasa (una
 * inundación, un incendio) y el nivel dice QUÉ TAN GRAVE es. La
 * {@code descripcion} sigue siendo el comentario libre del ciudadano.
 *
 * <p>{@link #OTRO} existe para que una emergencia fuera del catálogo se pueda
 * reportar igual: el detalle lo lleva la descripción.
 */
public enum TipoEmergencia {
    INUNDACION,
    INCENDIO,
    DERRUMBE,
    SISMO,
    ACCIDENTE,
    OTRO
}
