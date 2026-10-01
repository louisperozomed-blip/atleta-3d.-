"""Genera informe/informe_proyecto.pdf: informe extenso de todo lo hecho en el repositorio (28/09 - 01/10/2026).
uso: python3 informe/generar_informe.py
"""
import os
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import cm
from reportlab.lib import colors
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.enums import TA_CENTER, TA_JUSTIFY, TA_LEFT
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (BaseDocTemplate, PageTemplate, Frame, Paragraph, Spacer, Table, TableStyle,
                                Image, PageBreak, KeepTogether, NextPageTemplate, CondPageBreak)
from reportlab.platypus.tableofcontents import TableOfContents

HERE = os.path.dirname(os.path.abspath(__file__))
IMG = os.path.join(HERE, "img")
OUT = os.path.join(HERE, "informe_proyecto.pdf")

F = "/usr/share/fonts/truetype/dejavu/"
pdfmetrics.registerFont(TTFont("DV", F + "DejaVuSans.ttf"))
pdfmetrics.registerFont(TTFont("DVB", F + "DejaVuSans-Bold.ttf"))
pdfmetrics.registerFont(TTFont("DVI", "/usr/share/fonts/truetype/liberation/LiberationSans-Italic.ttf"))   # (no hay DejaVu Sans oblicua)
pdfmetrics.registerFont(TTFont("DVM", F + "DejaVuSansMono.ttf"))
from reportlab.pdfbase.pdfmetrics import registerFontFamily
registerFontFamily("DV", normal="DV", bold="DVB", italic="DVI", boldItalic="DVB")

INK = colors.HexColor("#1d2a33")
ACC = colors.HexColor("#1f6f78")      # verde azulado (bosque)
ACC2 = colors.HexColor("#c8702a")     # naranja (farol)
SOFT = colors.HexColor("#eef3f4")
LINE = colors.HexColor("#b9c8cc")

ST = {
    "body": ParagraphStyle("body", fontName="DV", fontSize=9.6, leading=13.6, textColor=INK, alignment=TA_JUSTIFY, spaceAfter=5),
    "bullet": ParagraphStyle("bullet", fontName="DV", fontSize=9.6, leading=13.4, textColor=INK, leftIndent=14, bulletIndent=4, spaceAfter=2.5),
    "h1": ParagraphStyle("h1", fontName="DVB", fontSize=19, leading=24, textColor=ACC, spaceBefore=4, spaceAfter=10),
    "h2": ParagraphStyle("h2", fontName="DVB", fontSize=13.2, leading=17, textColor=INK, spaceBefore=12, spaceAfter=6),
    "h3": ParagraphStyle("h3", fontName="DVB", fontSize=10.6, leading=14, textColor=ACC, spaceBefore=8, spaceAfter=3),
    "cap": ParagraphStyle("cap", fontName="DVI", fontSize=8.2, leading=11, textColor=colors.HexColor("#4b5a63"), alignment=TA_CENTER, spaceBefore=3, spaceAfter=9),
    "cell": ParagraphStyle("cell", fontName="DV", fontSize=8.2, leading=10.6, textColor=INK),
    "cellb": ParagraphStyle("cellb", fontName="DVB", fontSize=8.2, leading=10.6, textColor=colors.white),
    "small": ParagraphStyle("small", fontName="DV", fontSize=7.6, leading=9.6, textColor=INK),
    "mono": ParagraphStyle("mono", fontName="DVM", fontSize=7.8, leading=10.2, textColor=INK, backColor=SOFT, borderPadding=4, spaceAfter=6),
    "key": ParagraphStyle("key", fontName="DV", fontSize=9.6, leading=13.6, textColor=INK, backColor=colors.HexColor("#fbf3ea"),
                          borderColor=ACC2, borderWidth=0.8, borderPadding=7, spaceBefore=4, spaceAfter=10),
}

story = []
P = lambda t, s="body": story.append(Paragraph(t, ST[s]))


def H1(t, key=None):
    story.append(CondPageBreak(9 * cm))
    p = Paragraph(t, ST["h1"]); p._toc = (0, t); story.append(p)


def H2(t):
    story.append(CondPageBreak(4 * cm))
    p = Paragraph(t, ST["h2"]); p._toc = (1, t); story.append(p)


def H3(t):
    story.append(CondPageBreak(3 * cm)); P(t, "h3")


def B(items):
    for it in items:
        story.append(Paragraph(it, ST["bullet"], bulletText="•"))
    story.append(Spacer(1, 4))


def KEY(t):
    P(t, "key")


def T(rows, widths=None, head=True, fs=None):
    data = []
    for i, r in enumerate(rows):
        data.append([Paragraph(str(c), ST["cellb"] if (head and i == 0) else ST["cell"]) for c in r])
    W = 17.0 * cm
    if widths:
        tot = sum(widths); widths = [W * w / tot for w in widths]
    t = Table(data, colWidths=widths, repeatRows=1 if head else 0, hAlign="LEFT")
    sty = [("GRID", (0, 0), (-1, -1), 0.4, LINE), ("VALIGN", (0, 0), (-1, -1), "TOP"),
           ("TOPPADDING", (0, 0), (-1, -1), 3), ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
           ("LEFTPADDING", (0, 0), (-1, -1), 4), ("RIGHTPADDING", (0, 0), (-1, -1), 4)]
    if head:
        sty += [("BACKGROUND", (0, 0), (-1, 0), ACC)]
        for i in range(1, len(rows)):
            if i % 2 == 0: sty.append(("BACKGROUND", (0, i), (-1, i), SOFT))
    t.setStyle(TableStyle(sty))
    story.append(t); story.append(Spacer(1, 8))


def IMGF(name, cap, w=17.0):
    p = os.path.join(IMG, name + ".jpg")
    from PIL import Image as PI
    iw, ih = PI.open(p).size
    w = w * cm; h = w * ih / iw
    if h > 11.5 * cm: h = 11.5 * cm; w = h * iw / ih
    story.append(KeepTogether([Image(p, width=w, height=h), Paragraph(cap, ST["cap"])]))


