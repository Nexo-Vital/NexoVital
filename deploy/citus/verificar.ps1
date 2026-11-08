# Muestra la evidencia de la distribución: nodos, shards y planes router vs
# multi-shard. Requiere que la topología Citus esté arriba (levantar.ps1).
$ErrorActionPreference = "Stop"

$citus = Split-Path -Parent $MyInvocation.MyCommand.Path
$raiz = Split-Path -Parent (Split-Path -Parent $citus)

Get-Content -Raw "$citus\verificar.sql" |
    docker compose `
        -f "$raiz\docker-compose.yml" `
        -f "$citus\docker-compose.citus.yml" `
        exec -T db psql -U nexovital -d nexovital
