package co.edu.escuelaing.nexovital.support;

import co.edu.escuelaing.nexovital.shared.domain.port.out.PushPort;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Primary;

import java.util.List;
import java.util.Map;
import java.util.concurrent.CopyOnWriteArrayList;

/**
 * Doble de test del {@code PushPort} que registra cada publicación en memoria.
 *
 * <p>Se marca {@code @Primary} para ganarle al adaptador real
 * ({@code PushPortPublicadorAdapter {publicar} -> PushMessage -> gateway}) sin
 * desactivarlo. Así la prueba ve exactamente el destino y el payload que el
 * listener post-commit publicó, sin depender de una sesión STOMP real ni del
 * broker.
 *
 * <p>Es el enfoque que la tarea deja elegir para verificar la emisión: inyectar
 * un doble del puerto y asertar destino y payload. Se prefiere al cliente STOMP
 * real (usado en {@code CanalTiempoRealDosSesionesTest}) porque aquí el objeto a
 * probar es <b>qué publica el módulo {@code usuarios}</b>, no cómo el canal lo
 * transporta; el transporte ya está probado end-to-end en S5.
 */
@TestConfiguration
public class PushPortDePruebaConfig {

    /**
     * Publicación capturada: el destino y la carga tal como los entregó el
     * módulo dueño.
     */
    public record PublicacionCapturada(String destino, Object payload) {
    }

    /**
     * Doble del puerto que acumula las publicaciones. Es thread-safe porque el
     * listener corre en el hilo del evento, tras el commit.
     */
    public static class PushPortDePrueba implements PushPort {

        private final List<PublicacionCapturada> publicaciones = new CopyOnWriteArrayList<>();

        @Override
        public void publicar(String destino, Object payload) {
            publicaciones.add(new PublicacionCapturada(destino, payload));
        }

        /** @return copia de las publicaciones, en orden. */
        public List<PublicacionCapturada> publicaciones() {
            return List.copyOf(publicaciones);
        }

        /**
         * @return la última publicación cuyo destino coincide, o {@code null} si
         *         no hay ninguna
         */
        public PublicacionCapturada ultimaHacia(String destino) {
            PublicacionCapturada encontrada = null;
            for (PublicacionCapturada publicacion : publicaciones) {
                if (destino.equals(publicacion.destino())) {
                    encontrada = publicacion;
                }
            }
            return encontrada;
        }

        /** Vacía el registro (cada test parte de cero). */
        public void limpiar() {
            publicaciones.clear();
        }

        /** @return el payload de una publicación como mapa, para leerlo clave a clave. */
        @SuppressWarnings("unchecked")
        public static Map<String, Object> comoMapa(PublicacionCapturada publicacion) {
            return (Map<String, Object>) publicacion.payload();
        }
    }

    @Bean
    @Primary
    public PushPortDePrueba pushPortDePrueba() {
        return new PushPortDePrueba();
    }
}
