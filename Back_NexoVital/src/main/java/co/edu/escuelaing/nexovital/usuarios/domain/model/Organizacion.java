package co.edu.escuelaing.nexovital.usuarios.domain.model;

import java.util.Objects;
import java.util.UUID;

/**
 * Agregado de una organización: un centro de ayuda o un centro de acopio.
 * Inmutable y sin dependencias de framework (no conoce Spring ni JPA), igual
 * que {@link Usuario}.
 *
 * <p>El inventario y el semáforo <b>no</b> forman parte de este agregado: son
 * del módulo {@code recursos} (EP-03), que aún no existe.
 */
public final class Organizacion {

    private final UUID id;
    private final String nombre;
    private final TipoOrganizacion tipo;
    private final String zonaId;
    private final Ubicacion ubicacion;
    /**
     * Usuario que administra el centro, o {@code null} cuando no tiene uno
     * asignado (los centros sembrados y los que crea el administrador de
     * plataforma). Es una referencia simple por id al usuario dueño.
     */
    private final UUID adminId;

    public Organizacion(UUID id, String nombre, TipoOrganizacion tipo, String zonaId, Ubicacion ubicacion) {
        this(id, nombre, tipo, zonaId, ubicacion, null);
    }

    public Organizacion(UUID id, String nombre, TipoOrganizacion tipo, String zonaId, Ubicacion ubicacion,
                        UUID adminId) {
        this.id = Objects.requireNonNull(id, "id es obligatorio");
        this.nombre = Objects.requireNonNull(nombre, "nombre es obligatorio");
        this.tipo = Objects.requireNonNull(tipo, "tipo es obligatorio");
        this.zonaId = zonaId;
        this.ubicacion = Objects.requireNonNull(ubicacion, "ubicacion es obligatoria");
        this.adminId = adminId;
    }

    public UUID getId() {
        return id;
    }

    public String getNombre() {
        return nombre;
    }

    public TipoOrganizacion getTipo() {
        return tipo;
    }

    /**
     * Identificador de la zona a la que pertenece la organización. La zona es
     * propiedad del módulo {@code mapa}; aquí se guarda como referencia simple
     * (no hay clave foránea entre módulos).
     *
     * <p><b>Es opcional</b> (decisión D2 de la tarea): el contrato OpenAPI no
     * exige {@code zonaId} al registrar una organización, así que un centro
     * puede quedar sin zona asignada. Puede devolver {@code null}.
     */
    public String getZonaId() {
        return zonaId;
    }

    public Ubicacion getUbicacion() {
        return ubicacion;
    }

    /** @return el usuario que administra el centro, o {@code null} si no tiene */
    public UUID getAdminId() {
        return adminId;
    }

    @Override
    public boolean equals(Object o) {
        if (this == o) {
            return true;
        }
        if (!(o instanceof Organizacion organizacion)) {
            return false;
        }
        return id.equals(organizacion.id);
    }

    @Override
    public int hashCode() {
        return Objects.hash(id);
    }
}