# ---------------------------------------------------------------- portada
class Doc(BaseDocTemplate):
    def afterFlowable(self, f):
        if hasattr(f, "_toc"):
            lvl, txt = f._toc
            key = "h%d_%d" % (lvl, id(f))
            self.canv.bookmarkPage(key)
            self.canv.addOutlineEntry(txt.replace("&amp;", "&"), key, level=lvl, closed=lvl > 0)
            self.notify("TOCEntry", (lvl, txt, self.page, key))


def cover(c, d):
    w, h = A4
    c.saveState()
    c.setFillColor(colors.HexColor("#14262c")); c.rect(0, 0, w, h, fill=1, stroke=0)
    c.setFillColor(colors.HexColor("#1f6f78")); c.rect(0, h * 0.36, w, 4, fill=1, stroke=0)
    c.setFillColor(colors.HexColor("#c8702a")); c.circle(w - 3.2 * cm, h - 3.4 * cm, 0.55 * cm, fill=1, stroke=0)
    c.setFillColor(colors.white); c.setFont("DVB", 30)
    c.drawString(2.2 * cm, h * 0.62, "Informe del proyecto")
    c.setFont("DV", 15); c.setFillColor(colors.HexColor("#cfe6e8"))
    c.drawString(2.2 * cm, h * 0.62 - 1.0 * cm, "Del atleta low poly al duelo contra el Autómata del bosque")
    c.setFont("DV", 10.5); c.setFillColor(colors.HexColor("#9fb9bd"))
    y = h * 0.62 - 2.4 * cm
    for line in ["Repositorio: louisperozomed-blip/atleta-3d.-   ·   rama claude/atleta-lowpoly-unity-22xtbw",
                 "Periodo: 28 de septiembre – 1 de octubre de 2026   ·   85 commits",
                 "Modelado 3D por scripts · sprites pixel art iluminados · mundo isométrico jugable en WebGL",
                 "combate con parry, enemigo con IA de duelista · pruebas automáticas con Playwright"]:
        c.drawString(2.2 * cm, y, line); y -= 0.6 * cm
    p = os.path.join(IMG, "mundo_zonas.jpg")
    c.drawImage(p, 2.2 * cm, 2.2 * cm, width=w - 4.4 * cm, height=(w - 4.4 * cm) * 716 / 1366, preserveAspectRatio=True)
    c.setFont("DVI", 8.5); c.setFillColor(colors.HexColor("#9fb9bd"))
    c.drawString(2.2 * cm, 1.5 * cm, "Vista amplia del mundo: el titán caído, el bosque retorcido, el árbol del farol, las charcas y el cementerio.")
    c.restoreState()


def page(c, d):
    w, h = A4
    c.saveState()
    c.setStrokeColor(LINE); c.setLineWidth(0.5); c.line(2 * cm, h - 1.45 * cm, w - 2 * cm, h - 1.45 * cm)
    c.setFont("DV", 7.8); c.setFillColor(colors.HexColor("#6b7b83"))
    c.drawString(2 * cm, h - 1.2 * cm, "Informe del proyecto · atleta-3d")
    c.drawRightString(w - 2 * cm, h - 1.2 * cm, "28/09 – 01/10/2026")
    c.drawCentredString(w / 2, 1.2 * cm, str(d.page))
    c.restoreState()


doc = Doc(OUT, pagesize=A4, leftMargin=2 * cm, rightMargin=2 * cm, topMargin=2 * cm, bottomMargin=2 * cm,
          title="Informe del proyecto atleta-3d", author="Claude Code", subject="Informe de todo lo hecho en el repositorio")
fr = Frame(2 * cm, 2 * cm, A4[0] - 4 * cm, A4[1] - 4 * cm, id="f")
doc.addPageTemplates([PageTemplate(id="cover", frames=[fr], onPage=cover), PageTemplate(id="body", frames=[fr], onPage=page)])

story.append(NextPageTemplate("body"))
story.append(PageBreak())

# ---------------------------------------------------------------- índice
story.append(Paragraph("Índice", ST["h1"]))
toc = TableOfContents()
toc.levelStyles = [ParagraphStyle("t0", fontName="DVB", fontSize=10, leading=15, leftIndent=0, textColor=INK),
                   ParagraphStyle("t1", fontName="DV", fontSize=8.8, leading=12, leftIndent=14, textColor=INK)]
story.append(toc)
story.append(PageBreak())

# ================================================================ 1. resumen
H1("1. Resumen")
P("Este informe recoge todo lo que se ha construido en el repositorio en cuatro días de trabajo, del 28 de "
  "septiembre al 1 de octubre de 2026: 85 commits organizados en proyectos y etapas. Empezó como un personaje 3D "
  "low poly para Unity hecho solo con scripts de Blender y terminó como un juego web jugable en el móvil: un "
  "mundo isométrico de fantasía oscura donde un personaje pixel art iluminado por píxel se bate en duelo contra el "
  "<b>Autómata del bosque</b>, un enemigo que ataca en cadenas legibles y que aprende los hábitos del jugador.")
T([["Bloque", "Qué se hizo", "Resultado principal"],
   ["Modelado 3D (28-29/09)", "Atleta low poly (v1, v2, v3), base mesh femenino, maniquí masculino. Todo por scripts de Python (bpy).",
    "FBX/GLB listos para Unity; atleta v3 de 10 320 triángulos con rig de 56 huesos y 5 animaciones; base mesh solo quads con UVs; maniquí de 1 566 quads."],
   ["pixel_char (29/09)", "Recorte y limpieza de 192 frames pintados, normal maps, especular, demo WebGL con luz por píxel.",
    "Atlas de 8 direcciones × 4 animaciones; demo táctil publicada; pruebas E2E 54/54."],
   ["El mundo (29-30/09)", "Mundo isométrico 7× mayor, integración del personaje, pies anclados y peso, nueva dirección de arte.",
    "Mundo de 80×80 baldosas con 5 zonas, A*, sombras, niebla, tinta; navegación 282/282 rutas; E2E 33/33."],
   ["Combate (30/09)", "17 hojas de combate procesadas; máquina de estados; controles táctiles y de teclado; el «eco».",
    "Combo, parry, bloqueo, esquiva, postura y remate; 31/31 pruebas en las 8 direcciones."],
   ["Autómata del bosque (30/09)", "20 hojas del enemigo, corregidas y procesadas; IA, ambiente y tres zonas.",
    "Enemigo 1.4× más alto con ojo emisivo que ilumina; 21/21 pruebas."],
   ["Duelo de timing (01/10)", "Parry por niveles, postura con tensión, ataques de duelista, defensa por lectura, entrenamiento.",
    "50/50 pruebas; bot con reacción humana ≥ 92 % en cada golpe; interfaz probada en escritorio y móvil (10/10)."]],
  widths=[3.2, 6.6, 7.2])
