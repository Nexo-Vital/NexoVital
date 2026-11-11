#!/usr/bin/env bash
# ==========================================================================
# T39 · La degradación se ve en el tablero técnico en 30 s o menos (O-1).
#
# Detiene un componente del docker compose, mide cuántos segundos tarda
# Prometheus en reportarlo caído y lo vuelve a levantar. El tablero técnico se
# refresca cada 5 s, así que lo que ve una persona tarda, como mucho, el tiempo
# medido + 5 s.
#
# Uso (desde cualquier carpeta, con el compose arriba):
#   deploy/prometheus/probar-degradacion.sh backend-2   # una instancia deja de responder
#   deploy/prometheus/probar-degradacion.sh db          # la base de datos cae
#   deploy/prometheus/probar-degradacion.sh rabbitmq    # el canal entre instancias cae
#
# Requiere curl. Prometheus en http://localhost:9090 (o PROMETHEUS_URL).
# ==========================================================================
set -euo pipefail

COMPONENTE="${1:-backend-2}"
PROM="${PROMETHEUS_URL:-http://localhost:9090}"
LIMITE_S=30
REFRESCO_TABLERO_S=5
ESPERA_MAXIMA_S=60

case "$COMPONENTE" in
  backend-1|backend-2)
    CONSULTA="up{job=\"nexovital-backend\",instancia=\"$COMPONENTE\"}" ;;
  db)
    CONSULTA='min(nexovital_componente_disponible{componente="base_datos"})' ;;
  rabbitmq)
    CONSULTA='min(nexovital_componente_disponible{componente="rabbitmq"})' ;;
  *)
    echo "uso: $0 [backend-1|backend-2|db|rabbitmq]" >&2
    exit 2 ;;
esac

cd "$(dirname "$0")/../.."

valor() {
  curl -s --get "$PROM/api/v1/query" --data-urlencode "query=$CONSULTA" \
    | sed -n 's/.*"value":\[[^,]*,"\([^"]*\)"\].*/\1/p'
}

restaurar() {
  echo "Levantando de nuevo $COMPONENTE..."
  docker compose start "$COMPONENTE" >/dev/null
}

inicial="$(valor)"
if [ "$inicial" != "1" ]; then
  echo "Antes de empezar, $COMPONENTE debe estar en 1 (operativo) y está en '${inicial:-sin datos}'." >&2
  echo "Espera a que todo esté healthy (docker compose ps) y vuelve a intentar." >&2
  exit 1
fi

trap restaurar EXIT
echo "Consulta: $CONSULTA"
echo "Deteniendo $COMPONENTE..."
inicio=$(date +%s)
docker compose stop "$COMPONENTE" >/dev/null

transcurrido=0
while [ "$transcurrido" -lt "$ESPERA_MAXIMA_S" ]; do
  sleep 1
  transcurrido=$(( $(date +%s) - inicio ))
  actual="$(valor)"
  if [ "$actual" = "0" ]; then
    en_tablero=$(( transcurrido + REFRESCO_TABLERO_S ))
    echo "Prometheus lo marcó caído a los ${transcurrido} s."
    echo "En el tablero se ve, como mucho, a los ${en_tablero} s (refresco de ${REFRESCO_TABLERO_S} s)."
    if [ "$en_tablero" -le "$LIMITE_S" ]; then
      echo "RESULTADO: CUMPLE (≤ ${LIMITE_S} s)"
      exit 0
    fi
    echo "RESULTADO: NO CUMPLE (> ${LIMITE_S} s)"
    exit 1
  fi
done

echo "RESULTADO: NO CUMPLE: a los ${ESPERA_MAXIMA_S} s Prometheus seguía sin marcarlo caído (último valor '${actual:-sin datos}')."
exit 1
