package co.edu.escuelaing.nexovital.flota.application.usecase;

import co.edu.escuelaing.nexovital.flota.domain.model.Ambulancia;
import co.edu.escuelaing.nexovital.flota.domain.model.SolicitudAmbulancia;
import co.edu.escuelaing.nexovital.flota.domain.port.in.IncorporarUnidadASolicitudesAbiertasUseCase;
import co.edu.escuelaing.nexovital.flota.domain.port.out.AmbulanciaRepository;
import co.edu.escuelaing.nexovital.flota.domain.port.out.SolicitudRepository;
import org.springframework.dao.ConcurrencyFailureException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;

import java.time.Clock;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * Adds a unit that has just become eligible to the requests that are still open
 * (EP-04.F2.US1).
 *
 * <p><b>Its own transactions.</b> This runs after the commit of the operation
 * that made the unit eligible (finishing a service, declaring itself available,
 * connecting, recovering the signal). At that point the original transaction is
 * already committed, so every step here opens a NEW one
 * ({@code PROPAGATION_REQUIRES_NEW}); joining the finished transaction would
 * write nothing.
 *
 * <p><b>One transaction per request.</b> Each request is changed in its own
 * transaction, so a request that moves at the same instant does not undo the
 * others.
 *
 * <p><b>Race with accept, cancel and expiry.</b> Those three are conditional
 * UPDATEs that also bump the row version. Adding a unit is a versioned write on
 * the same row, so exactly one of the two applies first:
 * <ul>
 *   <li>the request moved first: this write finds a different version and
 *       fails. The request is read again and is no longer open, so the unit is
 *       not added;</li>
 *   <li>this write went first: the request is still PENDIENTE and the other
 *       operation proceeds normally, now with one more notified unit.</li>
 * </ul>
 * Either way a request is never reopened and its state is never overwritten.
 *
 * <p><b>Two units at the same instant.</b> Two units that become eligible
 * together both write on the same request, and only one versioned write can
 * apply. A write that fails is therefore not discarded: the request is read
 * again and the write is tried once more, a bounded number of times. The fresh
 * read decides: a request that is no longer open is left alone, and a request
 * that only gained another unit receives this one too. No unit is left out
 * because another one arrived at the same time.
 *
 * <p><b>The window is not extended.</b> Only the notified units change; the
 * request keeps its original {@code timeoutEn}.
 *
 * <p>Being notified is not the guarantee of anything: the accept still decides
 * the winner with its own conditional UPDATEs.
 */
@Service
public class IncorporarUnidadASolicitudesAbiertasUseCaseImpl
        implements IncorporarUnidadASolicitudesAbiertasUseCase {

    /**
     * Attempts per request. Each failed attempt means another writer changed the
     * request in between; with a handful of units becoming eligible at once this
     * is far more than enough, and the bound keeps the listener from spinning.
     */
    private static final int INTENTOS_POR_SOLICITUD = 5;

    private final AmbulanciaRepository ambulanciaRepository;
    private final SolicitudRepository solicitudRepository;
    private final TransactionTemplate enNuevaTransaccion;
    private final Clock clock;

    public IncorporarUnidadASolicitudesAbiertasUseCaseImpl(AmbulanciaRepository ambulanciaRepository,
                                                           SolicitudRepository solicitudRepository,
                                                           PlatformTransactionManager transactionManager,
                                                           Clock clock) {
        this.ambulanciaRepository = ambulanciaRepository;
        this.solicitudRepository = solicitudRepository;
        this.enNuevaTransaccion = new TransactionTemplate(transactionManager);
        this.enNuevaTransaccion.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
        this.clock = clock;
    }

    @Override
    public List<SolicitudAmbulancia> incorporar(UUID ambulanciaId) {
        List<SolicitudAmbulancia> abiertas = enNuevaTransaccion.execute(estado -> {
            boolean elegible = ambulanciaRepository.buscarPorId(ambulanciaId)
                    .map(Ambulancia::puedeRecibirSolicitudes)
                    .orElse(false);
            if (!elegible) {
                return List.<SolicitudAmbulancia>of();
            }
            return solicitudRepository.listarPendientesNoNotificadasA(ambulanciaId, Instant.now(clock));
        });

        List<SolicitudAmbulancia> incorporadas = new ArrayList<>();
        if (abiertas == null) {
            return incorporadas;
        }
        for (SolicitudAmbulancia abierta : abiertas) {
            incorporarConReintento(abierta.getId(), ambulanciaId).ifPresent(incorporadas::add);
        }
        return incorporadas;
    }

    /**
     * Adds the unit to one request, each attempt in its own transaction. A
     * concurrency failure means the request changed between the read and the
     * write of that attempt, so the next attempt starts from a fresh read.
     */
    private Optional<SolicitudAmbulancia> incorporarConReintento(UUID solicitudId, UUID ambulanciaId) {
        for (int intento = 0; intento < INTENTOS_POR_SOLICITUD; intento++) {
            try {
                Optional<SolicitudAmbulancia> incorporada = enNuevaTransaccion.execute(estado ->
                        solicitudRepository.incorporarNotificadaSiSigueAbierta(
                                solicitudId, ambulanciaId, Instant.now(clock)));
                // Empty: the request is no longer open, or the unit is already
                // notified. Either way there is nothing left to do.
                return incorporada == null ? Optional.empty() : incorporada;
            } catch (ConcurrencyFailureException cambio) {
                // Someone else wrote on the request first: read it again.
            }
        }
        return Optional.empty();
    }
}
