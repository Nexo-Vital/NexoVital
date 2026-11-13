package co.edu.escuelaing.nexovital.auditoria.infrastructure.adapter.out.geo;

import co.edu.escuelaing.nexovital.auditoria.domain.port.out.GeolocalizadorIp;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.net.Inet6Address;
import java.net.InetAddress;
import java.net.UnknownHostException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.regex.Pattern;

/**
 * País de una IP a partir de la base GeoLite2-Country de MaxMind (S-2).
 *
 * <p>La ruta del archivo va en {@code nexovital.bitacora.geoip.ruta}
 * (variable {@code NEXOVITAL_GEOIP_RUTA}). Si no se configura, o el archivo no
 * existe o está dañado, la aplicación arranca igual y el país queda
 * {@link #PAIS_DESCONOCIDO}: la bitácora nunca deja de registrar por esto. El
 * archivo no va en el repositorio porque la licencia de GeoLite2 no permite
 * redistribuirlo.
 *
 * <p>Las IP privadas y de loopback (Docker, la red local, {@code 127.0.0.1})
 * se marcan {@link #PAIS_RED_LOCAL} sin consultar la base.
 */
@Component
public class GeolocalizadorMaxMind implements GeolocalizadorIp {

    private static final Logger LOG = LoggerFactory.getLogger(GeolocalizadorMaxMind.class);

    /**
     * Solo se aceptan IP literales. Sin este filtro, un texto como
     * {@code ejemplo.com} haría que {@link InetAddress#getByName} consultara el
     * DNS desde el hilo de la bitácora.
     */
    private static final Pattern IP_LITERAL = Pattern.compile("[0-9A-Fa-f:.]{2,45}");

    private static final int MAX_CACHE = 10_000;

    private final LectorMmdb lector;
    private final Map<String, String> cache = new ConcurrentHashMap<>();

    @Autowired
    public GeolocalizadorMaxMind(@Value("${nexovital.bitacora.geoip.ruta:}") String ruta) {
        this.lector = cargar(ruta);
    }

    /** Para pruebas: con un lector ya construido, o {@code null} sin base. */
    public GeolocalizadorMaxMind(LectorMmdb lector) {
        this.lector = lector;
    }

    /** Si hay base de países cargada. */
    public boolean conBase() {
        return lector != null;
    }

    @Override
    public String paisDe(String ip) {
        if (ip == null || ip.isBlank() || !IP_LITERAL.matcher(ip).matches()) {
            return PAIS_DESCONOCIDO;
        }
        String enCache = cache.get(ip);
        if (enCache != null) {
            return enCache;
        }
        String pais = resolver(ip);
        if (cache.size() < MAX_CACHE) {
            cache.put(ip, pais);
        }
        return pais;
    }

    private String resolver(String ip) {
        InetAddress direccion;
        try {
            direccion = InetAddress.getByName(ip);
        } catch (UnknownHostException e) {
            return PAIS_DESCONOCIDO;
        }
        if (esLocal(direccion)) {
            return PAIS_RED_LOCAL;
        }
        if (lector == null) {
            return PAIS_DESCONOCIDO;
        }
        try {
            String pais = lector.paisDe(direccion);
            return pais == null ? PAIS_DESCONOCIDO : pais;
        } catch (RuntimeException e) {
            LOG.debug("No se pudo resolver el pais de {}", ip, e);
            return PAIS_DESCONOCIDO;
        }
    }

    private static boolean esLocal(InetAddress direccion) {
        if (direccion.isLoopbackAddress() || direccion.isSiteLocalAddress()
                || direccion.isLinkLocalAddress() || direccion.isAnyLocalAddress()) {
            return true;
        }
        // IPv6 de red local única (fc00::/7), que Java no marca como site-local.
        return direccion instanceof Inet6Address && (direccion.getAddress()[0] & 0xFE) == 0xFC;
    }

    private static LectorMmdb cargar(String ruta) {
        if (ruta == null || ruta.isBlank()) {
            LOG.info("bitacora_geoip sin base de paises (NEXOVITAL_GEOIP_RUTA vacia): el pais quedara {}",
                    PAIS_DESCONOCIDO);
            return null;
        }
        try {
            LectorMmdb lector = new LectorMmdb(Files.readAllBytes(Path.of(ruta)));
            LOG.info("bitacora_geoip base de paises cargada desde {}", ruta);
            return lector;
        } catch (IOException | RuntimeException e) {
            LOG.warn("bitacora_geoip no se pudo cargar {}: el pais quedara {}", ruta, PAIS_DESCONOCIDO, e);
            return null;
        }
    }
}
