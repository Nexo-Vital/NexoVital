package co.edu.escuelaing.nexovital.flota.application.usecase;

import co.edu.escuelaing.nexovital.flota.domain.event.ConexionUnidadEvent;
import co.edu.escuelaing.nexovital.flota.domain.model.Ambulancia;
import co.edu.escuelaing.nexovital.flota.domain.port.out.AmbulanciaRepository;
import co.edu.escuelaing.nexovital.shared.domain.port.out.PushPort;
import org.springframework.stereotype.Component;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;

import java.util.UUID;

/**
 * Delivers a connection change to {@code /topic/flota} ALWAYS after commit
 * (EP-04.F2.US1, D2), so every map knows which units can receive a request.
 *
 * <p>The frame has the shape of the state frame of {@link FlotaPushListener}
 * ({@code ambulanciaId}, {@code estado}, {@code version}) plus {@code conectada}.
 * It is a snapshot of the row as it is after the commit: the three values are
 * read together, and {@code version} lets the consumer discard the frame if it
 * already holds a newer one.
 *
 * <p>The state and position frames do not carry {@code conectada}: neither a
 * state change nor a position report changes the connection, so the consumer
 * keeps the value it has.
 */
@Component
public class ConexionPushListener {

    private final PushPort pushPort;
    private final AmbulanciaRepository ambulanciaRepository;

    public ConexionPushListener(PushPort pushPort, AmbulanciaRepository ambulanciaRepository) {
        this.pushPort = pushPort;
        this.ambulanciaRepository = ambulanciaRepository;
    }

    /** A unit that can no longer be read is skipped: there is nothing to tell. */
    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    public void alCambiarConexion(ConexionUnidadEvent evento) {
        ambulanciaRepository.buscarPorId(evento.ambulanciaId())
                .map(ConexionPushPayload::desde)
                .ifPresent(payload -> pushPort.publicar(FlotaPushListener.DESTINO_FLOTA, payload));
    }

    /**
     * Public projection of a connection change. {@code estado} is the domain
     * literal, as in the state frame.
     */
    public record ConexionPushPayload(UUID ambulanciaId, String estado, boolean conectada, long version) {

        static ConexionPushPayload desde(Ambulancia ambulancia) {
            return new ConexionPushPayload(
                    ambulancia.getId(),
                    ambulancia.getEstado().name(),
                    ambulancia.isConectada(),
                    ambulancia.getVersion());
        }
    }
}
