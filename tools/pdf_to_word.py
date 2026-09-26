#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
pdf_to_word.py
==============
Convierte un PDF a Word (.docx) RESPETANDO el diseño original:

  1. Orden real de lectura  -> se ordenan bloques, tablas e imágenes por sus
     coordenadas espaciales usando el bbox (eje Y de arriba->abajo,
     eje X de izquierda->derecha).
  2. Fuente exacta y estilo -> se lee el nombre de la fuente y los `flags`
     de cada "span" para detectar negrita / cursiva.
  3. Tamaño exacto de letra -> se lee `size` (en puntos) de cada span.
  4. Posición / indentación -> la coordenada X del bloque pasa a la sangría
     izquierda del párrafo y el hueco vertical al espacio anterior.

  + TABLAS  -> se detectan con page.find_tables() y se reconstruyen como
              TABLAS REALES de Word (no como texto suelto).
  + OCR     -> si una página es una imagen/escaneada (sin texto), se reconoce
              con Tesseract vía page.get_textpage_ocr(), y luego se procesa
              con el MISMO pipeline (así conserva orden, tamaño y posición).

--------------------------------------------------------------------------
INSTALACIÓN DE DEPENDENCIAS
--------------------------------------------------------------------------
  # Librerías de Python
    python -m pip install --upgrade pip
    python -m pip install pymupdf python-docx

  # Motor OCR (solo si convertirás PDF escaneados). Necesita el binario
  # Tesseract instalado en el sistema:
    #  Debian/Ubuntu:
    sudo apt-get install tesseract-ocr tesseract-ocr-spa tesseract-ocr-eng
    #  macOS (Homebrew):
    brew install tesseract tesseract-lang
    #  Windows: instalar desde https://github.com/UB-Mannheim/tesseract/wiki
    #
    # PyMuPDF localiza Tesseract mediante la variable de entorno
    # TESSDATA_PREFIX (carpeta 'tessdata'). Si el OCR falla, expórtala, p. ej.:
    #   export TESSDATA_PREFIX=/usr/share/tesseract-ocr/5/tessdata
    # o pásala con  --tessdata /ruta/a/tessdata

USO
    python pdf_to_word.py entrada.pdf salida.docx
    python pdf_to_word.py entrada.pdf                      # -> entrada.docx
    python pdf_to_word.py entrada.pdf --ocr --lang spa+eng # forzar OCR
    python pdf_to_word.py entrada.pdf --no-tablas          # desactivar tablas
    python pdf_to_word.py entrada.pdf --imagenes           # incrustar imágenes
--------------------------------------------------------------------------

ESTRUCTURA DEL DICCIONARIO DE PyMuPDF  (page.get_text("dict"))
--------------------------------------------------------------------------
    { "width":.., "height":.., "blocks":[ bloque, ... ] }

  BLOQUE : { "type": 0=texto|1=imagen, "bbox":(x0,y0,x1,y1), "lines":[...] }
  LÍNEA  : { "bbox":(x0,y0,x1,y1), "dir":(cos,sen), "spans":[...] }
  SPAN   : { "text":"..", "font":"ABCDEF+Arial-BoldMT", "size":11.04,
             "flags":20, "color":0, "bbox":(..), "origin":(x,y) }

`flags` es una MÁSCARA DE BITS (se comprueba con AND de bits):
    1  -> superíndice   2 -> CURSIVA   4 -> serifa
    8  -> monoespaciada 16 -> NEGRITA
  Ej.:  es_negrita = bool(flags & 16)   ;   es_cursiva = bool(flags & 2)
