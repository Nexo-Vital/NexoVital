package co.edu.escuelaing.nexovital;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.util.Map;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

class IdentificadorInstanciaTest {

    @AfterEach
    void limpiar() {
        System.clearProperty(IdentificadorInstancia.PROPIEDAD);
    }

    @Test
    @DisplayName("Con NEXOVITAL_INSTANCIA_ID no se genera nada: manda la variable del compose")
    void respetaElIdExplicito() {
        assertEquals(Optional.empty(), IdentificadorInstancia.generado(
                Map.of("NEXOVITAL_INSTANCIA_ID", "backend-1", "HOSTNAME", "abc")));
    }

    @Test
    @DisplayName("Dos replicas con el mismo HOSTNAME (Azure express) reciben ids distintos")
    void replicasConElMismoHostnameNoComparten() {
        Map<String, String> azure = Map.of("HOSTNAME", "adc-sandbox");
        String una = IdentificadorInstancia.generado(azure).orElseThrow();
        String otra = IdentificadorInstancia.generado(azure).orElseThrow();
        assertTrue(una.startsWith("adc-sandbox-"), una);
        assertNotEquals(una, otra);
    }

    @Test
    @DisplayName("Sin HOSTNAME ni id explicito usa 'local' como base")
    void sinHostname() {
        assertTrue(IdentificadorInstancia.generado(Map.of("NEXOVITAL_INSTANCIA_ID", " "))
                .orElseThrow().startsWith("local-"));
    }

    @Test
    @DisplayName("fijarSiFalta publica el id una sola vez para todo el proceso")
    void fijaUnaSolaVez() {
        IdentificadorInstancia.fijarSiFalta(Map.of("HOSTNAME", "adc-sandbox"));
        String primero = System.getProperty(IdentificadorInstancia.PROPIEDAD);
        IdentificadorInstancia.fijarSiFalta(Map.of("HOSTNAME", "adc-sandbox"));
        assertTrue(primero.startsWith("adc-sandbox-"), primero);
        assertEquals(primero, System.getProperty(IdentificadorInstancia.PROPIEDAD));
    }
}
