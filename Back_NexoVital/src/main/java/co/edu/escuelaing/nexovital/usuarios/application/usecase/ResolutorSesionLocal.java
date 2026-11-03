package co.edu.escuelaing.nexovital.usuarios.application.usecase;

import co.edu.escuelaing.nexovital.usuarios.domain.model.Usuario;
import co.edu.escuelaing.nexovital.usuarios.domain.port.in.AuthenticationUseCase;
import co.edu.escuelaing.nexovital.usuarios.domain.port.in.ResolutorSesion;

/**
 * Resolución local: valida el token HS256 que firma la propia aplicación.
 *
 * <p>Se conserva mientras el IdP externo no esté activo (desarrollo y tests).
 * Cuando {@code nexovital.auth.firebase.project-id} está configurado, el bean
 * que se publica es el de Firebase y este queda sin uso.
 */
public class ResolutorSesionLocal implements ResolutorSesion {

    private final AuthenticationUseCase authenticationUseCase;

    public ResolutorSesionLocal(AuthenticationUseCase authenticationUseCase) {
        this.authenticationUseCase = authenticationUseCase;
    }

    @Override
    public Usuario resolver(String token) {
        return authenticationUseCase.validarToken(token);
    }
}
