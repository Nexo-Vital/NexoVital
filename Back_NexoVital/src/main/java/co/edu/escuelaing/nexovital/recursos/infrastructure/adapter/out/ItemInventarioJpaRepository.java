package co.edu.escuelaing.nexovital.recursos.infrastructure.adapter.out;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * Repositorio Spring Data del inventario. El orden por nombre es una decisión
 * de la consulta, no del consumidor, para que la respuesta sea determinista.
 */
public interface ItemInventarioJpaRepository extends JpaRepository<ItemInventarioJpaEntity, UUID> {

    List<ItemInventarioJpaEntity> findByCentroAcopioIdOrderByNombreAsc(UUID centroAcopioId);

    Optional<ItemInventarioJpaEntity> findByIdAndCentroAcopioId(UUID id, UUID centroAcopioId);

    boolean existsByCentroAcopioIdAndNombreIgnoreCase(UUID centroAcopioId, String nombre);

    /**
     * Crédito atómico: UNA sola sentencia {@code UPDATE}, sin leer la entidad.
     * Dos donaciones concurrentes no pueden perder una actualización porque la
     * base aplica {@code disponible = disponible + :cantidad} de forma atómica.
     *
     * <p>{@code clearAutomatically} descarta la entidad cacheada en el contexto
     * de persistencia, de modo que una lectura posterior vea el stock ya
     * acreditado.
     *
     * @return número de filas actualizadas: 1 si el item existía en el centro,
     *         0 si no
     */
    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Query("UPDATE ItemInventarioJpaEntity i SET i.disponible = i.disponible + :cantidad "
            + "WHERE i.id = :itemId AND i.centroAcopioId = :centroAcopioId")
    int acreditar(@Param("centroAcopioId") UUID centroAcopioId,
                  @Param("itemId") UUID itemId,
                  @Param("cantidad") int cantidad);

    /**
     * Crédito acotado: UNA sola sentencia {@code UPDATE} condicionada a que la
     * cantidad todavía quepa en lo que falta ({@code requerido - disponible}).
     * Dos donantes concurrentes jamás pueden pasar el requerido: el
     * {@code WHERE} hace el check-and-set atómico.
     *
     * @return 1 si la cantidad cabía y se acreditó, 0 si ya no cabía o el item
     *         no está en ese centro
     */
    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Query("UPDATE ItemInventarioJpaEntity i SET i.disponible = i.disponible + :cantidad "
            + "WHERE i.id = :itemId AND i.centroAcopioId = :centroAcopioId "
            + "AND i.requerido - i.disponible >= :cantidad")
    int acreditarSiCabe(@Param("centroAcopioId") UUID centroAcopioId,
                        @Param("itemId") UUID itemId,
                        @Param("cantidad") int cantidad);

    /**
     * CAS real del stock finito C1: UNA sola {@code UPDATE} condicionada a que
     * el {@code disponible} siga cubriendo la cantidad. Devuelve filas
     * afectadas: 1 = este llamador se llevó el stock, 0 = el stock ya no
     * alcanzaba (o el item no está en ese centro).
     *
     * <p>El {@code WHERE i.disponible >= :cantidad} hace el check-and-set
     * atómico: dos despachos concurrentes jamás pueden llevarse más stock del
     * que hay, así que el stock nunca queda negativo <b>por construcción</b>.
     *
     * <p>A diferencia del backend de referencia, este modelo NO tiene columna
     * {@code version}: el incremento de versión de allá es de su modelo, no un
     * requisito del invariante, y agregar la columna obligaría a una migración
     * que el {@code validate} de producción exigiría. La condición del
     * {@code WHERE} es toda la garantía.
     *
     * <p>{@code clearAutomatically} descarta la entidad cacheada, de modo que
     * una lectura posterior vea el stock ya descontado.
     *
     * @return número de filas actualizadas: 1 si este llamador tomó el stock, 0
     *         si no alcanzaba
     */
    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Query("UPDATE ItemInventarioJpaEntity i SET i.disponible = i.disponible - :cantidad "
            + "WHERE i.id = :itemId AND i.centroAcopioId = :centroAcopioId "
            + "AND i.disponible >= :cantidad")
    int transicionAtomicaDespacho(@Param("centroAcopioId") UUID centroAcopioId,
                                  @Param("itemId") UUID itemId,
                                  @Param("cantidad") int cantidad);
}
