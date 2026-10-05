# EP-02.F2.US1 — Semáforo de inventario (M-01)

## Regla (idéntica en back y front, aritmética entera)

| Nivel (wire / UI) | Condición (`disponible` vs `requerido`) |
|---|---|
| `COMPLETO` / `COMPLETE` (aqua) | `disponible >= requerido`, o `requerido == 0` |
| `VERDE` / `GREEN` | `>= 70 %` y `< 100 %` |
| `AMARILLO` / `AMBER` | `>= 35 %` y `< 70 %` |
| `ROJO` / `RED` | `< 35 %` |

Bordes exactos: 35 % ya es amarillo, 70 % ya es verde, 100 % es completo
(`disponible*100 < requerido*35`, `< requerido*70`). El centro hereda el peor
nivel de sus ítems (`COMPLETO` es el menos grave).

## Motivo
El tramo amarillo 30–80 % duraba demasiado ("se dona y se dona y nada cambia").

## Código
- Back: `Semaforo` (+`COMPLETO`), `ItemInventario.semaforo()`.
- Front: `trafficLight()`, `TrafficLight` (+`COMPLETE`), `inventory-api.ts`, vista ciudadano (nivel `complete`, token `--nv-complete`).

## Pendiente fuera del repo
`contract/openapi.yaml`: `Semaforo: [ROJO, AMARILLO, VERDE]` → agregar `COMPLETO`.

## Gherkin propuesto (escenarios 2 y 3)
- Esc. 2: rojo si `< 35 %`, amarillo `35 % – < 70 %`, verde `70 % – < 100 %`, completo `>= 100 %` o sin requerimiento.
- Esc. 3: al cambiar el stock el semáforo se recalcula en el backend y se publica en `/topic/suministros` a todos los conectados.
