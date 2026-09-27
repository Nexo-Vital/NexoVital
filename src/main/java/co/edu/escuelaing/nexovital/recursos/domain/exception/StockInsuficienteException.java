package co.edu.escuelaing.nexovital.recursos.domain.exception;

import java.util.UUID;

/**
 * The requested quantity exceeds the stock available at the moment of the
 * write. The controller translates it to {@code 409 STOCK_INSUFICIENTE}: C1
 * forbids over-allocation, so the request is rejected, never partially served.
 */
public class StockInsuficienteException extends RuntimeException {

    public StockInsuficienteException(UUID itemId, int disponible, int cantidad) {
        super("Insufficient stock for item " + itemId
                + ": available=" + disponible + ", requested=" + cantidad);
    }
}
