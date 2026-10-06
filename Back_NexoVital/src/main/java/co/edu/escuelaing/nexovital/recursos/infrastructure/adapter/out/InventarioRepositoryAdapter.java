package co.edu.escuelaing.nexovital.recursos.infrastructure.adapter.out;

import co.edu.escuelaing.nexovital.recursos.domain.model.ItemInventario;
import co.edu.escuelaing.nexovital.recursos.domain.port.out.InventarioRepository;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * Adaptador de persistencia del inventario. Traduce entre el agregado de
 * dominio {@link ItemInventario} y la entidad JPA; el dominio nunca ve JPA.
 *
 * <p>El crédito es atómico en la base (ver
 * {@link ItemInventarioJpaRepository#acreditar}); este adaptador solo valida la
 * cantidad y traduce el conteo de filas a un booleano.
 */
@Component
public class InventarioRepositoryAdapter implements InventarioRepository {

    private final ItemInventarioJpaRepository jpaRepository;

    public InventarioRepositoryAdapter(ItemInventarioJpaRepository jpaRepository) {
        this.jpaRepository = jpaRepository;
    }

    @Override
    public List<ItemInventario> listarPorCentro(UUID centroAcopioId) {
        return jpaRepository.findByCentroAcopioIdOrderByNombreAsc(centroAcopioId).stream()
                .map(InventarioRepositoryAdapter::toDomain)
                .toList();
    }

    @Override
    public List<ItemInventario> listarTodos() {
        return jpaRepository.findAll().stream()
                .map(InventarioRepositoryAdapter::toDomain)
                .toList();
    }

    @Override
    public Optional<ItemInventario> buscar(UUID centroAcopioId, UUID itemId) {
        return jpaRepository.findByIdAndCentroAcopioId(itemId, centroAcopioId)
                .map(InventarioRepositoryAdapter::toDomain);
    }

    @Override
    @Transactional
    public boolean acreditar(UUID centroAcopioId, UUID itemId, int cantidad) {
        if (cantidad < 1) {
            throw new IllegalArgumentException("cantidad must be >= 1: " + cantidad);
        }
        return jpaRepository.acreditar(centroAcopioId, itemId, cantidad) > 0;
    }

    @Override
    @Transactional
    public int acreditarSiCabe(UUID centroAcopioId, UUID itemId, int cantidad) {
        if (cantidad < 1) {
            throw new IllegalArgumentException("cantidad must be >= 1: " + cantidad);
        }
        return jpaRepository.acreditarSiCabe(centroAcopioId, itemId, cantidad);
    }

    @Override
    @Transactional
    public int transicionAtomicaDespacho(UUID centroAcopioId, UUID itemId, int cantidad) {
        if (cantidad < 1) {
            throw new IllegalArgumentException("cantidad must be >= 1: " + cantidad);
        }
        return jpaRepository.transicionAtomicaDespacho(centroAcopioId, itemId, cantidad);
    }

    @Override
    @Transactional
    public ItemInventario guardar(ItemInventario item) {
        ItemInventarioJpaEntity entity = new ItemInventarioJpaEntity(
                item.getId(),
                item.getCentroAcopioId(),
                item.getNombre(),
                item.getDisponible(),
                item.getRequerido(),
                item.getUnidad(),
                item.getUnitDetail());
        return toDomain(jpaRepository.save(entity));
    }

    @Override
    public boolean existePorNombre(UUID centroAcopioId, String nombre) {
        return jpaRepository.existsByCentroAcopioIdAndNombreIgnoreCase(centroAcopioId, nombre);
    }

    private static ItemInventario toDomain(ItemInventarioJpaEntity entity) {
        return new ItemInventario(
                entity.getId(),
                entity.getCentroAcopioId(),
                entity.getNombre(),
                entity.getDisponible(),
                entity.getRequerido(),
                entity.getUnidad(),
                entity.getUnitDetail());
    }
}
