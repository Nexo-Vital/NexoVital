package co.edu.escuelaing.nexovital.recursos.domain.model;

import java.util.Objects;
import java.util.UUID;

/**
 * El centro que administra un usuario, visto desde {@code recursos}: identidad,
 * nombre y coordenada. Es la proyección que este módulo necesita del centro,
 * cuyo dueño es {@code usuarios}; no arrastra el tipo de ese módulo (frontera
 * de datos, ADR-0003).
 */
public record CentroPropio(UUID id, String nombre, double lat, double lng) {

    public CentroPropio {
        Objects.requireNonNull(id, "id is required");
        Objects.requireNonNull(nombre, "nombre is required");
    }
}
