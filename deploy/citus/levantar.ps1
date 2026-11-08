# Levanta NexoVital sobre la topología distribuida de Citus:
#   coordinador (db) + db-worker-1 + db-worker-2
# y distribuye las tablas grandes entre los dos workers.
#
#   .\deploy\citus\levantar.ps1
#
# Es idempotente: si ya está todo arriba, vuelve a correr la distribución sin
# romper nada. La app no cambia: sigue conectándose a `db:5432`.
$ErrorActionPreference = "Stop"

$citus = Split-Path -Parent $MyInvocation.MyCommand.Path
$raiz = Split-Path -Parent (Split-Path -Parent $citus)
$compose = @(
    "compose",
    "-f", "$raiz\docker-compose.yml",
    "-f", "$citus\docker-compose.citus.yml"
)

function Esperar-Base {
    param([string]$Servicio)
    for ($i = 0; $i -lt 40; $i++) {
        docker @compose exec -T $Servicio pg_isready -U nexovital -d nexovital *> $null
        if ($LASTEXITCODE -eq 0) { return }
        Start-Sleep -Seconds 3
    }
    throw "La base $Servicio no respondió a tiempo."
}

Write-Host "1/4 Levantando coordinador y workers..."
docker @compose up -d db db-worker-1 db-worker-2
Esperar-Base "db"
Esperar-Base "db-worker-1"
Esperar-Base "db-worker-2"

Write-Host "2/4 Levantando el backend (crea el esquema con ddl-auto=update)..."
docker @compose up -d --build backend-1

Write-Host "3/4 Esperando a que exista el esquema..."
$esquema = $null
for ($i = 0; $i -lt 60; $i++) {
    $esquema = (docker @compose exec -T db psql -U nexovital -d nexovital -t -A `
            -c "SELECT to_regclass('flota.ambulancias');" 2>$null).Trim()
    if ($esquema) { break }
    Start-Sleep -Seconds 5
}
if (-not $esquema) { throw "El backend no creó el esquema a tiempo; revisá sus logs." }

Write-Host "4/4 Distribuyendo las tablas entre los workers..."
Get-Content -Raw "$citus\distribuir.sql" |
    docker @compose exec -T db psql -U nexovital -d nexovital -v ON_ERROR_STOP=1

Write-Host "Levantando el resto de la topología (backend-2, nginx, RabbitMQ, Prometheus, Grafana)..."
docker @compose up -d

Write-Host ""
Write-Host "Listo. Verificá con: .\deploy\citus\verificar.ps1"
