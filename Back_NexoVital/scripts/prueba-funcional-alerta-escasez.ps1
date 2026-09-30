<#
.SYNOPSIS
Prueba funcional EN VIVO de la alerta de escasez de un centro de acopio.

.DESCRIPTION
Recorre el ciclo completo contra un backend REAL en ejecución (no un mock, no un
test in-process). Es la evidencia reproducible del criterio de aceptación de
Azure 225 / EP-03.F1.US5:

  1. login
  2. pedir MÁS unidades de las disponibles  ->  409 STOCK_INSUFICIENTE
  3. el mapa muestra la alerta SOBRE EL CENTRO, con el RECURSO y el FALTANTE
  4. una donación que cubre el faltante
  5. el mapa ya NO muestra la alerta: se limpió sola

Es re-ejecutable: dona exactamente el faltante que el propio sistema reporta, así
que siempre deja el estado limpio aunque una corrida anterior haya fallado.

CAMBIOS DE ESTADO: crea una alerta y suma stock al centro elegido. En el perfil
por defecto la base es H2 en memoria, así que reiniciar el backend lo deja como
estaba.

.PARAMETER Base
Raíz de la API. Por defecto el backend local.

.PARAMETER Exceso
Cuántas unidades de MÁS se piden sobre lo disponible. Por defecto 5.

.EXAMPLE
powershell -ExecutionPolicy Bypass -File scripts\prueba-funcional-alerta-escasez.ps1
#>
param(
    [string]$Base = 'http://localhost:8080/api/v1',
    [string]$Email = 'rangel@nexovital.co',
    [string]$Password = 'rangel123',
    [int]$Exceso = 5
)

$ErrorActionPreference = 'Stop'
$script:fallos = 0

function Paso {
    param([string]$Nombre, [bool]$Ok, [string]$Detalle = '')
    $marca = if ($Ok) { '[ OK ]' } else { '[FALLA]'; $script:fallos++ }
    Write-Host "$marca $Nombre"
    if ($Detalle) { Write-Host "       $Detalle" }
}

function Invoke-Api {
    param([string]$Metodo, [string]$Ruta, [hashtable]$Headers, $Cuerpo)
    $args = @{ Method = $Metodo; Uri = "$Base$Ruta"; Headers = $Headers; UseBasicParsing = $true; TimeoutSec = 20 }
    if ($null -ne $Cuerpo) { $args.ContentType = 'application/json'; $args.Body = ($Cuerpo | ConvertTo-Json -Compress) }
    return Invoke-RestMethod @args
}

# Lee el cuerpo de una respuesta de error. `ErrorDetails.Message` NO lo expone en
# PowerShell 5.1: hay que leer el stream, o se concluye por error que viene vacío.
function Leer-CuerpoDeError {
    param($Error_)
    try {
        $stream = $Error_.Exception.Response.GetResponseStream()
        $reader = New-Object System.IO.StreamReader($stream)
        return $reader.ReadToEnd()
    } catch {
        return ''
    }
}

function CentroDelMapa {
    param([hashtable]$Headers, [string]$CentroId)
    $mapa = Invoke-Api -Metodo GET -Ruta '/mapa' -Headers $Headers
    foreach ($c in @($mapa.centros)) { if ($c.id -eq $CentroId) { return $c } }
    return $null
}

Write-Host ''
Write-Host '=== Prueba funcional: alerta de escasez (Azure 225 / EP-03.F1.US5) ==='
Write-Host "backend: $Base"
Write-Host ''

# --- 1. login -----------------------------------------------------------------
try {
    $sesion = Invoke-Api -Metodo POST -Ruta '/sesiones' -Headers @{} -Cuerpo @{ email = $Email; password = $Password }
    $headers = @{ Authorization = "Bearer $($sesion.token)" }
    Paso 'PASO 1  login' $true "rol=$($sesion.usuario.rol)"
} catch {
    Paso 'PASO 1  login' $false "el backend no responde en $Base - levantalo antes de correr esto ($($_.Exception.Message))"
    Write-Host ''
    Write-Host 'No se puede seguir sin backend.' -ForegroundColor Red
    exit 1
}

