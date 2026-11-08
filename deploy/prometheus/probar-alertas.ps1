# Corre las pruebas de las reglas de alerta con promtool, dentro de la misma
# imagen de Prometheus que usa el compose. No necesita Prometheus levantado.
#
#   .\deploy\prometheus\probar-alertas.ps1
#
# Sale con codigo 0 solo si todas las reglas pasan.
$ErrorActionPreference = "Continue"

$raiz = Split-Path -Parent $MyInvocation.MyCommand.Path

docker run --rm `
    --volume "${raiz}:/etc/prometheus:ro" `
    --workdir /etc/prometheus `
    --entrypoint promtool `
    prom/prometheus:latest test rules alertas.test.yml
