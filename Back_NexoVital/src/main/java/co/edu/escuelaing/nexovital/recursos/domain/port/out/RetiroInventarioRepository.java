package co.edu.escuelaing.nexovital.recursos.domain.port.out;

import co.edu.escuelaing.nexovital.recursos.domain.model.RetiroInventario;

import java.util.List;
import java.util.UUID;

/** Output port: the record of every withdrawal of stock. */
public interface RetiroInventarioRepository {

    RetiroInventario registrar(RetiroInventario retiro);

    /** Withdrawals of one item, newest first. */
    List<RetiroInventario> listarPorItem(UUID itemId);
}