# --- 2. elegir un centro de acopio y un recurso con stock ---------------------
$mapa = Invoke-Api -Metodo GET -Ruta '/mapa' -Headers $headers
$acopio = $null
foreach ($c in @($mapa.centros)) { if ($c.tipo -eq 'CENTRO_ACOPIO') { $acopio = $c; break } }
if ($null -eq $acopio) { Paso 'PASO 2  elegir centro' $false 'no hay ningun CENTRO_ACOPIO en GET /mapa'; exit 1 }

$inventario = Invoke-Api -Metodo GET -Ruta "/centros-acopio/$($acopio.id)/inventario" -Headers $headers
$item = $null
foreach ($i in @($inventario)) { if ($i.disponible -gt 0) { $item = $i; break } }
if ($null -eq $item) { Paso 'PASO 2  elegir recurso' $false 'ningun item con disponible > 0'; exit 1 }

Paso 'PASO 2  elegir centro y recurso' $true "$($acopio.nombre) / $($item.nombre) (disponible=$($item.disponible))"

# --- 3. pedir MÁS de lo disponible -> 409 ------------------------------------
$pedido = [int]$item.disponible + $Exceso
$codigo = 0
$cuerpoError = ''
try {
    $null = Invoke-Api -Metodo POST -Ruta "/centros-acopio/$($acopio.id)/inventario/despacho" -Headers $headers -Cuerpo @{ itemId = $item.id; cantidad = $pedido }
} catch {
    $codigo = [int]$_.Exception.Response.StatusCode.value__
    $cuerpoError = Leer-CuerpoDeError $_
}
$ok409 = ($codigo -eq 409)
Paso 'PASO 3  pedir mas de lo disponible da 409' $ok409 "pedido=$pedido disponible=$($item.disponible) HTTP=$codigo"
if ($cuerpoError) { Write-Host "       cuerpo: $cuerpoError" }
if ($cuerpoError -and $cuerpoError -notmatch 'STOCK_INSUFICIENTE') {
    Paso 'PASO 3b el 409 informa el motivo' $false 'el cuerpo no trae STOCK_INSUFICIENTE'
}

# --- 4. el mapa debe mostrar la alerta SOBRE EL CENTRO -----------------------
$centro = CentroDelMapa -Headers $headers -CentroId $acopio.id
$alerta = $centro.alerta
$okAlerta = ($null -ne $alerta) -and ($alerta.nombre -eq $item.nombre) -and ([int]$alerta.faltante -ge $Exceso)
$detalle = if ($null -ne $alerta) { "nombre=$($alerta.nombre) cantidadSolicitada=$($alerta.cantidadSolicitada) faltante=$($alerta.faltante) alertasActivas=$($centro.alertasActivas)" } else { 'el centro NO trae alerta' }
Paso 'PASO 4  el mapa muestra la alerta (recurso + faltante)' $okAlerta $detalle

# --- 5. cubrir el faltante con una donación ----------------------------------
if ($null -ne $alerta) {
    $faltante = [int]$alerta.faltante
    $donacion = Invoke-Api -Metodo POST -Ruta "/centros-acopio/$($acopio.id)/inventario/donacion" -Headers $headers -Cuerpo @{ itemId = $item.id; cantidad = $faltante }
    Paso 'PASO 5  donar exactamente el faltante' $true "donado=$faltante disponible=$($donacion.disponible)"

    # --- 6. la alerta se apaga SOLA ------------------------------------------
    $centroFinal = CentroDelMapa -Headers $headers -CentroId $acopio.id
    $okLimpio = ($null -eq $centroFinal.alerta)
    $detFinal = if ($okLimpio) { 'sin alerta: se limpio sola' } else { "sigue con alerta: faltante=$($centroFinal.alerta.faltante)" }
    Paso 'PASO 6  la alerta se limpia sola al cubrirse' $okLimpio $detFinal
} else {
    Paso 'PASO 5  donar el faltante' $false 'no hay alerta que cubrir (ver PASO 4)'
    Paso 'PASO 6  la alerta se limpia sola' $false 'no se pudo verificar sin alerta'
}

# --- resumen -----------------------------------------------------------------
Write-Host ''
if ($script:fallos -eq 0) {
    Write-Host 'RESULTADO: TODOS LOS PASOS PASARON' -ForegroundColor Green
    exit 0
} else {
    Write-Host "RESULTADO: $script:fallos paso(s) FALLARON" -ForegroundColor Red
    exit 1
}
