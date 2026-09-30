package co.edu.escuelaing.nexovital.flota.infrastructure.adapter.in.dto;

/**
 * Body of {@code POST /api/v1/flota/ambulancias/{id}/posicion}: where the unit
 * is. The position reuses the same {@link UbicacionDto} projection the fleet
 * read returns, so the front maps it with no new shape.
 *
 * <p>{@code heading} is optional telemetry (degrees clockwise from north); the
 * source is NOT in the body: the route always reports a device position, so a
 * client cannot claim to be the simulator.
 */
public record ReportarPosicionRequest(UbicacionDto ubicacion, Integer heading) {
}
