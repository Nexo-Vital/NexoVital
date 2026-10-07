package co.edu.escuelaing.nexovital.flota.domain.port.in;

/**
 * Detects the units that stopped reporting their position (EP-04.F1.US1,
 * scenario 4): a unit that goes longer than the threshold (30 s by default)
 * without a report is marked "sin señal" and keeps its last known position.
 *
 * <p>It is the server, never the frontend, that decides a unit lost its signal:
 * every connected user must see the same thing.
 */
public interface DetectarSenalPerdidaUseCase {

    /**
     * Marks every unit whose last report is older than the threshold and
     * publishes one signal-loss notice per unit marked, after commit.
     *
     * @return how many units were marked by this call
     */
    int detectar();
}
