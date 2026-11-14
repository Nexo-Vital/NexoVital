#!/usr/bin/env bash
# ==========================================================================
# T45 · La alerta se dispara, llega y se resuelve (con el sistema real).
#
# Fase 1 (5xx): detiene la base de datos y manda tráfico a /api/v1/mapa. El
#   backend responde 5xx de verdad; se espera a que la notificación
#   NexoVitalTasaErrores5xx (firing) llegue al receptor webhook. Luego levanta
#   la base y espera la notificación de resuelta (resolved).
# Fase 2 (instancia): detiene backend-2 y espera NexoVitalInstanciaCaida
#   (firing); la vuelve a levantar y espera la resuelta.
#
# Uso (desde cualquier carpeta, con el compose de pruebas arriba: la fase 1
# usa el login local y la espera de conexión corta a la base):
#   docker compose -f docker-compose.yml -f docker-compose.pruebas.yml up -d
#   deploy/prometheus/probar-alertas.sh            # las dos fases (~6-8 min)
#   deploy/prometheus/probar-alertas.sh 5xx        # solo la fase 1
#   deploy/prometheus/probar-alertas.sh instancia  # solo la fase 2
#
# Mientras corre se puede mirar: http://localhost:9095 (receptor),
# http://localhost:9093 (Alertmanager) y http://localhost:9090/alerts.
# Pase lo que pase, al salir vuelve a levantar la base y backend-2.
# ==========================================================================
set -uo pipefail

FASE="${1:-todo}"
BASE="${BASE_URL:-http://localhost:8080}"
PROM="${PROMETHEUS_URL:-http://localhost:9090}"
AM="${ALERTMANAGER_URL:-http://localhost:9093}"
RECEPTOR="${RECEPTOR_URL:-http://localhost:9095}"
CLIENTES="${CLIENTES:-10}"
ESPERA_MAXIMA_S="${ESPERA_MAXIMA_S:-240}"

cd "$(dirname "$0")/../.."
TMP="$(mktemp -d)"
MARCA="$TMP/generando"
RESULTADO=0

restaurar() {
  rm -f "$MARCA"
  wait 2>/dev/null
  docker compose start db backend-2 >/dev/null 2>&1
  rm -rf "$TMP"
}
trap restaurar EXIT

reloj() { date +%H:%M:%S; }

# Cuántas notificaciones de <alerta> con <estado> lleva el receptor.
contar() {
  curl -s "$RECEPTOR/alertas" | grep -o "\"estado\": \"$2\", \"alerta\": \"$1\"" | wc -l | tr -d ' '
}

# Espera a que llegue una notificación nueva de <alerta> con <estado>.
# Imprime los segundos transcurridos desde <inicio>.
esperar() {
  local alerta="$1" estado="$2" inicio="$3" antes="$4" t
  while :; do
    t=$(( $(date +%s) - inicio ))
    if [ "$(contar "$alerta" "$estado")" -gt "$antes" ]; then
      printf '\r%s  ✔ llegó %s (%s) a los %s s            \n' "$(reloj)" "$alerta" "$estado" "$t"
      return 0
    fi
    if [ "$t" -ge "$ESPERA_MAXIMA_S" ]; then
      printf '\r%s  ✘ a los %s s no llegó %s (%s)\n' "$(reloj)" "$t" "$alerta" "$estado"
      return 1
    fi
    printf '\r%s  esperando %s (%s)... %s s' "$(reloj)" "$alerta" "$estado" "$t"
    sleep 2
  done
}

comprobar_stack() {
  local falta=0
  curl -sf "$RECEPTOR/salud" >/dev/null || { echo "El receptor de alertas no responde en $RECEPTOR" >&2; falta=1; }
  curl -sf "$AM/-/ready" >/dev/null || { echo "Alertmanager no responde en $AM" >&2; falta=1; }
  curl -sf "$PROM/-/ready" >/dev/null || { echo "Prometheus no responde en $PROM" >&2; falta=1; }
  if [ "$falta" = "1" ]; then
    echo "Levanta el compose: docker compose -f docker-compose.yml -f docker-compose.pruebas.yml up -d" >&2
    exit 1
  fi
}

