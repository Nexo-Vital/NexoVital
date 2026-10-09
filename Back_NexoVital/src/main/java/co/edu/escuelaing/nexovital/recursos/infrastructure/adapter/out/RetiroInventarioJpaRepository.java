package co.edu.escuelaing.nexovital.recursos.infrastructure.adapter.out;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.UUID;

/** Spring Data repository of the withdrawals. */
public interface RetiroInventarioJpaRepository extends JpaRepository<RetiroInventarioJpaEntity, UUID> {

    List<RetiroInventarioJpaEntity> findByItemIdOrderByRetiradoEnDesc(UUID itemId);
}
