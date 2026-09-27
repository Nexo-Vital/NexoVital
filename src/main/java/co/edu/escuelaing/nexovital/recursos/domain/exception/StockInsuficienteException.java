package co.edu.escuelaing.nexovital.recursos.domain.exception;

import java.util.UUID;

/**
 * The requested quantity exceeds the stock available at the moment of the
 * write. The controller translates it to {@code 409 STOCK_INSUFICIENTE}: C1
 * forbids over-allocation, so the request is rejected, never partially served.
 *
 * <p>It carries the center and the resource name, not just the item id: the
 * rejection branch raises the shortage alert and the alert has to NAME the
 * resource on the center and on the map (EP-03.F1.US5, Azure 225). Passing
 * only {@code (itemId, disponible, cantidad)} made that impossible.
 */
public class StockInsuficienteException extends RuntimeException {

    private final UUID centroAcopioId;
    private final UUID itemId;
    private final String nombre;
    private final int disponible;
    private final int cantidad;

    public StockInsuficienteException(UUID centroAcopioId, UUID itemId, String nombre, int disponible, int cantidad) {
        super("Insufficient stock for item " + itemId + " (" + nombre + ") at center " + centroAcopioId
                + ": available=" + disponible + ", requested=" + cantidad);
        this.centroAcopioId = centroAcopioId;
        this.itemId = itemId;
        this.nombre = nombre;
        this.disponible = disponible;
        this.cantidad = cantidad;
    }

    public UUID getCentroAcopioId() {
        return centroAcopioId;
    }

    public UUID getItemId() {
        return itemId;
    }

    public String getNombre() {
        return nombre;
    }

    public int getDisponible() {
        return disponible;
    }

    public int getCantidad() {
        return cantidad;
    }
}
