package co.edu.escuelaing.nexovital.mapa.domain.port.out;

import co.edu.escuelaing.nexovital.mapa.domain.model.Emergencia;

import java.util.Optional;
import java.util.UUID;

/**
 * Puerto de salida: una emergencia registrada pide su ambulancia.
 *
 * <p>El modulo {@code mapa} no conoce {@code flota}: declara la intencion y el
 * adaptador de infraestructura la resuelve contra el caso de uso de solicitud.
 * Asi el disparador vive en el BACK (la alerta crea el primer servicio que la
 * atiende) sin acoplar los dos dominios.
 */
public interface DespachoAmbulanciaPort {

    /**
     * Pide una ambulancia para la emergencia recien registrada.
     *
     * @param emergencia   emergencia ya persistida; aporta el punto de recogida,
     *                     la zona de contexto y el id que la solicitud referencia
     * @param solicitanteId usuario autenticado que reporto la emergencia; la
     *                     solicitud se le entrega a el para que siga su ciclo
     * @param direccion    direccion legible del punto, o {@code null}
     * @return el id de la solicitud creada, o vacio cuando no hay ninguna unidad
     *         disponible en ese instante (la emergencia se conserva igual)
     */
    Optional<UUID> despachar(Emergencia emergencia, UUID solicitanteId, String direccion);
}
