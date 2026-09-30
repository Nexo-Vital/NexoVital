package co.edu.escuelaing.nexovital.recursos.infrastructure.adapter.in.dto;

import java.util.UUID;

/**
 * Cuerpo de {@code POST /api/v1/centros-acopio/{id}/inventario/donacion}:
 * {@code {itemId, cantidad}}.
 *
 * <p>{@code cantidad} es un envoltorio ({@link Integer}) a propósito: una
 * cantidad ausente o nula llega como {@code null} y el controlador la rechaza
 * con el envelope de error, en vez de que un primitivo la enmascare como
 * {@code 0}. {@code itemId} también puede venir ausente y se rechaza igual.
 */
public record DonacionRequest(UUID itemId, Integer cantidad) {
}
