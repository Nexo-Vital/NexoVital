package co.edu.escuelaing.nexovital.mapa.infrastructure.adapter.out;

import co.edu.escuelaing.nexovital.flota.domain.exception.AmbulanciaNoDisponibleException;
import co.edu.escuelaing.nexovital.flota.domain.model.SolicitudAmbulancia;
import co.edu.escuelaing.nexovital.flota.domain.port.in.SolicitarAmbulanciaUseCase;
import co.edu.escuelaing.nexovital.mapa.domain.model.Emergencia;
import co.edu.escuelaing.nexovital.mapa.domain.port.out.DespachoAmbulanciaPort;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

import java.util.Optional;
import java.util.UUID;

/**
 * Adaptador del puerto {@link DespachoAmbulanciaPort}: traduce la emergencia a
 * una solicitud del modulo {@code flota}.
 *
 * <p><b>Por que existe.</b> El disparador del despacho tiene que estar en el
 * backend: el front reporta la emergencia y el servidor decide. Antes, el front
 * hacia una segunda llamada a {@code POST /solicitudes} y la decision quedaba de
 * su lado.
 *
 * <p><b>Sin unidades disponibles la emergencia no se pierde.</b> La solicitud
 * lanza {@link AmbulanciaNoDisponibleException} antes de escribir nada; aqui se
 * captura y se devuelve vacio, de modo que la transaccion del reporte commitea
 * con la emergencia registrada. Nunca se descarta un reporte ciudadano.
 */
@Component
public class DespachoAmbulanciaAdapter implements DespachoAmbulanciaPort {

    private static final Logger LOG = LoggerFactory.getLogger(DespachoAmbulanciaAdapter.class);

    private final SolicitarAmbulanciaUseCase solicitarAmbulanciaUseCase;

    public DespachoAmbulanciaAdapter(SolicitarAmbulanciaUseCase solicitarAmbulanciaUseCase) {
        this.solicitarAmbulanciaUseCase = solicitarAmbulanciaUseCase;
    }

    @Override
    public Optional<UUID> despachar(Emergencia emergencia, UUID solicitanteId, String direccion) {
        try {
            SolicitudAmbulancia solicitud = solicitarAmbulanciaUseCase.solicitar(
                    emergencia.getUbicacion().lat(),
                    emergencia.getUbicacion().lng(),
                    emergencia.getId(),
                    null,
                    emergencia.getZonaId(),
                    solicitanteId,
                    // El servidor fija la ventana de aceptacion con su propio reloj.
                    null,
                    direccion);
            return Optional.of(solicitud.getId());
        } catch (AmbulanciaNoDisponibleException e) {
            LOG.warn("Emergencia {} registrada sin despacho: no hay unidades disponibles.",
                    emergencia.getId());
            return Optional.empty();
        }
    }
}
