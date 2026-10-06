package co.edu.escuelaing.nexovital.recursos.domain.port.in;

import co.edu.escuelaing.nexovital.recursos.domain.model.ItemInventario;
import co.edu.escuelaing.nexovital.recursos.domain.model.MiCentro;
import co.edu.escuelaing.nexovital.recursos.domain.model.NuevoItemInventario;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * Puerto de entrada de la pantalla "Administrar mi centro" del administrador de
 * centro de ayuda: consultar su centro, crearlo con sus insumos y declarar
 * insumos nuevos.
 *
 * <p>Retirar unidades de un insumo NO vive aquí: es un despacho y usa
 * {@link DespacharStockUseCase}, con su descuento atómico (C1).
 */
public interface AdministrarMiCentroUseCase {

    /**
     * @param adminId id del usuario administrador
     * @return su centro con el inventario, o vacío si todavía no creó uno
     */
    Optional<MiCentro> consultar(UUID adminId);

    /**
     * Crea el centro del administrador con sus insumos iniciales, todo en una
     * sola transacción: o queda el centro con todos sus insumos, o no queda nada.
     *
     * @param adminId id del usuario administrador
     * @param nombre  nombre del centro
     * @param lat     latitud; {@code null} si no se envió
     * @param lng     longitud; {@code null} si no se envió
     * @param items   insumos a pedir; al menos uno, sin nombres repetidos
     * @return el centro creado con su inventario
     * @throws IllegalArgumentException si falta un dato o alguno no es válido
     * @throws co.edu.escuelaing.nexovital.recursos.domain.exception.CentroYaRegistradoException
     *                                  si el administrador ya tiene un centro
     * @throws co.edu.escuelaing.nexovital.recursos.domain.exception.NombreCentroDuplicadoException
     *                                  si ya existe un centro con ese nombre
     */
    MiCentro crear(UUID adminId, String nombre, Double lat, Double lng, List<NuevoItemInventario> items);

    /**
     * Declara un insumo nuevo en el centro del administrador.
     *
     * @param adminId id del usuario administrador
     * @param item    el insumo a declarar
     * @return el insumo creado
     * @throws IllegalArgumentException si falta un dato o alguno no es válido
     * @throws co.edu.escuelaing.nexovital.recursos.domain.exception.CentroPropioNoEncontradoException
     *                                  si el administrador no tiene centro
     * @throws co.edu.escuelaing.nexovital.recursos.domain.exception.ItemInventarioDuplicadoException
     *                                  si el centro ya declara un insumo con ese nombre
     */
    ItemInventario agregarItem(UUID adminId, NuevoItemInventario item);
}
