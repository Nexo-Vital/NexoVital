package co.edu.escuelaing.nexovital.usuarios.infrastructure.adapter.in.dto;

import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;

/**
 * Cuerpo de {@code POST /api/v1/sesiones}.
 */
public record SesionRequest(
        @NotBlank(message = "el email es obligatorio")
        @Email(message = "el email no tiene un formato válido")
        String email,

        @NotBlank(message = "la contraseña es obligatoria")
        String password) {
}
