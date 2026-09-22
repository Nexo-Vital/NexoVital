package co.edu.escuelaing.nexovital.usuarios.domain.model;

/**
 * Roles canónicos del sistema. Se persisten como texto
 * ({@code @Enumerated(EnumType.STRING)}) y son la base de la autoridad
 * {@code ROLE_<ROL>} que expone la seguridad.
 */
public enum RolUsuario {
    CIUDADANO,
    ADMIN_PLATAFORMA,
    ADMIN_CENTRO_AYUDA,
    ADMIN_ACOPIO,
    CONDUCTOR
}
