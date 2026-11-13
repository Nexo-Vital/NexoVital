package co.edu.escuelaing.nexovital.auditoria.infrastructure.adapter.in;

import jakarta.servlet.http.HttpServletRequest;

/**
 * IP del cliente con el mismo criterio que el limitador de solicitudes y el
 * registro de rechazos: la primera entrada de {@code X-Forwarded-For}, que es
 * la que escribe nginx con {@code $remote_addr} (el cliente no la puede
 * falsear porque nginx la reemplaza), o la dirección de la conexión si no hay
 * proxy delante.
 */
public final class IpCliente {

    static final String CABECERA = "X-Forwarded-For";

    private IpCliente() {
        // Utilidad.
    }

    public static String de(HttpServletRequest request) {
        return de(request.getHeader(CABECERA), request.getRemoteAddr());
    }

    public static String de(String reenviada, String direccionConexion) {
        if (reenviada != null && !reenviada.isBlank()) {
            return recortar(reenviada.split(",")[0].trim());
        }
        return recortar(direccionConexion);
    }

    private static String recortar(String ip) {
        if (ip == null) {
            return null;
        }
        return ip.length() > 64 ? ip.substring(0, 64) : ip;
    }
}
