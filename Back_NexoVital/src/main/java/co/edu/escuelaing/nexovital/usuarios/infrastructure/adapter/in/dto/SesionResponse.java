package co.edu.escuelaing.nexovital.usuarios.infrastructure.adapter.in.dto;

/**
 * Respuesta de un login exitoso: {@code {token, usuario}}.
 */
public record SesionResponse(String token, UsuarioDto usuario) {
}