KEY("<b>Dónde verlo.</b> El juego está publicado en un enlace privado de Claude (artefacto): "
    "<b>https://claude.ai/artifact/ANHrkwwHE8urZjzme74NhG</b> (versión 7). Las capturas, GIF y listados de cada "
    "etapa están en las carpetas <i>review/</i> del repositorio, y el registro técnico detallado en los ficheros "
    "<i>PROGRESS.md</i> de cada proyecto.")

H2("1.1 Cronología")
T([["Fecha", "Trabajo"],
   ["28/09", "Atleta low poly: cuerpo base por SDF anatómico, modelo completo, rig, pesos, animaciones y exportación; v2 (sombreado, cara)."],
   ["29/09 (mañana)", "Atleta v3 por zonas; base mesh femenino (etapas 1-5 y una segunda iteración de 7 etapas); maniquí masculino (7 etapas)."],
   ["29/09 (tarde)", "pixel_char: recorte, volumen, demo WebGL y pruebas; primer mundo isométrico (etapas 1-4) y los 6 pasos de peso e integración."],
   ["30/09", "Dirección de arte de fantasía oscura (E1-E4) y robustez de la navegación; combate completo (E0-E6) y botón de guardia; el Autómata del bosque (E0-E5)."],
   ["01/10", "Duelo de timing: niveles de parry, postura con tensión, IA de duelista, defensa por lectura, entrenamiento, pruebas de justicia y publicación."]],
  widths=[2.6, 14.4])

H2("1.2 Forma de trabajar")
P("Todo el proyecto siguió el mismo método, que es en buena parte la razón de que el resultado sea fiable:")
B(["<b>Todo por código.</b> Los modelos 3D se generan con scripts de Blender (bpy/bmesh); los sprites se procesan con "
   "Python (Pillow, NumPy, SciPy, OpenCV); el juego es JavaScript con three.js r128 empaquetado en un único HTML con "
   "los atlas embebidos en WebP. Cualquier resultado se puede reconstruir desde cero.",
   "<b>Revisión visual en cada paso.</b> Cada iteración produce comparativas (referencia frente a modelo, antes frente a "
   "después, hojas de contacto con los problemas marcados) que se revisaron antes de seguir.",
   "<b>Medir antes de afirmar.</b> Siluetas con IoU, deslizamiento del pie en píxeles, tiempos de reacción en "
   "milisegundos, porcentajes de desvío con un bot: cada mejora tiene su número.",
   "<b>Pruebas automáticas.</b> Playwright con Chromium (WebGL por SwiftShader) en perfiles de escritorio e iPhone, con "
   "una simulación determinista a paso fijo para que las pruebas sean repetibles.",
   "<b>Un commit por etapa</b> y un registro en <i>PROGRESS.md</i> con los problemas encontrados y cómo se resolvieron."])

# ================================================================ 2. modelado 3D
H1("2. Modelado 3D por scripts")
H2("2.1 Atleta low poly para Unity")
P("Personaje femenino deportivo low poly facetado construido solo con scripts de Python para Blender, a partir de una "
  "hoja de referencia con las vistas frontal, lateral y trasera. El entorno no permitía descargar Blender de su web "
  "(proxy) ni tenía pantalla: se usó Blender 4.0.2 de los repositorios de Ubuntu bajo <i>xvfb-run</i>.")
H3("Cómo se construyó")
B(["<b>Cuerpo base</b>: Skin modifier sobre un esqueleto de vértices → subdivisión → proyección sobre un "
   "<b>campo SDF anatómico</b> con unos 30 músculos (deltoides, dorsales, glúteos, cuádriceps, gemelos…) → relajación.",
   "<b>Ropa y detalles</b> por cortes implícitos: top, short con franjas, rodilleras, muñequeras, zapatillas retro, pelo con "
   "coleta, rasgos faciales y un atlas de colores planos (un solo material = una draw call).",
   "<b>Rig</b> compatible con Unity Humanoid (57 huesos con dedos y coleta), pesos por bone heat con correcciones y "
   "5 animaciones: APose, Idle, Walk, Run y Jump (la coleta reacciona con retraso).",
   "<b>Exportación</b> FBX y GLB verificada reimportando, con instrucciones para Unity (Humanoid, filtro Point)."])
H3("Versiones")
T([["", "v1", "v2", "v3"],
   ["Triángulos", "9 329", "9 085", "10 320"],
   ["IoU de silueta (frente/perfil/espalda)", "—", "0.843 / 0.845 / 0.847", "0.852 / 0.840 / 0.868"],
   ["Novedades", "modelo, rig y animaciones", "sombreado pintado por AO, músculos más marcados, cara más clara",
    "refinado por zonas: silueta, musculatura, ropa, coleta de 6 mechones con 4 huesos con muelle y cara pintada en el atlas"]],
  widths=[4.2, 3.4, 4.4, 5.0])
IMGF("atleta_v3", "Atleta v3: referencia frente al modelo en las tres vistas.")
IMGF("atleta_cara", "Atleta v3: la cara pintada en el atlas (ojos almendrados, cejas, nariz y boca).")

H2("2.2 Base mesh femenino")
P("Cuerpo base de 1,70 m solo con quads, pensado para deformar bien en animación, modelado por poly modeling con "
  "bmesh a partir de una hoja de referencia. Se hizo en 5 etapas (torso y pelvis, piernas y pies, brazos y manos, cuello "
  "y cabeza, unión y validación) y una segunda iteración de 7 etapas para la cara (loops de ojos, boca y nasolabial, oreja "
  "con hélix), el deltoides, los glúteos, las manos con 3 loops por nudillo, el pie y las UVs.")
