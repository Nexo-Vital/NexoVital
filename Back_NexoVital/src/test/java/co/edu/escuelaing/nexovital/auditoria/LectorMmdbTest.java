package co.edu.escuelaing.nexovital.auditoria;

import co.edu.escuelaing.nexovital.auditoria.domain.port.out.GeolocalizadorIp;
import co.edu.escuelaing.nexovital.auditoria.infrastructure.adapter.out.geo.GeolocalizadorMaxMind;
import co.edu.escuelaing.nexovital.auditoria.infrastructure.adapter.out.geo.LectorMmdb;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

import java.io.IOException;
import java.io.InputStream;
import java.net.InetAddress;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * T16: el país de la bitácora. Las bases de {@code src/test/resources/geoip}
 * tienen datos inventados (ver {@code generar_bases_prueba.py}) y cubren los
 * tres tamaños de registro del formato y las bases IPv4 e IPv6.
 */
class LectorMmdbTest {

    @ParameterizedTest(name = "{0}")
    @ValueSource(strings = {"pais-ipv6-24.mmdb", "pais-ipv6-28.mmdb", "pais-ipv6-32.mmdb", "pais-ipv4-24.mmdb"})
    @DisplayName("Resuelve el pais de una IPv4 en cada formato de arbol")
    void resuelveIpv4(String archivo) throws Exception {
        LectorMmdb lector = lector(archivo);

        assertEquals("CO", lector.paisDe(InetAddress.getByName("190.24.1.1")));
        assertEquals("US", lector.paisDe(InetAddress.getByName("8.8.8.8")));
        // Solo trae registered_country: se usa como respaldo.
        assertEquals("ES", lector.paisDe(InetAddress.getByName("200.1.2.3")));
        // Sin datos para esa red.
        assertNull(lector.paisDe(InetAddress.getByName("9.9.9.9")));
    }

    @ParameterizedTest(name = "{0}")
    @ValueSource(strings = {"pais-ipv6-24.mmdb", "pais-ipv6-28.mmdb", "pais-ipv6-32.mmdb"})
    @DisplayName("Resuelve el pais de una IPv6")
    void resuelveIpv6(String archivo) throws Exception {
        LectorMmdb lector = lector(archivo);

        assertEquals("CO", lector.paisDe(InetAddress.getByName("2800:e2:1::1")));
        assertNull(lector.paisDe(InetAddress.getByName("2001:db8::1")));
    }

    @Test
    @DisplayName("Una IPv6 en una base solo IPv4 no tiene pais")
    void ipv6EnBaseIpv4() throws Exception {
        assertNull(lector("pais-ipv4-24.mmdb").paisDe(InetAddress.getByName("2800:e2:1::1")));
    }

    @Test
    @DisplayName("Un archivo que no es MaxMind DB se rechaza al cargar")
    void archivoInvalido() {
        assertThrows(IllegalArgumentException.class, () -> new LectorMmdb(new byte[]{1, 2, 3, 4}));
    }

    @Test
    @DisplayName("El geolocalizador marca LOCAL las IP privadas y de loopback sin consultar la base")
    void ipLocales() throws Exception {
        GeolocalizadorIp geo = new GeolocalizadorMaxMind(lector("pais-ipv6-24.mmdb"));

        for (String ip : new String[]{"127.0.0.1", "10.1.2.3", "172.18.0.5", "192.168.1.10", "::1", "fd00::1"}) {
            assertEquals(GeolocalizadorIp.PAIS_RED_LOCAL, geo.paisDe(ip), ip);
        }
        assertEquals("CO", geo.paisDe("190.24.1.1"));
        assertEquals(GeolocalizadorIp.PAIS_DESCONOCIDO, geo.paisDe("9.9.9.9"));
    }

    @Test
    @DisplayName("Sin base, un texto raro o nulo, el pais es DESCONOCIDO y nunca falla")
    void sinBaseYEntradasRaras() {
        GeolocalizadorMaxMind sinBase = new GeolocalizadorMaxMind((LectorMmdb) null);
        assertFalse(sinBase.conBase());
        assertEquals(GeolocalizadorIp.PAIS_DESCONOCIDO, sinBase.paisDe("190.24.1.1"));
        assertEquals(GeolocalizadorIp.PAIS_RED_LOCAL, sinBase.paisDe("127.0.0.1"));

        // Un nombre de host no se resuelve por DNS: se descarta antes.
        assertEquals(GeolocalizadorIp.PAIS_DESCONOCIDO, sinBase.paisDe("ejemplo.com"));
        assertEquals(GeolocalizadorIp.PAIS_DESCONOCIDO, sinBase.paisDe(null));
        assertEquals(GeolocalizadorIp.PAIS_DESCONOCIDO, sinBase.paisDe(""));
    }

    @Test
    @DisplayName("Una ruta vacia o inexistente arranca sin base, sin romper la aplicacion")
    void rutaVaciaOInexistente() {
        assertFalse(new GeolocalizadorMaxMind("").conBase());
        assertFalse(new GeolocalizadorMaxMind("/no/existe/GeoLite2-Country.mmdb").conBase());
        assertTrue(new GeolocalizadorMaxMind("src/test/resources/geoip/pais-ipv6-24.mmdb").conBase());
    }

    private static LectorMmdb lector(String archivo) throws IOException {
        try (InputStream entrada = LectorMmdbTest.class.getResourceAsStream("/geoip/" + archivo)) {
            assertNotNull(entrada, "falta la base de prueba " + archivo);
            return new LectorMmdb(entrada.readAllBytes());
        }
    }
}
