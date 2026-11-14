#!/usr/bin/env bash
# ==========================================================================
# T35 · Seguimiento de un evento a través de las dos instancias.
#
# 1. Reporta una emergencia por nginx con un X-Request-Id elegido (el traceId).
#    nginx la manda a una de las dos instancias: esa es el ORIGEN.
# 2. El origen publica el evento en RabbitMQ (push_publicado) y las DOS
#    instancias lo entregan a sus clientes (push_entregado ... origen=...).
# 3. Filtra los logs de backend-1 y backend-2 por el traceId y reconstruye el
#    recorrido; además lo cruza con la bitácora de peticiones (T13–T16).
#
# Uso (desde la raíz del repo, con el compose de pruebas arriba, porque usa el
# login local):
#   docker compose -f docker-compose.yml -f docker-compose.pruebas.yml up -d
#   deploy/probar-seguimiento.sh
#
# Deja una emergencia de prueba en la base ("Prueba T35 ...").
# ==========================================================================
set -uo pipefail

BASE="${BASE_URL:-http://localhost:8080}"
cd "$(dirname "$0")/.."

login() {
  curl -s -X POST "$BASE/api/v1/sesiones" -H 'Content-Type: application/json' \
    -d "{\"email\":\"$1\",\"password\":\"$2\"}" | sed -n 's/.*"token":"\([^"]*\)".*/\1/p'
}

TOKEN_CIUDADANO="$(login ciudadano@nexovital.co ciudadano123)"
TOKEN_ADMIN="$(login admin@nexovital.co admin123)"
if [ -z "$TOKEN_CIUDADANO" ] || [ -z "$TOKEN_ADMIN" ]; then
  echo "No se pudo iniciar sesión. ¿Está arriba el compose con docker-compose.pruebas.yml?" >&2
  exit 1
fi

TRAZA="t35-$(date +%Y%m%d%H%M%S)-$RANDOM"
echo "traceId elegido: $TRAZA"
echo

estado=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/v1/emergencias" \
  -H "Authorization: Bearer $TOKEN_CIUDADANO" -H 'Content-Type: application/json' \
  -H "X-Request-Id: $TRAZA" \
  -d "{\"ubicacion\":{\"lat\":4.7110,\"lng\":-74.0721},\"tipo\":\"OTRO\",\"nivel\":\"BAJO\",\"descripcion\":\"Prueba T35 $TRAZA\",\"direccion\":\"Prueba de seguimiento\"}")
echo "POST /api/v1/emergencias -> $estado"
if [ "$estado" != "201" ] && [ "$estado" != "200" ]; then
  echo "La emergencia no se creó (¿límite T18 de 10 por minuto?). Espera un minuto y repite." >&2
  exit 1
fi

# El log y la bitácora se escriben de forma asíncrona: unos segundos de margen.
sleep 4

lineas="$(docker compose logs --no-color --since 5m backend-1 backend-2 2>/dev/null | grep -F "$TRAZA")"

echo
echo "===== Recorrido en los logs (filtrados por traceId) ====="
if [ -z "$lineas" ]; then
  echo "(ninguna línea)"
else
  # En el perfil docker cada línea es JSON: se muestra servicio, hora y mensaje.
  printf '%s\n' "$lineas" | sed -E \
    's/^([a-z0-9-]*backend-[12])[^|]*\|.*"@timestamp":"([^"]*)".*"message":"([^"]*)".*/\1  \2  \3/'
fi

origen="$(printf '%s\n' "$lineas" | grep 'push_publicado' | sed -n 's/.*push_publicado instancia=\(backend-[12]\).*/\1/p' | head -1)"
if [ "$origen" = "backend-1" ]; then otra="backend-2"; else otra="backend-1"; fi

echo
echo "===== Bitácora de peticiones (GET /api/v1/auditoria/peticiones?traceId=...) ====="
bitacora="$(curl -s -H "Authorization: Bearer $TOKEN_ADMIN" "$BASE/api/v1/auditoria/peticiones?traceId=$TRAZA")"
printf '%s\n' "$bitacora" | grep -o '"metodo":"[^"]*","ruta":"[^"]*","estado":[0-9]*' | head -5
printf '%s\n' "$bitacora" | grep -o '"instancia":"[^"]*"' | head -5

echo
echo "===== Verificación ====="
ok=1
if [ -n "$origen" ]; then
  echo "✔ $origen atendió la petición y publicó el evento (push_publicado)"
else
  echo "✘ Ninguna instancia registró push_publicado con ese traceId"; ok=0
fi
if [ -n "$origen" ] && printf '%s\n' "$lineas" | grep -q "push_entregado instancia=$origen origen=$origen"; then
  echo "✔ $origen lo entregó a sus propios clientes"
else
  echo "✘ Falta push_entregado en el origen"; ok=0
fi
if [ -n "$origen" ] && printf '%s\n' "$lineas" | grep -q "push_entregado instancia=$otra origen=$origen"; then
  echo "✔ $otra lo recibió por RabbitMQ y lo entregó a sus clientes, con el mismo traceId"
else
  echo "✘ Falta push_entregado en $otra: el evento no se siguió hasta la otra instancia"; ok=0
fi
if printf '%s\n' "$bitacora" | grep -q "\"instancia\":\"$origen\""; then
  echo "✔ La bitácora de peticiones registra la misma petición en $origen"
else
  echo "✘ La bitácora no devolvió la petición con ese traceId"; ok=0
fi

echo
if [ "$ok" = "1" ]; then echo "RESULTADO: CUMPLE"; exit 0; fi
echo "RESULTADO: NO CUMPLE"; exit 1
