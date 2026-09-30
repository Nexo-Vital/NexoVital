package co.edu.escuelaing.nexovital.usuarios.infrastructure.adapter.out;

import co.edu.escuelaing.nexovital.usuarios.domain.exception.UsuarioNoEncontradoException;
import co.edu.escuelaing.nexovital.usuarios.domain.model.EstadoIntentos;
import co.edu.escuelaing.nexovital.usuarios.domain.port.out.EstadoIntentosPort;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.Optional;
import java.util.UUID;

/**
 * Adaptador del estado de intentos fallidos. Cada método abre su propia
 * transacción: el invariante de conteo se apoya en la sentencia atómica del
 * repositorio (diseño D6), no en una transacción larga que abarque el login.
 */
@Component
public class EstadoIntentosAdapter implements EstadoIntentosPort {

    private final UsuarioJpaRepository jpaRepository;

    public EstadoIntentosAdapter(UsuarioJpaRepository jpaRepository) {
        this.jpaRepository = jpaRepository;
    }

    @Override
    @Transactional(readOnly = true)
    public Optional<EstadoIntentos> buscar(UUID usuarioId) {
        return jpaRepository.findById(usuarioId).map(EstadoIntentosAdapter::toDomain);
    }

    @Override
    @Transactional
    public EstadoIntentos registrarFallo(UUID usuarioId, Instant limite, int maxIntentos) {
        jpaRepository.registrarIntentoFallido(usuarioId, limite, maxIntentos);
        // Lectura posterior al UPDATE: la decisión de bloquear ya se tomó en la
        // sentencia atómica; esto solo reporta el estado resultante.
        return jpaRepository.findById(usuarioId)
                .map(EstadoIntentosAdapter::toDomain)
                .orElseThrow(() -> new UsuarioNoEncontradoException(usuarioId));
    }

    @Override
    @Transactional
    public void reiniciar(UUID usuarioId) {
        jpaRepository.reiniciarIntentos(usuarioId);
    }

    private static EstadoIntentos toDomain(UsuarioJpaEntity entity) {
        return new EstadoIntentos(entity.getIntentosFallidos(), entity.getBloqueadoHasta());
    }
}