T([["", "Quads", "Triángulos", "Vértices"],
   ["LOD1 (jaula)", "3 390", "6 780", "3 392"],
   ["LOD0 (Subdivision nivel 1)", "13 560", "27 120", "13 562"]], widths=[6, 3.5, 3.5, 4])
P("La validación automática (bmesh) da 0 n-gons, 0 polos de más de 5 aristas, 0 aristas no manifold, 0 normales "
  "invertidas, 0 autointersecciones y simetría exacta; ningún polo cae en una zona de pliegue. Las UVs tienen 32 islas "
  "sin un solo píxel solapado (rasterizadas a 2048²) y aprovechan el 72 % del espacio. Hay un test de deformación con "
  "5 poses extremas y un visor web con modos arcilla, malla y UV.")
IMGF("basemesh", "Base mesh femenino: comparativa final con la hoja.")

H2("2.3 Maniquí masculino facetado")
P("Base mesh low/mid poly de un hombre atlético de 1,80 m y 8 cabezas, en 7 etapas (blockout, torso por planos, "
  "brazos y piernas, manos y pies, cuello y cabeza, limpieza y validación, deformación y exportación). Las transiciones "
  "de densidad siguen una tabla de patrones de topología (Linear Stepping, FourPointTriangle, Bridge, Parallel Division).")
T([["Dato", "Valor"],
   ["Caras", "1 566 quads (0 triángulos, 0 n-gons) · 3 132 triángulos al triangular"],
   ["Topología", "superficie cerrada, manifold, sin duplicados ni autointersecciones, simetría exacta"],
   ["Loops en articulaciones", "hombro 4 · codo 4 · muñeca 3 · rodilla 3 · tobillo 3"],
   ["Ajuste a la hoja", "bordes dentro de ±1 cm: frente 92 %, perfil 88 %, espalda 85 % (IoU 0.926 / 0.929 / 0.891)"]], widths=[4.5, 12.5])
IMGF("maniqui", "Maniquí masculino: hoja de referencia frente al modelo.")

# ================================================================ 3. pixel_char
H1("3. pixel_char: un personaje pixel art que se ilumina como un objeto 3D")
P("A partir de aquí el proyecto cambió de rumbo: un personaje isométrico hecho con sprites 2D pintados (8 hojas: idle, "
  "walk, run y jump en 8 direcciones, 6 frames cada una) al que se le da volumen para iluminarlo por píxel.")
H2("3.1 Recorte y limpieza (etapa 1)")
P("Las hojas no eran uniformes: tamaños distintos, filas desplazadas, fondos de tono parecido a la ropa, sombras y "
  "baldosas pintadas. El recorte detecta la rejilla por las líneas separadoras y los números de columna, separa el fondo "
  "por su tinte frío, suaviza el borde sin halo y normaliza escala y pivote para que los pies caigan siempre en el mismo "
  "punto. Problemas corregidos, entre otros:")
B(["El salto SW mostraba al personaje de espaldas → espejo del salto SE; el salto S tenía el diseño espejado → espejado.",
   "Escala inconsistente entre filas (194-226 px de alto) → escala por fila combinando altura y radio del casco.",
   "Pies a distinta altura respecto a la baldosa → pivote en el centro de la baldosa de cada frame y corrección subpíxel.",
   "Tonos distintos entre hojas → corrección de color por material (crema/dorado, verde, negro) sin aplanar el sombreado."])
H2("3.2 Volumen (etapa 2)")
P("Para cada frame se calcula un <b>mapa de alturas</b> (bisel global, bisel por pieza a partir de las líneas de contorno y "
  "detalle pintado) y de él un <b>normal map</b> (convención OpenGL/Unity) y una <b>máscara especular</b> por material "
  "(metal crema muy brillante, tela verde casi mate). Todo se empaqueta en atlas con su JSON.")
IMGF("pix_volumen", "Sprite, normal map, especular y resultado iluminado (walk).", 14)
H2("3.3 Demo WebGL y pruebas (etapas 3-4)")
P("Demo de un solo archivo HTML: luz por píxel con difusa envolvente, Blinn-Phong según la máscara, luz de borde, "
  "sombra proyectada del frame actual y control táctil (tocar para ir, mantener para seguir al dedo, doble toque para "
  "saltar). La fase de la animación sale de la distancia recorrida, así que los pies no patinan. Las pruebas E2E "
  "(escritorio e iPhone 13 con toques reales) pasaron 54/54 tras corregir lo que encontraron: precisión de shaders en "
  "Chrome, seguimiento del dedo demasiado lento, desplazamiento en el doble toque y tamaño en el iPhone.")
IMGF("pix_demo", "Demo pixel_char en escritorio y en iPhone.", 14)

# ================================================================ 4. mundo
H1("4. El mundo isométrico")
H2("4.1 Mundo, integración y controles (etapas 1-4)")
B(["<b>Mundo 7× mayor</b> que la referencia: 80×80 baldosas, 5 zonas, senderos, alturas en escalones, agua, mesetas y "
   "acantilados; geometría fusionada por chunks para que el descarte por frustum funcione; 8 luces puntuales reasignadas; "
   "post-proceso pixel art a 1/3 de resolución.",
   "<b>El personaje pertenece al mundo</b>: sprite vertical que recibe las mismas luces (hemisférica, sol con su mapa de "
   "sombras, luces puntuales) con su normal map, proyecta sombra, se tapa correctamente con la profundidad y reacciona "
   "(ondas al pisar charcos, hierba que se dobla, polvo al aterrizar).",
   "<b>Animación de caminar</b> mejorada: 5 variantes comparadas lado a lado (tiempos, bob y balanceo, túnica con muelle, "
   "zancada medida en los pies). Los intermedios por flujo óptico se probaron y se descartaron con evidencia.",
   "<b>Controles con A*</b> sobre una rejilla de 0,5 u, cámara que gira en pasos de 90°, zoom, tamaño de píxel y silueta "
   "translúcida cuando algo lo tapa."])