"""

import os
import io
import sys
import argparse

import fitz  # PyMuPDF

from docx import Document
from docx.shared import Pt, RGBColor
from docx.oxml.ns import qn


# --- Bits de `flags` (ver docstring) ---------------------------------------
FLAG_ITALIC = 2
FLAG_BOLD = 16


# ===========================================================================
# UTILIDADES DE FORMATO
# ===========================================================================
def int_a_rgb(color_int):
    """Color empaquetado (entero sRGB 0xRRGGBB de PyMuPDF) -> RGBColor."""
    if not color_int:
        return RGBColor(0, 0, 0)
    return RGBColor((color_int >> 16) & 0xFF, (color_int >> 8) & 0xFF, color_int & 0xFF)


def limpiar_nombre_fuente(font):
    """Nombre de fuente utilizable por Word.

    PyMuPDF antepone un prefijo de "subset" de 6 letras y '+' (p.ej.
    'ABCDEF+Arial-BoldMT'); no es parte del nombre real y se elimina.
    """
    if not font:
        return "Calibri"
    if "+" in font:
        font = font.split("+", 1)[1]
    for suf in ("-BoldItalic", "-BoldOblique", "-Italic", "-Oblique",
                "-Bold", "-Regular", "-Roman", "MT", "PSMT", "PS"):
        if font.endswith(suf):
            font = font[: -len(suf)]
    return font.replace("-", " ").strip() or "Calibri"


def estilo_desde_flags(flags):
    """(negrita, cursiva) leyendo la máscara de bits `flags`."""
    return bool(flags & FLAG_BOLD), bool(flags & FLAG_ITALIC)


def fijar_fuente_run(run, nombre):
    """Asigna la fuente al run para todos los alfabetos (ascii/hAnsi/cs/eastAsia)."""
    run.font.name = nombre
    rpr = run._element.get_or_add_rPr()
    rfonts = rpr.find(qn("w:rFonts"))
    if rfonts is None:
        rfonts = rpr.makeelement(qn("w:rFonts"), {})
        rpr.append(rfonts)
    for attr in ("w:ascii", "w:hAnsi", "w:cs", "w:eastAsia"):
        rfonts.set(qn(attr), nombre)


# ===========================================================================
# ORDEN DE LECTURA
# ===========================================================================
def clave_lectura(bbox, tol_y=3.0):
    """Clave de ordenamiento por lectura: franja horizontal (Y) y luego X.

    Agrupar por franjas (round(y0/tol)) evita que dos elementos casi a la misma
    altura se intercalen por diferencias mínimas en Y.
    """
    return (round(bbox[1] / tol_y), bbox[0])


# ===========================================================================
# TABLAS
# ===========================================================================
def rect_de(bbox):
    return fitz.Rect(bbox)


def bloque_dentro_de_tabla(bloque_bbox, tablas_rect):
    """True si el CENTRO del bloque cae dentro de alguna tabla detectada."""
    r = rect_de(bloque_bbox)
    cx, cy = (r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2
    for tr in tablas_rect:
        if tr.contains(fitz.Point(cx, cy)):
            return True
    return False


def agregar_tabla(doc_out, tabla):
    """Reconstruye una tabla detectada como TABLA REAL de Word.

    tabla.extract() devuelve una lista de filas; cada fila es una lista de
    celdas (texto o None). Se rellena una tabla de Word con bordes.
    """
    datos = tabla.extract()
    if not datos:
        return
    n_filas = len(datos)
    n_cols = max((len(f) for f in datos), default=0)
    if n_filas == 0 or n_cols == 0:
        return
    wt = doc_out.add_table(rows=n_filas, cols=n_cols)
    try:
        wt.style = "Table Grid"   # bordes visibles
    except Exception:
        pass
    wt.autofit = True
    for i, fila in enumerate(datos):
        for j in range(n_cols):
            val = fila[j] if j < len(fila) else ""
            wt.cell(i, j).text = ("" if val is None else str(val)).strip()


# ===========================================================================
# TEXTO
# ===========================================================================
def agregar_bloque_texto(doc_out, bloque, estado):
    """Vuelca un bloque de texto (type==0) respetando orden, fuente, tamaño,
    estilo, color y posición aproximada. `estado` guarda prev_y1 entre llamadas."""
    lineas = sorted(bloque.get("lines", []), key=lambda l: clave_lectura(l["bbox"]))
    for linea in lineas:
        spans = sorted(linea.get("spans", []), key=lambda s: s["bbox"][0])
        if not any(s.get("text", "").strip() for s in spans):
            continue

        parrafo = doc_out.add_paragraph()
        pf = parrafo.paragraph_format

        # 4) POSICIÓN: X0 de la línea -> sangría izquierda.
        x0 = linea["bbox"][0]
        pf.left_indent = Pt(max(0.0, x0))

        # Hueco vertical respecto al elemento anterior -> espacio antes.
        y0 = linea["bbox"][1]
        if estado["prev_y1"] is not None:
            gap = y0 - estado["prev_y1"]
            pf.space_before = Pt(min(max(gap, 0.0), 60.0))
        else:
            pf.space_before = Pt(0)
        pf.space_after = Pt(0)
        alto = linea["bbox"][3] - linea["bbox"][1]
        if alto > 0:
            pf.line_spacing = Pt(alto)

        # 2) y 3) Un RUN por span, copiando fuente/tamaño/estilo/color.
        for span in spans:
            texto = span.get("text", "")
            if texto == "":
                continue
            run = parrafo.add_run(texto)
            fijar_fuente_run(run, limpiar_nombre_fuente(span.get("font", "")))
            negrita, cursiva = estilo_desde_flags(span.get("flags", 0))
            run.font.bold = negrita
            run.font.italic = cursiva
            tam = span.get("size")
            if tam and tam > 0:
                run.font.size = Pt(tam)
            run.font.color.rgb = int_a_rgb(span.get("color", 0))

        estado["prev_y1"] = linea["bbox"][3]


def insertar_imagen(doc_out, bloque):
    """Inserta la imagen de un bloque (type==1) de forma INLINE."""
    try:
        ancho_pt = bloque["bbox"][2] - bloque["bbox"][0]
        p = doc_out.add_paragraph()
        p.add_run().add_picture(io.BytesIO(bloque["image"]), width=Pt(min(ancho_pt, 468)))
    except Exception as e:
        print(f"  [aviso] imagen no incrustada: {e}", file=sys.stderr)


# ===========================================================================
# OCR
# ===========================================================================
def dict_con_ocr(pagina, lang):
    """Devuelve el diccionario de texto de una página aplicando OCR.

    page.get_textpage_ocr(full=True) rasteriza la página y la pasa por
    Tesseract, devolviendo un TextPage con spans (texto + bbox + tamaño).
    Luego page.get_text("dict", textpage=tp) usa ese resultado, así que el
    resto del pipeline (orden, posición, tamaño) funciona igual que con texto
    nativo.
    """
    tp = pagina.get_textpage_ocr(flags=0, language=lang, dpi=300, full=True)
    return pagina.get_text("dict", textpage=tp)


def pagina_tiene_texto(info, minimo=15):
    """Suma la longitud del texto de todos los spans de la página."""
    total = 0
    for b in info.get("blocks", []):
        if b.get("type") != 0:
            continue
        for l in b.get("lines", []):
            for s in l.get("spans", []):
                total += len((s.get("text") or "").strip())
    return total >= minimo


# ===========================================================================
# CONVERSIÓN PRINCIPAL
# ===========================================================================
def convertir(pdf_path, docx_path, incrustar_imagenes=False,
              usar_ocr=True, lang="spa+eng", detectar_tablas=True):
    doc_pdf = fitz.open(pdf_path)
    doc_out = Document()
    doc_out.styles["Normal"].font.name = "Calibri"
    doc_out.styles["Normal"].font.size = Pt(11)

    for num_pagina, pagina in enumerate(doc_pdf):
        # --- Tamaño de página de salida = tamaño real del PDF --------------
        seccion = doc_out.sections[-1] if num_pagina == 0 else doc_out.add_section()
        seccion.page_width = Pt(pagina.rect.width)
        seccion.page_height = Pt(pagina.rect.height)
        seccion.left_margin = seccion.right_margin = Pt(0)
        seccion.top_margin = seccion.bottom_margin = Pt(0)

        # --- Texto estructurado (con OCR si la página es imagen) -----------
        info = pagina.get_text("dict")
        uso_ocr = False
        if usar_ocr and not pagina_tiene_texto(info):
            try:
                info = dict_con_ocr(pagina, lang)
                uso_ocr = True
            except Exception as e:
                print(f"  [aviso] OCR falló en pág {num_pagina + 1}: {e}", file=sys.stderr)

        # --- Detección de tablas (no sobre páginas OCR rasterizadas) -------
        tablas = []
        if detectar_tablas and not uso_ocr:
            try:
                tablas = list(pagina.find_tables().tables)
            except Exception:
                tablas = []
        tablas_rect = [rect_de(t.bbox) for t in tablas]

        # --- Construir lista de ELEMENTOS con su bbox y ordenarla ----------
        # (texto fuera de tablas) + (tablas) + (imágenes) -> orden de lectura.
        elementos = []
        for b in info.get("blocks", []):
            if b.get("type") == 0:
                if not bloque_dentro_de_tabla(b["bbox"], tablas_rect):
                    elementos.append(("texto", b, b["bbox"]))
            elif b.get("type") == 1 and incrustar_imagenes:
                elementos.append(("imagen", b, b["bbox"]))
        for t in tablas:
            elementos.append(("tabla", t, t.bbox))
        elementos.sort(key=lambda e: clave_lectura(e[2]))

        # --- Emitir en orden ----------------------------------------------
        estado = {"prev_y1": None}
        for tipo, obj, _bbox in elementos:
            if tipo == "texto":
                agregar_bloque_texto(doc_out, obj, estado)
            elif tipo == "tabla":
                agregar_tabla(doc_out, obj)
                estado["prev_y1"] = obj.bbox[3]
            elif tipo == "imagen":
                insertar_imagen(doc_out, obj)
                estado["prev_y1"] = obj["bbox"][3]

        if num_pagina < len(doc_pdf) - 1:
            doc_out.add_page_break()

    doc_out.save(docx_path)
    doc_pdf.close()
    return docx_path


# ===========================================================================
# CLI
# ===========================================================================
def main():
    ap = argparse.ArgumentParser(
        description="PDF -> Word (.docx) respetando orden, fuente, tamaño, "
                    "posición, tablas y con OCR para páginas escaneadas.")
    ap.add_argument("entrada", help="Ruta del PDF de entrada")
    ap.add_argument("salida", nargs="?", help="Ruta del .docx (def: mismo nombre .docx)")
    ap.add_argument("--ocr", dest="ocr", action="store_true", default=True,
                    help="Usar OCR en páginas sin texto (activado por defecto)")
    ap.add_argument("--no-ocr", dest="ocr", action="store_false",
                    help="Desactivar el OCR")
    ap.add_argument("--lang", default="spa+eng", help="Idiomas OCR (def: spa+eng)")
    ap.add_argument("--no-tablas", dest="tablas", action="store_false", default=True,
                    help="No detectar tablas")
    ap.add_argument("--imagenes", action="store_true", help="Incrustar imágenes (inline)")
    ap.add_argument("--tessdata", help="Ruta a la carpeta 'tessdata' (TESSDATA_PREFIX)")
    args = ap.parse_args()

    if args.tessdata:
        os.environ["TESSDATA_PREFIX"] = args.tessdata

    salida = args.salida or (args.entrada.rsplit(".", 1)[0] + ".docx")
    print(f"Convirtiendo:\n  {args.entrada}\n  -> {salida}")
    convertir(args.entrada, salida, incrustar_imagenes=args.imagenes,
              usar_ocr=args.ocr, lang=args.lang, detectar_tablas=args.tablas)
    print("Listo ✅")


if __name__ == "__main__":
    main()
