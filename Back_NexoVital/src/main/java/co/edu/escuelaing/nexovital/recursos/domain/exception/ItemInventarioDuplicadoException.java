package co.edu.escuelaing.nexovital.recursos.domain.exception;

/**
 * El centro ya declara un insumo con ese nombre. El controlador la traduce a
 * {@code 409 ITEM_INVENTARIO_DUPLICADO}.
 */
public class ItemInventarioDuplicadoException extends RuntimeException {

    public ItemInventarioDuplicadoException(String nombre) {
        super("El centro ya tiene un insumo llamado: " + nombre);
    }
}
