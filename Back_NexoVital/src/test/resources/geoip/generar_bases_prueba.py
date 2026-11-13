"""Genera las bases .mmdb de PRUEBA que usa LectorMmdbTest (T16).

Los datos son inventados (190.0.0.0/8 -> CO, 8.8.8.0/24 -> US, 200.1.2.0/24 solo
con registered_country ES, 2800::/12 -> CO): no son de MaxMind y se pueden
versionar. Se fuerza el tamano de registro (24, 28 y 32 bits) para probar los
tres formatos del arbol. Requiere: pip install mmdb-writer netaddr maxminddb
"""
import mmdb_writer, maxminddb, sys
from netaddr import IPSet
def pais(iso, en):
    return {"continent":{"code":"SA","names":{"en":"South America"}},
            "country":{"iso_code":iso,"geoname_id":3686110,"names":{"en":en,"es":en}},
            "registered_country":{"iso_code":iso,"names":{"en":en}}}
def gen(fname, ipver, rs):
    orig = mmdb_writer.TreeWriter._adjust_record_size
    def forced(self):
        orig(self); self.record_size = rs
        self.data_offset = self.record_size * 2 / 8 * self._node_counter
    mmdb_writer.TreeWriter._adjust_record_size = forced
    kw = dict(ip_version=ipver, database_type='NexoVital-Prueba-Country', description='Base de prueba con datos inventados')
    if ipver == 6: kw['ipv4_compatible'] = True
    w = mmdb_writer.MMDBWriter(**kw)
    w.insert_network(IPSet(['190.0.0.0/8']), pais('CO','Colombia'))
    w.insert_network(IPSet(['8.8.8.0/24']), pais('US','United States'))
    w.insert_network(IPSet(['200.1.2.0/24']), {"registered_country":{"iso_code":"ES","names":{"en":"Spain"}}})
    if ipver == 6:
        w.insert_network(IPSet(['2800::/12']), pais('CO','Colombia'))
    w.to_db_file(fname)
    mmdb_writer.TreeWriter._adjust_record_size = orig
    r = maxminddb.open_database(fname)
    print(fname, r.metadata().record_size, r.metadata().ip_version, r.get('190.24.1.1')['country']['iso_code'], r.get('9.9.9.9'))
for rs in (24,28,32):
    gen(f'pais-ipv6-{rs}.mmdb', 6, rs)
gen('pais-ipv4-24.mmdb', 4, 24)
