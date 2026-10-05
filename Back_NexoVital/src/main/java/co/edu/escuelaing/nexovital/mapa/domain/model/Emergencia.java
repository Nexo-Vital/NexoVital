package co.edu.escuelaing.nexovital.mapa.domain.model;

import co.edu.escuelaing.nexovital.usuarios.domain.model.Ubicacion;

import java.time.Instant;
import java.util.Objects;
import java.util.UUID;

/**
 * Agregado de una emergencia reportada sobre el mapa: el punto afectado, su
 * tipo, su severidad y su descripción. Inmutable y sin dependencias de framework, igual
 * que {@link Zona} y
 * {@link co.edu.escuelaing.nexovital.usuarios.domain.model.Organizacion}.
 *
 * <p>La historia habla de "reportar una zona afectada", pero el contrato modela
 * la emergencia como un PUNTO ({@code ubicacion}), no como un polígono. La zona
 * (área) no se crea ni la decide el cliente: se DERIVA del punto con
 * {@link Zona#contiene(Ubicacion)} y se guarda como {@code zonaId} de contexto.
 *
 * <p>{@code zonaId} es NULLABLE a propósito: un punto que no cae en ninguna
 * localidad del catálogo se acepta igual. No es geometría inválida, es una zona
 * fuera del catálogo (decisión D4 del diseño).
 *
 * <p>Los campos que asigna el servidor son {@code id}, {@code estado} y
 * {@code createdAt}; los que viajan en la petición son {@code ubicacion},
 * {@code tipo}, {@code nivel} y {@code descripcion} ({@code POST /emergencias}).
 *
 * <p>{@code tipo} se fija al reportar y NO cambia después: el PATCH solo
 * corrige estado y nivel, igual que no mueve la ubicación.
 */
public final class Emergencia {

    private final UUID id;
    private final Ubicacion ubicacion;
    private final TipoEmergencia tipo;
    private final NivelEmergencia nivel;
    private final EstadoEmergencia estado;
    private final String descripcion;
    private final String zonaId;
    private final Instant createdAt;

    public Emergencia(UUID id,
                      Ubicacion ubicacion,
                      TipoEmergencia tipo,
                      NivelEmergencia nivel,
                      EstadoEmergencia estado,
                      String descripcion,
                      String zonaId,
                      Instant createdAt) {
        this.id = Objects.requireNonNull(id, "id es obligatorio");
        this.ubicacion = Objects.requireNonNull(ubicacion, "ubicacion es obligatoria");
        this.tipo = Objects.requireNonNull(tipo, "tipo es obligatorio");
        this.nivel = Objects.requireNonNull(nivel, "nivel es obligatorio");
        this.estado = Objects.requireNonNull(estado, "estado es obligatorio");
        this.descripcion = Objects.requireNonNull(descripcion, "descripcion es obligatoria");
        // Contexto derivado: null cuando el punto cae fuera de todo el catálogo.
        this.zonaId = zonaId;
        this.createdAt = Objects.requireNonNull(createdAt, "createdAt es obligatorio");
    }

    public UUID getId() {
        return id;
    }

    /** Punto afectado reportado; la zona (área) se deriva de él. */
    public Ubicacion getUbicacion() {
        return ubicacion;
    }

    /** Qué está pasando (lista cerrada); se fija al reportar. */
    public TipoEmergencia getTipo() {
        return tipo;
    }

    public NivelEmergencia getNivel() {
        return nivel;
    }

    public EstadoEmergencia getEstado() {
        return estado;
    }

    public String getDescripcion() {
        return descripcion;
    }

    /**
     * Zona resuelta por punto-en-polígono, o {@code null} si el punto cae fuera
     * de todas las localidades del catálogo. Es contexto, no una clave foránea.
     */
    public String getZonaId() {
        return zonaId;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }

    /**
     * Devuelve una instancia NUEVA con el estado cambiado y el resto de los
     * campos intactos. La emergencia original no se toca: el agregado es
     * inmutable (decisión D4 del ODD).
     *
     * @param nuevoEstado estado del contrato; no puede ser {@code null}
     * @return una emergencia nueva con el estado indicado
     */
    public Emergencia conEstado(EstadoEmergencia nuevoEstado) {
        return con(nuevoEstado, this.nivel);
    }

    /**
     * Devuelve una instancia NUEVA con el nivel cambiado y el resto de los
     * campos intactos. La emergencia original no se toca: el agregado es
     * inmutable (decisión D4 del ODD).
     *
     * @param nuevoNivel severidad del contrato; no puede ser {@code null}
     * @return una emergencia nueva con el nivel indicado
     */
    public Emergencia conNivel(NivelEmergencia nuevoNivel) {
        return con(this.estado, nuevoNivel);
    }

    /**
     * Devuelve una instancia NUEVA con estado y nivel cambiados <b>a la vez</b>.
     * Es la forma que el caso de uso usa cuando el PATCH trae los dos campos:
     * se construye UNA sola instancia, no una intermedia por campo (el resto de
     * los campos — {@code id}, {@code ubicacion}, {@code tipo}, {@code descripcion},
     * {@code zonaId}, {@code createdAt} — se conserva tal cual, porque mover una
     * emergencia cambiaría su zona y está fuera de alcance).
     *
     * @param nuevoEstado estado del contrato; no puede ser {@code null}
     * @param nuevoNivel  severidad del contrato; no puede ser {@code null}
     * @return una emergencia nueva con el estado y el nivel indicados
     */
    public Emergencia con(EstadoEmergencia nuevoEstado, NivelEmergencia nuevoNivel) {
        return new Emergencia(
                id,
                ubicacion,
                tipo,
                nuevoNivel,
                nuevoEstado,
                descripcion,
                zonaId,
                createdAt);
    }

    @Override
    public boolean equals(Object o) {
        if (this == o) {
            return true;
        }
        if (!(o instanceof Emergencia emergencia)) {
            return false;
        }
        return id.equals(emergencia.id);
    }

    @Override
    public int hashCode() {
        return Objects.hash(id);
    }
}