IMGF("mundo_integrado", "El personaje integrado con la luz de tres zonas distintas.", 9)
H2("4.2 Peso e integración: que no levite (etapa 5, 6 pasos)")
T([["Paso", "Qué se hizo", "Medida"],
   ["1 · Pies anclados", "Detección de las botas en cada frame; IK 2D de la pierna en el shader para que la bota apoyada se quede en su punto.",
    "Deslizamiento del pie: de lado 2,40 → 0,00 px; en diagonal 1,36 → 0,00 px"],
   ["2 · Contacto", "Sombra por bota, sombra proyectada que nace en el pie apoyado, oclusión y rebote del color del suelo.", "—"],
   ["3 · Impacto", "Pisadas según el terreno (polvo, gotas, hojas, esquirlas), hierba aplastada, huellas, hundimiento y sonido.", "Hundimiento 1,5-2 px"],
   ["4 · Inercia", "Arranque progresivo, asentamiento al frenar, inclinación al correr.", "90 % de velocidad en 0,23 s"],
   ["5 · Misma materia", "Paleta compartida con el mundo, contorno de 1 px y pie exactamente sobre la superficie.", "Desfase del pie 0 px en 129 frames"],
   ["6 · Pruebas", "Escalones con el pie de apoyo, charcas y frenado.", "13/13 y E2E 31/31"]], widths=[3, 9, 5])
IMGF("mundo_pies", "Pies anclados: la bota apoyada se queda en su punto del suelo.", 9)
H2("4.3 Nueva dirección de arte: fantasía oscura (E1-E4)")
P("Con cinco imágenes de referencia (árboles retorcidos, cueva bioluminiscente, bosque muerto, árbol hueco con farol y un "
  "titán esqueleto) se rehízo el aspecto del mundo:")
B(["<b>Look de ilustración</b>: paleta de 46 tonos sacada de las referencias, tinta por profundidad y normales, sombreado de "
   "líneas en lo oscuro, niebla por altura que se abre alrededor del personaje, día nublado, viñeta, grano, partículas "
   "(hojas, ceniza, esporas, luciérnagas) y rayos de luz entre las copas.",
   "<b>Zonas rehechas</b>: el titán caído (se camina entre sus costillas y se sube a la palma de su mano), el bosque "
   "retorcido, las charcas bioluminiscentes, el cementerio con niebla y el árbol del farol, con restos de ciencia ficción "
   "(terminales que parpadean, placas, balizas).",
   "<b>Sentimiento al caminar</b>: luz que envuelve según la cobertura, brillo del visor en la oscuridad, pisadas según el "
   "terreno (agua con reflejo, hojas, metal con chispa), cámara con retraso, primer plano con ramas en paralaje y audio "
   "ambiental sintetizado (viento, goteo, zumbido eléctrico).",
   "<b>Pruebas</b>: E2E 33/33, peso 13/13 y una prueba de estrés de navegación que destapó cuatro fallos de A* y del "
   "suavizado; tras corregirlos, 282/282 rutas aleatorias llegan a su destino."])
IMGF("mundo_refs", "Cada zona del mundo junto a su imagen de referencia.", 12)

# ================================================================ 5. combate
H1("5. Combate")
H2("5.1 Hojas de combate (E0-E2)")
P("17 hojas nuevas (attack1-3, parry, block, dodge, hit, death) con las etiquetas de fase de cada frame (ANTICIPATION, "
  "WIND UP, SWING, IMPACT…). Se revisó su congruencia con el resto del personaje y se marcó cada problema como "
  "(a) corregido con código o (b) para regenerar. Por ejemplo, la fila SW de attack1 estaba de espaldas (espejo de SE) y "
  "las hojas de parry, block, dodge, hit y death eran más rojas y saturadas (color por zonas en Lab). Después se generaron "
  "normales, especular y <b>emisión</b> de la cuchilla, y un JSON con fases, duraciones, ventanas de cancelación y frames "
  "invulnerables: una sola fuente de verdad para la animación y la lógica.")
IMGF("combate_mapas", "Mapas del combate de noche: solo la cuchilla y el tajo brillan sin luz.", 9)
H2("5.2 Sistema de combate, controles y el eco (E3-E6)")
B(["<b>Máquina de estados</b> común a jugador y enemigo: combo attack1 → attack2 → attack3 con búfer de 180 ms, hitbox en "
   "arco activa solo en el frame IMPACT, atracción suave hacia el objetivo.",
   "<b>Defensa</b>: parry con ventana de 200 ms desde la pulsación (con penalización por spam), bloqueo que gasta stamina "
   "hasta romper la guardia, esquiva con frames invulnerables, postura que lleva al aturdido y al remate.",
   "<b>Sensación de impacto</b>: hitstop, sacudida de cámara en la dirección del golpe, destellos, chispas según el "
   "terreno y sonidos sintetizados.",
   "<b>Controles</b>: tocar al enemigo para atacar, deslizar para esquivar, botón GUARDIA (tocar = parry, mantener = "
   "bloqueo); teclado WASD, J, K, Espacio y L.",
   "<b>El eco</b>: enemigo de prueba con las mismas hojas recoloreadas en frío, IA con A* y aviso antes de cada golpe.",
   "<b>Pruebas</b>: 31/31 en las 8 direcciones (combo, parry, bloqueo, esquivas, cancelaciones, IA, teclado, ratón y móvil)."])
IMGF("combate", "Combate contra el eco: golpe de salto, parry que ilumina a los dos y remate.")

# ================================================================ 6. autómata
H1("6. El Autómata del bosque")
P("El enemigo definitivo: una máquina oxidada cubierta de musgo y raíces, con un único ojo cian. Se le dieron 20 hojas "
  "propias (idle, walk, run, attack1, attack2, parry, hit, block, dodge y death en 8 direcciones). El eco no se borró: "
  "se movió a su propio módulo y se puede volver a usar desde el panel de pruebas.")
