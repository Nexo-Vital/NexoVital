#!/usr/bin/env bash
# Corre las pruebas unitarias de las reglas de alerta con promtool, dentro de
# la misma imagen de Prometheus del compose (equivalente a probar-alertas.ps1
# para Mac/Linux). No necesita Prometheus levantado.
#
#   deploy/prometheus/probar-reglas.sh
set -euo pipefail
RAIZ="$(cd "$(dirname "$0")" && pwd)"
docker run --rm --volume "$RAIZ:/etc/prometheus:ro" --workdir /etc/prometheus \
  --entrypoint promtool prom/prometheus:latest test rules alertas.test.yml
