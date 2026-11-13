package co.edu.escuelaing.nexovital.usuarios.infrastructure.adapter.out.firebase;

import co.edu.escuelaing.nexovital.usuarios.domain.model.IdentidadExterna;
import co.edu.escuelaing.nexovital.usuarios.domain.port.out.VerificadorIdentidadExterna;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;

/**
 * Implementación con Firebase del puerto de verificación de identidad. Existe
 * solo si Firebase está configurado, igual que {@link ValidadorTokenFirebase}:
 * sin IdP no hay registro con Google.
 */
@Component
@ConditionalOnProperty(name = "nexovital.auth.firebase.project-id")
public class VerificadorIdentidadFirebase implements VerificadorIdentidadExterna {

    private final ValidadorTokenFirebase validador;

    public VerificadorIdentidadFirebase(ValidadorTokenFirebase validador) {
        this.validador = validador;
    }

    @Override
    public IdentidadExterna verificar(String token) {
        return validador.validarIdentidad(token);
    }
}