H2("6.1 Hojas: recorte, congruencia y procesado (E0-E2)")
B(["Cuadrícula detectada en cada hoja a partir del propio texto (los títulos estaban centrados o arriba a la izquierda) y "
   "etiquetas de fase guardadas en JSON.",
   "Direcciones corregidas midiendo la posición del ojo respecto al cuerpo: idle E y SE, hit NE/E/SE, attack1 y attack2 SW, "
   "parry SW y block SW/W se sustituyeron por espejos de las filas correctas.",
   "Color por zonas: attack y parry estaban más naranjas y saturados y hit, block, dodge y death más pálidos; tras la "
   "corrección el musgo ocupa el 41-42 % del color en las 20 hojas y el ojo cian no se toca.",
   "Normales, especular por material (placas con brillo, musgo mate), emisión del ojo con su posición por frame para poner "
   "una luz real que ilumina su entorno, pies anclados y 1,4 veces la altura del personaje."])
IMGF("auto_color", "Corrección de color por zonas: antes (arriba) y después (abajo).")
H2("6.2 Comportamiento y ambiente (E3-E5)")
B(["Patrulla lenta, persecución corriendo con A*, ataques con preparación larga y el ojo parpadeando como aviso.",
   "Pasos pesados que hacen temblar un poco la cámara y levantan polvo y esporas; zumbido grave al preparar los ataques; "
   "la luz del ojo lo delata en la oscuridad.",
   "Tres puntos del mapa (junto al titán, el bosque de raíces y las ruinas) con botón para reaparecer; al morir se queda "
   "en el suelo y se desvanece entre esporas.",
   "Pruebas 21/21, regresión del eco 31/31 y del mundo 13/13 y 33/33."])
IMGF("auto_8dir", "El autómata en el mundo atacando en las 8 direcciones.")
IMGF("auto_estados", "Aviso, bloqueo, parry, esquiva, aturdido, muerte y desvanecimiento.")

# ================================================================ 7. duelo
H1("7. Duelo de timing: parry por niveles y una IA que te lee")
P("El último proyecto convirtió el combate en un <b>duelo de timing y lectura</b>, no en un hack-and-slash, pero justo: "
  "todo lo que hace el enemigo se puede leer y aprender. Antes de tocar nada se revisó el sistema y se decidió qué se "
  "conservaba (la máquina de estados, la ventana de 200 ms, el spam y el parry parcial, la resolución de golpes, el eco "
  "intacto) y qué cambiaba (la forma de medir el tiempo, la postura y toda la IA del autómata).")
H2("7.1 Etapa 1 · Niveles de parry")
P("El tiempo de la defensa se medía con el frame en que se procesaba el golpe; en un móvil a 20 fps eso son hasta 50 ms de "
  "error. Ahora hay un <b>reloj de combate común</b>, el <b>instante exacto del impacto</b> (descontando lo que el frame se "
  "pasó) y la <b>marca de tiempo del evento</b> de entrada (event.timeStamp), más una calibración de latencia.")
T([["Nivel", "Cuándo", "Postura al enemigo", "Tu postura", "Extra"],
   ["PERFECTO", "últimos 70 ms", "×1,33", "0", "chispas doradas, sonido propio, hitstop mayor y 350 ms de contraataque (×1,6 de daño, no se defiende)"],
   ["NORMAL", "resto de la ventana de 200 ms", "×1,0", "+7 (+10 pesado)", "—"],
   ["BLOQUEO", "fuera de ventana con guardia", "0", "+18 (+26)", "gasta stamina; sin ella, guardia rota"]],
  widths=[2.2, 3.4, 2.6, 2.4, 6.4])
P("En el panel de pruebas hay un deslizador de latencia y una <b>prueba de ritmo</b> (10 pulsos con destello y clic): la "
  "mediana del desfase de tus toques desplaza la ventana para pantallas táctiles lentas.")
IMGF("duelo_perfecto_guardia", "Izquierda: parry perfecto con chispas doradas y la barra de contraataque. Derecha: el autómata alza la guardia con el ojo ámbar porque ha leído tu siguiente golpe.")
H2("7.2 Etapa 2 · Postura con tensión (estilo Sekiro)")
B(["Tu postura sube poco al desviar y mucho al bloquear; <b>un parry nunca la rompe</b> aunque la barra esté llena, un bloqueo sí.",
   "Con la guardia alta y sin recibir golpes, tu postura se recupera casi tres veces más rápido.",
   "El autómata gana 18-28 de postura por desvío según el golpe y el nivel, más un bonus de +3 por cada desvío seguido en "
   "la misma cadena: hace falta desviar cadenas enteras.",
   "La recuperación depende de la vida restante: con el 30 % de vida se recupera unas cuatro veces más despacio."])
H2("7.3 Etapa 3 · El autómata ataca como un duelista")
P("Cada golpe tiene ahora un plan en dos tiempos: <b>carga</b> (el ojo parpadea), opcionalmente <b>retención</b> (ojo fijo) y "
  "<b>suelta</b> (destello del ojo y chasquido metálico; el golpe llega 0,36-0,46 s después). Ataca en cadenas de 2 a 4 "
  "golpes con ritmos distintos (rápido-rápido-lento, lento-pausa-rápido…) y a veces con un truco: un golpe retrasado que "
  "castiga a quien pulsa de memoria o una finta que cambia de golpe a mitad de la carga.")
T([["Ataque peligroso", "Pose", "Respuesta correcta"],
   ["Barrido bajo", "agachado, golpe a ras de suelo", "saltar; en el aire puedes contraatacar con daño extra"],
   ["Estocada", "encogido y lanzándose 2,3 u", "esquivar HACIA él: le pisas la estocada y le quitas mucha postura"],
   ["Agarre", "brazos en alto, persigue hasta 2,4 u", "esquivar de lado; hacia atrás, saltando o con guardia te atrapa"]],
  widths=[3.2, 5.6, 8.2])
P("Los peligrosos tienen un aviso rojo común (ojo, luz y «¡PELIGRO!») y una bocina grave, y se distinguen por la pose, "
  "hecha con frames de otras hojas y efectos por código. Reglas de justicia comprobadas: preparación visible de al menos "
  "350 ms en todo golpe (la mínima real es 0,48 s), avisos más evidentes cuanto más fuerte es el golpe, nunca ataca "
  "mientras estás en el suelo o encajando un golpe, y tras cada cadena una ventana de castigo de casi un segundo.")
