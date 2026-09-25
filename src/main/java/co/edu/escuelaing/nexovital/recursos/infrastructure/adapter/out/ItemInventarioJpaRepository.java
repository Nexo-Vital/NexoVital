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
}
