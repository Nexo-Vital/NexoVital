package co.edu.escuelaing.nexovital.flota.domain.port.in;

/** Confirms the arrivals the citizen left unanswered past the allowed time. */
public interface ConfirmarLlegadasVencidasUseCase {

    /** @return how many requests this call confirmed */
    int confirmarVencidas();
}