IMGF("duelo_peligro", "Agarre y barrido bajo: el aviso rojo de los ataques peligrosos.")
H2("7.4 Etapa 4 · Defensa basada en leerte, no en dados")
P("Se quitaron las probabilidades al azar. El autómata registra tus acciones (cada golpe, cada finta, el final de su cadena) "
  "con el ritmo entre ellas y construye <b>trigramas</b> con memoria reciente. Si lo más probable es un ataque que ya ha "
  "visto, se compromete a defender en el instante previsto: alza la guardia con el ojo ámbar unos 200-250 ms antes y hace "
  "parry. Si cambias el ritmo, retrasas el golpe o fintas, su parry se queda en el aire y queda <b>expuesto</b>.")
B(["Reacción humana de 200-260 ms según la dificultad; nunca reacciona a algo más rápido (tu zarpazo de 205 ms solo lo para si lo ha leído).",
   "Tus herramientas: <b>finta</b> (guardia durante tu golpe, gasta stamina) y <b>retraso</b> (mantener el ataque).",
   "Su conocimiento se reinicia al reaparecer; dificultad adaptativa suave según tus muertes y tus parries perfectos.",
   "Medido: con el mismo combo y ritmo te desvía el 64 % de los golpes; variando, solo el 13 %."])
H2("7.5 Etapa 5 · Práctica y lectura")
P("Modo entrenamiento en el panel: el autómata repite la cadena elegida sin defenderse y nadie muere; tras cada golpe un "
  "indicador dice cuántos milisegundos antes pulsaste y el nivel (PERFECTO · 45 ms antes), o si llegaste tarde, y en los "
  "peligrosos la respuesta correcta. Las barras de postura de los dos se ven siempre en combate, con la ventana de "
  "contraataque bajo la tuya; en el móvil se colocan solas para no tapar los botones.")
IMGF("duelo_hud", "Entrenamiento y barras centrales en escritorio (izquierda) y en móvil (derecha).")
H2("7.6 Etapa 6 · Pruebas de justicia")
P("Un bot con reacción humana (250 ms ± 40 ms de error, distribución normal) intentó desviarlo todo en 208 cadenas. Antes "
  "de ajustar, dos ataques no llegaban al 75 % pedido; se corrigieron y se anotó por qué:")
T([["Golpe", "Antes", "Después", "Causa y ajuste"],
   ["Zarpazo", "97 %", "99 %", "—"],
   ["Barrido (attack2)", "88 %", "93 %", "su suelta de 0,40 s dejaba la pulsación al borde de la ventana → 0,38 s"],
   ["Barrido retrasado", "71 %", "100 %", "misma causa"],
   ["Zarpazo retrasado / tras finta", "95 / 100 %", "97 / 92 %", "—"],
   ["Barrido bajo · estocada", "100 · 93 %", "100 · 100 %", "—"],
   ["Agarre", "71 %", "100 %", "la esquiva lateral solo contaba en sus frames invulnerables → ventana explícita de 40-340 ms, en la dirección correcta"]],
  widths=[4, 2.2, 2.2, 8.6])
P("En la primera medición el zarpazo salió al 68 %, pero no era el juego: el generador aleatorio del bot daba un primer "
  "número casi nulo con semillas pequeñas. Se corrigió antes de medir lo de la tabla. Además se probó la interfaz en "
  "escritorio y móvil con eventos reales (10/10), se grabaron dos GIF (el duelo completo y la lectura) y se publicó la "
  "versión 7 sobre el mismo enlace.")

# ================================================================ 8. pruebas
H1("8. Pruebas y calidad")
P("Baterías automáticas vigentes al final del proyecto (todas sin errores JavaScript):")
T([["Batería", "Qué cubre", "Resultado"],
   ["pixel_char e2e", "demo del personaje: movimiento, direcciones, salto, seguir al dedo, escritorio e iPhone", "54/54"],
   ["world e2e", "recorrido por el mapa, toques, escalones, charcas, salto, cámara, zoom (escritorio e iPhone)", "33/33"],
   ["world stage5", "deslizamiento del pie, escalones, charcas, frenado", "13/13"],
   ["navegación", "rutas aleatorias por todo el mapa", "282/282"],
   ["combat (eco)", "combo, parry, bloqueo, esquiva, cancelaciones, IA, controles, en 8 direcciones", "31/31"],
   ["enemy (autómata)", "aparición, persecución, avisos, parry, bloqueo, aturdido, muerte, panel", "21/21"],
   ["parry2", "niveles de parry, postura, cadenas, peligrosos, lectura, entrenamiento, bot humano", "50/50"],
   ["parry2_ui", "escritorio y móvil con eventos reales: marca de tiempo, retraso, finta, panel, solapes", "10/10"]],
  widths=[3.4, 10.6, 3])
P("Las pruebas usan una simulación determinista (paso fijo de 1/60 s) para que los resultados sean repetibles, y "
  "SwiftShader para el WebGL en un navegador sin GPU. Varias veces las pruebas encontraron fallos reales que se "
  "corrigieron: la navegación que se atascaba en esquinas con desnivel, el pie que se hundía al subir escalones, la "
  "guardia que no se rompía porque el autómata recuperaba stamina demasiado rápido o el agarre que era injusto.")

