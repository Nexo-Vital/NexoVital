package co.edu.escuelaing.nexovital.usuarios.domain.port.out;

import co.edu.escuelaing.nexovital.usuarios.domain.exception.CredencialesInvalidasException;
import co.edu.escuelaing.nexovital.usuarios.domain.model.IdentidadExterna;

/**
 * Verifica un token del proveedor de identidad externo y devuelve lo que afirma
 * sobre su dueño. Solo hay implementación cuando el IdP está configurado
 * ({@code nexovital.auth.firebase.project-id}).
 */
public interface VerificadorIdentidadExterna {

    /**
     * @throws CredencialesInvalidasException si el token no verifica (firma,
     *                                        emisor, audiencia o expiración)
     */
    IdentidadExterna verificar(String token);
}
