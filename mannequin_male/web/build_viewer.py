"""Genera web/index.html (visor three.js autocontenido) a partir de template.html y mannequin_male.json.
Uso: python3 web/build_viewer.py   (después de scripts/export.py)"""
import os
HERE = os.path.dirname(os.path.abspath(__file__))
tpl = open(os.path.join(HERE, 'template.html'), encoding='utf-8').read()
data = open(os.path.join(HERE, 'mannequin_male.json'), encoding='utf-8').read().strip()
out = tpl.replace('/*MESH_JSON*/null', data)
assert out != tpl
with open(os.path.join(HERE, 'index.html'), 'w', encoding='utf-8') as fh:
    fh.write(out)
print('index.html', len(out) // 1024, 'KB')
