package co.edu.escuelaing.nexovital.auditoria.infrastructure.adapter.out.geo;

import java.math.BigInteger;
import java.net.InetAddress;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Lector mínimo del formato MaxMind DB ({@code .mmdb}), versión 2, el de
 * GeoLite2-Country.
 *
 * <p><b>Por qué propio y no la librería de MaxMind.</b> Lo único que se
 * necesita es el código de país de una IP, y el formato es público y pequeño
 * (árbol binario de búsqueda + sección de datos). Escribir el lector evita una
 * dependencia nueva solo para eso. Implementa la especificación en
 * https://maxmind.github.io/MaxMind-DB/: árboles de 24, 28 y 32 bits, bases IPv4
 * e IPv6 (con IPv4 dentro de {@code ::/96}) y todos los tipos de dato.
 *
 * <p>Carga el archivo completo en memoria (GeoLite2-Country ocupa unos 9 MB) y
 * es seguro para varios hilos: después de construido solo se lee.
 */
public final class LectorMmdb {

    private static final byte[] MARCA_METADATOS =
            {(byte) 0xAB, (byte) 0xCD, (byte) 0xEF, 'M', 'a', 'x', 'M', 'i', 'n', 'd', '.', 'c', 'o', 'm'};

    private static final int SEPARADOR_DATOS = 16;

    private static final int TIPO_PUNTERO = 1;
    private static final int TIPO_TEXTO = 2;
    private static final int TIPO_DOUBLE = 3;
    private static final int TIPO_BYTES = 4;
    private static final int TIPO_UINT16 = 5;
    private static final int TIPO_UINT32 = 6;
    private static final int TIPO_MAPA = 7;
    private static final int TIPO_INT32 = 8;
    private static final int TIPO_UINT64 = 9;
    private static final int TIPO_UINT128 = 10;
    private static final int TIPO_ARREGLO = 11;
    private static final int TIPO_BOOLEANO = 14;
    private static final int TIPO_FLOAT = 15;

    private final byte[] datos;
    private final int cantidadNodos;
    private final int tamanoRegistro;
    private final int versionIp;
    private final int inicioDatos;
    private final int nodoInicioIpv4;

    public LectorMmdb(byte[] datos) {
        this.datos = datos;
        int inicioMetadatos = buscarMetadatos(datos);
        Object decodificado = new Decodificador(inicioMetadatos).decodificar(inicioMetadatos).valor();
        if (!(decodificado instanceof Map<?, ?> metadatos)) {
            throw new IllegalArgumentException("metadatos de MaxMind DB inválidos");
        }
        this.cantidadNodos = entero(metadatos, "node_count");
        this.tamanoRegistro = entero(metadatos, "record_size");
        this.versionIp = entero(metadatos, "ip_version");
        if (tamanoRegistro != 24 && tamanoRegistro != 28 && tamanoRegistro != 32) {
            throw new IllegalArgumentException("tamaño de registro no soportado: " + tamanoRegistro);
        }
        int tamanoArbol = (tamanoRegistro * 2 / 8) * cantidadNodos;
        this.inicioDatos = tamanoArbol + SEPARADOR_DATOS;
        this.nodoInicioIpv4 = calcularNodoIpv4();
    }

    /**
     * Datos de la IP (un mapa, en GeoLite2 con {@code country.iso_code}), o
     * {@code null} si la base no tiene datos para ella.
     */
    public Object buscar(InetAddress direccion) {
        byte[] bytes = direccion.getAddress();
        if (bytes.length == 16 && versionIp == 4) {
            return null;
        }
        int nodo = bytes.length == 4 && versionIp == 6 ? nodoInicioIpv4 : 0;
        int bits = bytes.length * 8;
        for (int i = 0; i < bits && nodo < cantidadNodos; i++) {
            int bit = (bytes[i >> 3] >> (7 - (i & 7))) & 1;
            nodo = leerRegistro(nodo, bit);
        }
        if (nodo <= cantidadNodos) {
            // Igual a cantidadNodos: "sin datos". Menor: IP más corta que el árbol.
            return null;
        }
        int desplazamiento = nodo - cantidadNodos - SEPARADOR_DATOS;
        return new Decodificador(inicioDatos).decodificar(inicioDatos + desplazamiento).valor();
    }

    /**
     * Código ISO del país de la IP: {@code country.iso_code} y, si no está,
     * {@code registered_country.iso_code}. {@code null} si no hay datos.
     */
    public String paisDe(InetAddress direccion) {
        Object registro = buscar(direccion);
        if (!(registro instanceof Map<?, ?> mapa)) {
            return null;
        }
        String pais = isoDe(mapa.get("country"));
        return pais != null ? pais : isoDe(mapa.get("registered_country"));
    }

    private static String isoDe(Object pais) {
        if (pais instanceof Map<?, ?> mapa && mapa.get("iso_code") instanceof String iso) {
            return iso;
        }
        return null;
    }

    private int calcularNodoIpv4() {
        if (versionIp != 6) {
            return 0;
        }
        // Las IPv4 viven en ::/96: 96 bits en cero desde la raíz.
        int nodo = 0;
        for (int i = 0; i < 96 && nodo < cantidadNodos; i++) {
            nodo = leerRegistro(nodo, 0);
        }
        return nodo;
    }

    private int leerRegistro(int nodo, int lado) {
        return switch (tamanoRegistro) {
            case 24 -> {
                int base = nodo * 6 + lado * 3;
                yield entero3(base);
            }
            case 28 -> {
                int base = nodo * 7;
                int medio = datos[base + 3] & 0xFF;
                yield lado == 0
                        ? ((medio & 0xF0) << 20) | entero3(base)
                        : ((medio & 0x0F) << 24) | entero3(base + 4);
            }
            default -> {
                int base = nodo * 8 + lado * 4;
                yield (int) sinSigno(base, 4).longValue();
            }
        };
    }

