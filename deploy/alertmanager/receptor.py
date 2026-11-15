"""Receptor webhook de alertas de NexoVital (T44, T45).

Recibe las notificaciones de Alertmanager en POST /alertas, escribe una linea
por alerta en su log (`docker compose logs -f receptor-alertas`) y guarda las
ultimas en memoria para mostrarlas:

  GET /            tabla HTML que se refresca sola (para la presentacion)
  GET /alertas     las mismas notificaciones en JSON (lo usa probar-alertas.sh)

Solo usa la libreria estandar de Python: no necesita instalar nada.
"""

import html
import json
import sys
import threading
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

MAXIMO = 200
_recibidas = []
_candado = threading.Lock()


def _ahora():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _registrar(cuerpo):
    nuevas = []
    for alerta in cuerpo.get("alerts", []):
        etiquetas = alerta.get("labels", {})
        anotaciones = alerta.get("annotations", {})
        nuevas.append({
            "recibidaEn": _ahora(),
            "estado": alerta.get("status", "desconocido"),
            "alerta": etiquetas.get("alertname", "?"),
            "severidad": etiquetas.get("severidad", ""),
            "instancia": etiquetas.get("instancia", ""),
            "resumen": anotaciones.get("resumen", ""),
            "iniciaEn": alerta.get("startsAt", ""),
            "terminaEn": alerta.get("endsAt", ""),
        })
    with _candado:
        _recibidas.extend(nuevas)
        del _recibidas[:-MAXIMO]
    for n in nuevas:
        print(
            f"ALERTA {n['estado'].upper():8} {n['alerta']} severidad={n['severidad']} "
            f"instancia={n['instancia'] or '-'} resumen=\"{n['resumen']}\" recibida={n['recibidaEn']}",
            flush=True,
        )


def _pagina():
    with _candado:
        filas = list(reversed(_recibidas))
    cuerpo = "".join(
        "<tr class='{0}'><td>{1}</td><td>{2}</td><td>{3}</td><td>{4}</td><td>{5}</td><td>{6}</td></tr>".format(
            "resuelta" if f["estado"] == "resolved" else "activa",
            html.escape(f["recibidaEn"]),
            "RESUELTA" if f["estado"] == "resolved" else "DISPARADA",
            html.escape(f["alerta"]),
            html.escape(f["severidad"]),
            html.escape(f["instancia"] or "-"),
            html.escape(f["resumen"]),
        )
        for f in filas
    ) or "<tr><td colspan='6'>Sin notificaciones todavia.</td></tr>"
    return f"""<!doctype html><html lang="es"><head><meta charset="utf-8">
<meta http-equiv="refresh" content="5"><title>NexoVital - alertas recibidas</title>
<style>body{{font-family:system-ui,sans-serif;margin:2rem;background:#111;color:#eee}}
table{{border-collapse:collapse;width:100%}}td,th{{padding:.5rem;border-bottom:1px solid #333;text-align:left}}
tr.activa td:nth-child(2){{color:#ff6b6b;font-weight:600}}tr.resuelta td:nth-child(2){{color:#51cf66;font-weight:600}}</style>
</head><body><h1>Alertas recibidas por el receptor webhook</h1>
<p>Notificaciones de Alertmanager, la mas reciente primero. La pagina se refresca cada 5 s (hora UTC).</p>
<table><tr><th>Recibida</th><th>Estado</th><th>Alerta</th><th>Severidad</th><th>Instancia</th><th>Resumen</th></tr>
{cuerpo}</table></body></html>"""


class Receptor(BaseHTTPRequestHandler):
    def _responder(self, codigo, tipo, contenido):
        datos = contenido.encode("utf-8")
        self.send_response(codigo)
        self.send_header("Content-Type", tipo)
        self.send_header("Content-Length", str(len(datos)))
        self.end_headers()
        self.wfile.write(datos)

    def do_POST(self):
        if self.path != "/alertas":
            self._responder(404, "text/plain", "no encontrado")
            return
        largo = int(self.headers.get("Content-Length", 0))
        try:
            _registrar(json.loads(self.rfile.read(largo) or b"{}"))
        except ValueError:
            self._responder(400, "text/plain", "json invalido")
            return
        self._responder(200, "text/plain", "ok")

    def do_GET(self):
        if self.path == "/alertas":
            with _candado:
                self._responder(200, "application/json", json.dumps(_recibidas))
        elif self.path == "/salud":
            self._responder(200, "text/plain", "ok")
        elif self.path == "/":
            self._responder(200, "text/html; charset=utf-8", _pagina())
        else:
            self._responder(404, "text/plain", "no encontrado")

    def log_message(self, *args):
        # Sin el log de acceso de cada GET: el log queda solo con las alertas.
        pass


if __name__ == "__main__":
    print("Receptor de alertas escuchando en :8080", flush=True)
    sys.stdout.flush()
    ThreadingHTTPServer(("0.0.0.0", 8080), Receptor).serve_forever()
