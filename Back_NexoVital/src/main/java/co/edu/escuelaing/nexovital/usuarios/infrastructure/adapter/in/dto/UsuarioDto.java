package co.edu.escuelaing.nexovital.usuarios.infrastructure.adapter.in.dto;

import co.edu.escuelaing.nexovital.usuarios.domain.model.RolUsuario;
import co.edu.escuelaing.nexovital.usuarios.domain.model.Usuario;

import java.util.UUID;

/**
 * Proyección pública de un usuario. No expone {@code passwordHash}.
 */
public record UsuarioDto(UUID id, String nombre, String email, RolUsuario rol) {

    public static UsuarioDto fromDomain(Usuario usuario) {
        return new UsuarioDto(usuario.getId(), usuario.getNombre(), usuario.getEmail(), usuario.getRol());
    }
}
