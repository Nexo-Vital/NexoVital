#!/usr/bin/env bash
# ==========================================================================
# T07 · Escenario D-1: caida de una instancia con 100 usuarios.
#
# Lanza loadtest/escenario-caida.js y, en el minuto 2 de la meseta, detiene
# backend-2 de golpe (`docker compose stop -t 0`, un SIGKILL: sin apagado
# ordenado, como una caida real). La instancia queda caida hasta el final; al
# terminar (o si se interrumpe) se vuelve a levantar.
#
# Uso (desde la raiz del repo, con el compose de pruebas y limites altos):
#   PRUEBA_LIMITE_USUARIO=100000 PRUEBA_LIMITE_IP=100000 \
#     docker compose -f docker-compose.yml -f docker-compose.pruebas.yml up -d
#   loadtest/probar-caida.sh
#
# Variables: CAIDA_S (120), INSTANCIA (backend-2); el resto se pasa a k6
# (por ejemplo: loadtest/probar-caida.sh -e USUARIOS=20 -e DURACION=2m -e CAIDA_S=40).
# Deja la salida en evidencias-nube/resultado-d1.{txt,json}.
# ==========================================================================
set -uo pipefail
cd "$(dirname "$0")/.."

CAIDA_S="${CAIDA_S:-120}"
INSTANCIA="${INSTANCIA:-backend-2}"
mkdir -p evidencias-nube
SALIDA=evidencias-nube/resultado-d1.txt
: > "$SALIDA"

levantar() {
  echo "$(date +%H:%M:%S)  Levantando $INSTANCIA de nuevo..."
  docker compose start "$INSTANCIA" >/dev/null 2>&1
}
trap levantar EXIT

if ! docker compose ps --status running --services | grep -qx "$INSTANCIA"; then
  echo "$INSTANCIA no esta corriendo: levanta el compose antes de la prueba." >&2
  exit 1
fi

k6 run -e CAIDA_S="$CAIDA_S" -e RESUMEN_JSON=evidencias-nube/resultado-d1.json "$@" \
  loadtest/escenario-caida.js 2>&1 | tee "$SALIDA" &
K6=$!

# Espera a que el setup de k6 anuncie el instante de la caida.
caida_ms=""
for _ in $(seq 1 120); do
  caida_ms="$(grep -o 'CAIDA_EN=[0-9]*' "$SALIDA" | head -1 | cut -d= -f2)"
  [ -n "$caida_ms" ] && break
  sleep 1
done
if [ -z "$caida_ms" ]; then
  echo "k6 no anuncio el inicio de la prueba (¿fallo el setup?)." >&2
  wait "$K6"
  exit 1
fi

caida_s=$(( caida_ms / 1000 ))
while [ "$(date +%s)" -lt "$caida_s" ]; do sleep 1; done
echo
echo "$(date +%H:%M:%S)  >>> CAIDA: deteniendo $INSTANCIA con SIGKILL (docker compose stop -t 0)"
docker compose stop -t 0 "$INSTANCIA" >/dev/null 2>&1
echo "$(date +%H:%M:%S)  >>> $INSTANCIA detenida; la prueba sigue con una sola instancia"
echo

wait "$K6"