H2("8.1 Problemas notables y cómo se resolvieron")
T([["Proyecto", "Problema", "Solución"],
   ["Entorno", "No se podía descargar Blender (proxy) ni había pantalla para renderizar", "Blender 4.0.2 de apt y render bajo xvfb-run con Mesa"],
   ["Atleta", "Ajustar la silueta a la referencia a ojo era impreciso", "Comparativas automáticas con IoU y diferencias de silueta altura por altura"],
   ["pixel_char", "Fondos del mismo tono que la ropa y hojas de distinto tamaño", "Clasificador por tinte del fondo, rejilla por líneas y números, escala por casco"],
   ["Mundo", "El personaje parecía flotar y los pies patinaban", "IK 2D de la pierna en el shader con el pie anclado: 0,00 px de deslizamiento"],
   ["Mundo", "El cuerpo se hundía o flotaba al cruzar escalones", "La altura sale de la bota apoyada y se anticipa la siguiente pisada"],
   ["Mundo", "El personaje se atascaba en esquinas con desnivel (95,5 % de rutas bien)", "Cuatro arreglos en A* y en el suavizado: 282/282 rutas"],
   ["Combate", "Las hojas de combate eran más rojas y saturadas que el resto", "Color por zonas en Lab con cuantiles por familia de color"],
   ["Autómata", "Filas dibujadas mirando a la dirección equivocada", "Dirección medida con la posición del ojo y espejos de las filas correctas"],
   ["Autómata", "Su guardia no se rompía nunca bajo presión", "Recuperación de stamina propia, más lenta (12/s)"],
   ["Duelo", "En móvil a 20 fps el parry perdía hasta 50 ms", "Instante exacto del impacto y marca de tiempo del evento de entrada"],
   ["Duelo", "Una pulsación tardía por latencia táctil llegaba después de resolverse el golpe", "Con calibración positiva, el golpe se resuelve esos ms más tarde"],
   ["Duelo", "El agarre y el barrido no eran justos para una reacción humana", "Suelta del barrido 0,38 s y ventana de esquiva explícita en los peligrosos"]],
  widths=[2.6, 7.2, 7.2])

# ================================================================ 9. limitaciones
H1("9. Limitaciones y pendientes")
B(["<b>Rendimiento en un iPhone real</b>: no se puede medir desde el entorno de trabajo (navegador sin GPU). El presupuesto "
   "de geometría y draw calls se ha mantenido en el rango que ya funcionaba.",
   "<b>Audio</b>: todos los sonidos son sintetizados con WebAudio; solo se comprueba que no dan errores, no se pueden escuchar aquí.",
   "<b>Sprites para regenerar</b> (marcados como (b) en las revisiones): attack3 IMPACT en N, NE, E, W y NW del personaje; "
   "la fila N de hit del autómata y su hit_1 en NE/E/SE (ahora espejos); el ojo algo más pequeño en algunas hojas del autómata.",
   "<b>Marcha más lenta</b>: para que los pies no patinen, el personaje anda a 0,8-1,25 u/s, que es lo que permiten unas "
   "piernas dibujadas que apenas avanzan.",
   "<b>Bioluminiscencia y copas</b>: brillan menos que en las referencias y las copas son racimos poligonales."])

# ================================================================ 10. anexo
H1("10. Anexo")
H2("10.1 Mapa del repositorio")
T([["Carpeta", "Contenido"],
   ["scripts/, export/, renders/, v2/, v3/, web/", "Atleta low poly: scripts de Blender, FBX/GLB/blend, renders y visor web"],
   ["base_mesh/", "Base mesh femenino: scripts, exportes LOD0/LOD1, renders, visor"],
   ["mannequin_male/", "Maniquí masculino: scripts, exportes, renders, visor"],
   ["pixel_char/tools/", "Procesado de sprites: recorte, color, normales, especular, emisión, atlas, revisiones"],
   ["pixel_char/out/, pixel_char/review/", "Atlas y JSON generados; revisiones de cada etapa (stage1-4, combat, enemy, parry2)"],
   ["pixel_char/world/src/", "El juego: mundo, personaje, combate, enemigos (eco y autómata), entrenamiento, controles"],
   ["pixel_char/world/tests/", "Pruebas Playwright y grabadores de GIF"],
   ["pixel_char/world/dist/index.html", "El juego empaquetado en un único HTML (13,4 MB)"]], widths=[5.5, 11.5])
H2("10.2 Cómo reconstruir y probar")
story.append(Paragraph("cd pixel_char/world<br/>python3 tools/build.py dist/index.html<br/>cd tests &amp;&amp; source env.sh<br/>"
                       "node parry2.mjs ../dist/index.html salida/      # duelo (STAGES=1..6)<br/>"
                       "node enemy.mjs ../dist/index.html salida/       # autómata<br/>"
                       "HASH=\"#enemy=echo\" node combat.mjs ../dist/index.html salida/   # eco<br/>"
                       "HASH=\"#enemy=none\" node e2e.mjs ../dist/index.html salida/     # recorrido del mundo", ST["mono"]))
P("Para volver al eco: botón ⚙ → Enemigo: «Eco (prueba)», o añadir #enemy=echo a la dirección, o W.setEnemyType(\"echo\") en la consola.")
H2("10.3 Enlaces publicados (artefactos privados de Claude)")
T([["Qué", "Enlace"],
   ["El juego (versión 7)", "https://claude.ai/artifact/ANHrkwwHE8urZjzme74NhG"],
   ["Visor de variantes de caminar", "https://claude.ai/artifact/Qj1gjyHi6ZWqfwD5vY12c1"],
   ["Primera demo pixel_char", "https://claude.ai/artifact/D3MKMn1CTffmSTreZWg6oS"]], widths=[5, 12])
H2("10.4 Lista de commits")
rows = [["Commit", "Fecha", "Descripción"]]
for line in open(os.path.join(HERE, "commits.txt"), encoding="utf-8"):
    h, d, s = line.rstrip("\n").split("|", 2)
    rows.append([h, d, s.replace("&", "&amp;").replace("<", "&lt;")])
MONO = ParagraphStyle("m", fontName="DVM", fontSize=7.4, leading=9.6, textColor=INK)
data = [[Paragraph(c, (MONO if j == 0 else ST["small"]) if i else ST["cellb"]) for j, c in enumerate(r)] for i, r in enumerate(rows)]
t = Table(data, colWidths=[1.85 * cm, 2.0 * cm, 13.15 * cm], repeatRows=1)
t.setStyle(TableStyle([("GRID", (0, 0), (-1, -1), 0.3, LINE), ("BACKGROUND", (0, 0), (-1, 0), ACC), ("VALIGN", (0, 0), (-1, -1), "TOP"),
                       ("TOPPADDING", (0, 0), (-1, -1), 2), ("BOTTOMPADDING", (0, 0), (-1, -1), 2)]))
story.append(t)

doc.multiBuild(story)
print("PDF:", OUT)