    private int entero3(int base) {
        return ((datos[base] & 0xFF) << 16) | ((datos[base + 1] & 0xFF) << 8) | (datos[base + 2] & 0xFF);
    }

    private BigInteger sinSigno(int desde, int tamano) {
        BigInteger valor = BigInteger.ZERO;
        for (int i = 0; i < tamano; i++) {
            valor = valor.shiftLeft(8).or(BigInteger.valueOf(datos[desde + i] & 0xFF));
        }
        return valor;
    }

    private static int buscarMetadatos(byte[] datos) {
        for (int i = datos.length - MARCA_METADATOS.length; i >= 0; i--) {
            boolean coincide = true;
            for (int j = 0; j < MARCA_METADATOS.length; j++) {
                if (datos[i + j] != MARCA_METADATOS[j]) {
                    coincide = false;
                    break;
                }
            }
            if (coincide) {
                return i + MARCA_METADATOS.length;
            }
        }
        throw new IllegalArgumentException("el archivo no es una base MaxMind DB");
    }

    private static int entero(Map<?, ?> metadatos, String clave) {
        Object valor = metadatos.get(clave);
        if (valor instanceof Number numero) {
            return numero.intValue();
        }
        throw new IllegalArgumentException("falta " + clave + " en los metadatos");
    }

    /** Valor decodificado y la posición donde sigue el siguiente. */
    private record Leido(Object valor, int siguiente) {
    }

    /** Decodificador de la sección de datos; los punteros son relativos a {@code base}. */
    private final class Decodificador {

        private final int base;

        Decodificador(int base) {
            this.base = base;
        }

        Leido decodificar(int posicion) {
            int control = datos[posicion++] & 0xFF;
            int tipo = control >>> 5;
            if (tipo == TIPO_PUNTERO) {
                return puntero(control, posicion);
            }
            if (tipo == 0) {
                tipo = 7 + (datos[posicion++] & 0xFF);
            }
            int tamano = control & 0x1F;
            if (tamano == 29) {
                tamano = 29 + (datos[posicion++] & 0xFF);
            } else if (tamano == 30) {
                tamano = 285 + sinSigno(posicion, 2).intValue();
                posicion += 2;
            } else if (tamano == 31) {
                tamano = 65_821 + sinSigno(posicion, 3).intValue();
                posicion += 3;
            }
            return valor(tipo, tamano, posicion);
        }

        private Leido puntero(int control, int posicion) {
            int tamano = (control >>> 3) & 0x3;
            int bajos = control & 0x7;
            long destino = switch (tamano) {
                case 0 -> ((long) bajos << 8) | (datos[posicion] & 0xFF);
                case 1 -> (((long) bajos << 16) | sinSigno(posicion, 2).longValue()) + 2048;
                case 2 -> (((long) bajos << 24) | sinSigno(posicion, 3).longValue()) + 526_336;
                default -> sinSigno(posicion, 4).longValue();
            };
            Object valor = decodificar(base + (int) destino).valor();
            return new Leido(valor, posicion + tamano + 1);
        }

        private Leido valor(int tipo, int tamano, int posicion) {
            return switch (tipo) {
                case TIPO_TEXTO -> new Leido(new String(datos, posicion, tamano, StandardCharsets.UTF_8),
                        posicion + tamano);
                case TIPO_DOUBLE -> new Leido(Double.longBitsToDouble(sinSigno(posicion, 8).longValue()),
                        posicion + 8);
                case TIPO_FLOAT -> new Leido(Float.intBitsToFloat(sinSigno(posicion, 4).intValue()),
                        posicion + 4);
                case TIPO_BYTES -> {
                    byte[] copia = new byte[tamano];
                    System.arraycopy(datos, posicion, copia, 0, tamano);
                    yield new Leido(copia, posicion + tamano);
                }
                case TIPO_UINT16, TIPO_UINT32 -> new Leido(sinSigno(posicion, tamano).longValue(),
                        posicion + tamano);
                case TIPO_INT32 -> new Leido(sinSigno(posicion, tamano).intValue(), posicion + tamano);
                case TIPO_UINT64, TIPO_UINT128 -> new Leido(sinSigno(posicion, tamano), posicion + tamano);
                case TIPO_BOOLEANO -> new Leido(tamano != 0, posicion);
                case TIPO_MAPA -> mapa(tamano, posicion);
                case TIPO_ARREGLO -> arreglo(tamano, posicion);
                default -> throw new IllegalArgumentException("tipo de dato MaxMind no soportado: " + tipo);
            };
        }

        private Leido mapa(int pares, int posicion) {
            Map<String, Object> mapa = new LinkedHashMap<>();
            for (int i = 0; i < pares; i++) {
                Leido clave = decodificar(posicion);
                Leido valor = decodificar(clave.siguiente());
                mapa.put(String.valueOf(clave.valor()), valor.valor());
                posicion = valor.siguiente();
            }
            return new Leido(mapa, posicion);
        }

        private Leido arreglo(int elementos, int posicion) {
            List<Object> lista = new ArrayList<>(elementos);
            for (int i = 0; i < elementos; i++) {
                Leido elemento = decodificar(posicion);
                lista.add(elemento.valor());
                posicion = elemento.siguiente();
            }
            return new Leido(lista, posicion);
        }
    }
}
