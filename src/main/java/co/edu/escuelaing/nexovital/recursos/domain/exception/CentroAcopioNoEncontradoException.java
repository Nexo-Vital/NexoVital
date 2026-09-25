package co.edu.escuelaing.nexovital.recursos.domain.exception;

import java.util.UUID;

/**
 * No organization exists with the given id. The controller translates it to
 * {@code 404} with the {@code {codigo, mensaje}} envelope, mirroring
 * {@code mapa}'s not-found exceptions.
 *
 * <p>The module owns the meaning of "not found": the cross-module port returns
 * a boolean and the domain decides, without leaking any JPA detail.
 */
public class CentroAcopioNoEncontradoException extends RuntimeException {

    public CentroAcopioNoEncontradoException(UUID id) {
        super("Aid center not found: " + id);
    }
}
