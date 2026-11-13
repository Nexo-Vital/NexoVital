package co.edu.escuelaing.nexovital.infrastructure.config;

import co.edu.escuelaing.nexovital.usuarios.application.usecase.ResolutorSesionLocal;
import co.edu.escuelaing.nexovital.usuarios.domain.port.in.AuthenticationUseCase;
import co.edu.escuelaing.nexovital.usuarios.domain.port.in.ResolutorSesion;
import co.edu.escuelaing.nexovital.usuarios.domain.port.out.UsuarioRepository;
import co.edu.escuelaing.nexovital.usuarios.infrastructure.adapter.out.firebase.ResolutorSesionFirebase;
import co.edu.escuelaing.nexovital.usuarios.infrastructure.adapter.out.firebase.ValidadorTokenFirebase;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * Elige cómo se resuelve la sesión según haya o no IdP externo configurado.
 *
 * <p>Un solo bean, decidido en un solo lugar. Con
 * {@code nexovital.auth.firebase.project-id} presente se publica el resolutor de
 * Firebase (el bean {@link ValidadorTokenFirebase} solo existe en ese caso);
 * sin él, se sigue usando el login local, que es lo que necesitan el desarrollo
 * y la suite.
 */
@Configuration
public class AutenticacionConfig {

    @Bean
    public ResolutorSesion resolutorSesion(
            UsuarioRepository usuarioRepository,
            AuthenticationUseCase authenticationUseCase,
            ObjectProvider<ValidadorTokenFirebase> validadorFirebase) {

        ValidadorTokenFirebase firebase = validadorFirebase.getIfAvailable();
        if (firebase != null) {
            return new ResolutorSesionFirebase(firebase, usuarioRepository);
        }
        return new ResolutorSesionLocal(authenticationUseCase);
    }
}
