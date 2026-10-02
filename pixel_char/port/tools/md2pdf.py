#!/usr/bin/env python3
"""MECHANICS_SPEC.md → MECHANICS_SPEC.pdf (markdown → HTML con estilo de impresión → Chromium de Playwright).
Necesita: pip install markdown; Playwright instalado en pixel_char/world/tests (se ejecuta desde allí).
uso: python3 port/tools/md2pdf.py"""
import os, subprocess, sys, tempfile, markdown
HERE = os.path.dirname(os.path.abspath(__file__))
PORT = os.path.dirname(HERE)
TESTS = os.path.join(PORT, "..", "world", "tests")
src = os.path.join(PORT, "MECHANICS_SPEC.md"); out = os.path.join(PORT, "MECHANICS_SPEC.pdf")
md = open(src, encoding="utf-8").read()
body = markdown.markdown(md, extensions=["tables", "fenced_code", "toc", "sane_lists"])
css = """
@page { size: A4; margin: 16mm 14mm 18mm 14mm; }
body { font-family: "DejaVu Sans", "Helvetica", Arial, sans-serif; font-size: 9.6pt; line-height: 1.42; color: #1b1b1b; }
h1 { font-size: 19pt; border-bottom: 2px solid #333; padding-bottom: 4px; margin-top: 0; }
h2 { font-size: 14pt; margin-top: 20px; border-bottom: 1px solid #bbb; padding-bottom: 2px; page-break-after: avoid; }
h3 { font-size: 11.5pt; margin-top: 14px; page-break-after: avoid; }
p, li { orphans: 3; widows: 3; }
table { border-collapse: collapse; width: 100%; margin: 6px 0 10px; font-size: 8.4pt; page-break-inside: auto; }
tr { page-break-inside: avoid; }
th, td { border: 1px solid #c8c8c8; padding: 3px 5px; vertical-align: top; text-align: left; }
th { background: #eef1f4; }
code { font-family: "DejaVu Sans Mono", Menlo, monospace; font-size: 8.4pt; background: #f3f3f3; padding: 0 2px; }
pre { background: #f6f7f8; border: 1px solid #ddd; padding: 7px 9px; font-size: 7.9pt; line-height: 1.32; white-space: pre-wrap; page-break-inside: avoid; }
pre code { background: none; padding: 0; }
hr { border: 0; border-top: 1px solid #ddd; margin: 14px 0; }
"""
html = f"<!doctype html><html lang='es'><head><meta charset='utf-8'><title>Mecánicas — Bosque del autómata</title><style>{css}</style></head><body>{body}</body></html>"
tmp = os.path.join(tempfile.gettempdir(), "mechanics_spec.html")
open(tmp, "w", encoding="utf-8").write(html)
js = f"""
const {{ chromium }} = require('playwright');
(async () => {{
  const b = await chromium.launch(); const p = await b.newPage();
  await p.goto('file://{tmp}'); 
  await p.pdf({{ path: {out!r}, format: 'A4', printBackground: true, displayHeaderFooter: true,
    headerTemplate: '<div></div>',
    footerTemplate: '<div style="font-size:7px;width:100%;text-align:center;color:#888">Bosque del autómata — mecánicas · <span class="pageNumber"></span>/<span class="totalPages"></span></div>',
    margin: {{ top: '14mm', bottom: '16mm', left: '12mm', right: '12mm' }} }});
  await b.close(); console.log('pdf ok');
}})();
"""
r = subprocess.run(["node", "-e", js], cwd=TESTS, capture_output=True, text=True)
print(r.stdout.strip(), r.stderr.strip()[:500])
sys.exit(r.returncode)
