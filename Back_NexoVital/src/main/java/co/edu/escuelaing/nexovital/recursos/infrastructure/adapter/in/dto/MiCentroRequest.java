package co.edu.escuelaing.nexovital.recursos.infrastructure.adapter.in.dto;

import java.util.List;

/**
 * Cuerpo de {@code POST /api/v1/centros-acopio/mio}:
 * {@code {nombre, ubicacion: {lat, lng}, items: [{nombre, disponible, requerido}]}}.
 *
 * <p>Los campos son envoltorios a propósito, igual que en
 * {@code OrganizacionRequest}: un campo ausente llega como {@code null} y se
 * rechaza con un mensaje que lo nombra.
 */
public record MiCentroRequest(String nombre, UbicacionRequest ubicacion, List<NuevoItemRequest> items) {

    /** Ubicación del cuerpo: {@code {lat, lng}}. */
    public record UbicacionRequest(Double lat, Double lng) {
    }
}
