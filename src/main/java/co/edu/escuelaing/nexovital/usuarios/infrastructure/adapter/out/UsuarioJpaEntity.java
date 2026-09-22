package co.edu.escuelaing.nexovital.usuarios.infrastructure.adapter.out;

import co.edu.escuelaing.nexovital.usuarios.domain.model.RolUsuario;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

import java.time.Instant;
import java.util.UUID;

/**
 * Entidad JPA de la tabla {@code usuarios}. Es un detalle de persistencia: el
 * agregado de dominio es {@code Usuario} y no la conoce.
 *
 * <p>Las columnas {@code intentos_fallidos} y {@code bloqueado_hasta} viven en
 * esta tabla pero fuera del agregado (diseño D4). Se modifican con sentencias
 * atómicas, no con setters de Java.
 */
@Entity
@Table(name = "usuarios")
public class UsuarioJpaEntity {

    @Id
    private UUID id;

    @Column(nullable = false, length = 120)
    private String nombre;

    @Column(nullable = false, unique = true, length = 255)
    private String email;

    @Column(name = "password_hash", nullable = false, length = 255)
    private String passwordHash;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 40)
    private RolUsuario rol;

    @Column(name = "intentos_fallidos", nullable = false)
    private int intentosFallidos;

    @Column(name = "bloqueado_hasta")
    private Instant bloqueadoHasta;

    protected UsuarioJpaEntity() {
        // Requerido por JPA.
    }

    public UsuarioJpaEntity(UUID id, String nombre, String email, String passwordHash, RolUsuario rol) {
        this.id = id;
        this.nombre = nombre;
        this.email = email;
        this.passwordHash = passwordHash;
        this.rol = rol;
        this.intentosFallidos = 0;
        this.bloqueadoHasta = null;
    }

    public UUID getId() {
        return id;
    }

    public String getNombre() {
        return nombre;
    }

    public String getEmail() {
        return email;
    }

    public String getPasswordHash() {
        return passwordHash;
    }

    public RolUsuario getRol() {
        return rol;
    }

    public int getIntentosFallidos() {
        return intentosFallidos;
    }

    public Instant getBloqueadoHasta() {
        return bloqueadoHasta;
    }
}
