package co.edu.escuelaing.nexovital.recursos.infrastructure.adapter.in.dto;

import java.util.UUID;

/**
 * Body of {@code POST /api/v1/centros-acopio/{id}/inventario/despacho}:
 * {@code {itemId, cantidad}}, the shape the OpenAPI contract fixes.
 *
 * <p>It is a record of its own, NOT a reuse of {@code DonacionRequest}:
 * dispatching is not donating. {@code cantidad} is a wrapper on purpose, so a
 * missing quantity arrives as {@code null} and the controller rejects it
 * explicitly instead of a primitive masking it as {@code 0}.
 */
public record DespachoRequest(UUID itemId, Integer cantidad) {
}