fase_5xx() {
  echo "===== Fase 1: errores 5xx (NexoVitalTasaErrores5xx) ====="
  local token
  token="$(curl -s -X POST "$BASE/api/v1/sesiones" -H 'Content-Type: application/json' \
    -d '{"email":"ciudadano@nexovital.co","password":"ciudadano123"}' | sed -n 's/.*"token":"\([^"]*\)".*/\1/p')"
  if [ -z "$token" ]; then
    echo "No se pudo iniciar sesión: ¿compose arriba con docker-compose.pruebas.yml?" >&2
    RESULTADO=1; return
  fi
  local antes_f antes_r inicio
  antes_f="$(contar NexoVitalTasaErrores5xx firing)"
  antes_r="$(contar NexoVitalTasaErrores5xx resolved)"

  echo "$(reloj)  Deteniendo la base de datos..."
  docker compose stop db >/dev/null
  inicio=$(date +%s)

  touch "$MARCA"
  local i
  for i in $(seq 1 "$CLIENTES"); do
    (
      while [ -f "$MARCA" ]; do
        curl -s -o /dev/null -m 10 -w '%{http_code}\n' \
          -H "Authorization: Bearer $token" "$BASE/api/v1/mapa" >> "$TMP/codigos-$i"
        sleep 0.5
      done
    ) &
  done
  echo "$(reloj)  $CLIENTES clientes consultando /api/v1/mapa con la base caída"

  esperar NexoVitalTasaErrores5xx firing "$inicio" "$antes_f" || RESULTADO=1
  local errores
  errores="$(cat "$TMP"/codigos-* 2>/dev/null | grep -c '^5')"
  echo "         respuestas 5xx vistas por los clientes hasta ahora: $errores"

  echo "$(reloj)  Levantando la base de datos..."
  docker compose start db >/dev/null
  local t0; t0=$(date +%s)
  until [ "$(curl -s -o /dev/null -m 5 -w '%{http_code}' -H "Authorization: Bearer $token" "$BASE/api/v1/mapa")" = "200" ]; do
    if [ $(( $(date +%s) - t0 )) -ge 90 ]; then echo "La API no volvió a responder 200 en 90 s" >&2; break; fi
    sleep 2
  done
  rm -f "$MARCA"; wait 2>/dev/null
  echo "$(reloj)  La API responde 200 otra vez; los 5xx salen de la ventana de 1 minuto"

  inicio=$(date +%s)
  esperar NexoVitalTasaErrores5xx resolved "$inicio" "$antes_r" || RESULTADO=1
  echo
}

fase_instancia() {
  echo "===== Fase 2: instancia caída (NexoVitalInstanciaCaida) ====="
  local antes_f antes_r inicio
  antes_f="$(contar NexoVitalInstanciaCaida firing)"
  antes_r="$(contar NexoVitalInstanciaCaida resolved)"

  echo "$(reloj)  Deteniendo backend-2..."
  docker compose stop backend-2 >/dev/null
  inicio=$(date +%s)
  esperar NexoVitalInstanciaCaida firing "$inicio" "$antes_f" || RESULTADO=1

  echo "$(reloj)  Levantando backend-2..."
  docker compose start backend-2 >/dev/null
  inicio=$(date +%s)
  esperar NexoVitalInstanciaCaida resolved "$inicio" "$antes_r" || RESULTADO=1
  echo
}

comprobar_stack
case "$FASE" in
  5xx) fase_5xx ;;
  instancia) fase_instancia ;;
  todo) fase_5xx; fase_instancia ;;
  *) echo "uso: $0 [todo|5xx|instancia]" >&2; exit 2 ;;
esac

echo "Notificaciones registradas por el receptor: $RECEPTOR (y docker compose logs receptor-alertas)"
if [ "$RESULTADO" = "0" ]; then echo "RESULTADO: CUMPLE"; else echo "RESULTADO: NO CUMPLE"; fi
exit "$RESULTADO"
