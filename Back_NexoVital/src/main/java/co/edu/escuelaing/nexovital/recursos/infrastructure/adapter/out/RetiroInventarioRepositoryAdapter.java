package co.edu.escuelaing.nexovital.recursos.infrastructure.adapter.out;

import co.edu.escuelaing.nexovital.recursos.domain.model.RetiroInventario;
import co.edu.escuelaing.nexovital.recursos.domain.port.out.RetiroInventarioRepository;
import org.springframework.stereotype.Component;

import java.util.List;
import java.util.UUID;

/** Satisfies {@link RetiroInventarioRepository} with JPA. */
@Component
public class RetiroInventarioRepositoryAdapter implements RetiroInventarioRepository {

    private final RetiroInventarioJpaRepository jpaRepository;

    public RetiroInventarioRepositoryAdapter(RetiroInventarioJpaRepository jpaRepository) {
        this.jpaRepository = jpaRepository;
    }

    @Override
    public RetiroInventario registrar(RetiroInventario retiro) {
        return aDominio(jpaRepository.save(new RetiroInventarioJpaEntity(retiro.id(), retiro.centroAcopioId(),
                retiro.itemId(), retiro.cantidad(), retiro.motivo(), retiro.usuarioId(), retiro.retiradoEn())));
    }

    @Override
    public List<RetiroInventario> listarPorItem(UUID itemId) {
        return jpaRepository.findByItemIdOrderByRetiradoEnDesc(itemId).stream()
                .map(RetiroInventarioRepositoryAdapter::aDominio)
                .toList();
    }

    private static RetiroInventario aDominio(RetiroInventarioJpaEntity entity) {
        return new RetiroInventario(entity.getId(), entity.getCentroAcopioId(), entity.getItemId(),
                entity.getCantidad(), entity.getMotivo(), entity.getUsuarioId(), entity.getRetiradoEn());
    }
}
