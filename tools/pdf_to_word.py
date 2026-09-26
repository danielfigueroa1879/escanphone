#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
pdf_to_word.py
==============
Convierte un PDF a Word (.docx) RESPETANDO el diseño original:

  1. Orden real de lectura  -> se ordenan los bloques/líneas por sus
     coordenadas espaciales usando el bbox (eje Y de arriba->abajo,
     eje X de izquierda->derecha).
  2. Fuente exacta y estilo -> se lee el nombre de la fuente y los `flags`
     de cada "span" para detectar negrita / cursiva.
  3. Tamaño exacto de letra -> se lee `size` (en puntos) de cada span.
  4. Posición / indentación -> se traslada la coordenada X del bloque a la
     sangría izquierda del párrafo y el hueco vertical al espacio anterior.

--------------------------------------------------------------------------
INSTALACIÓN DE DEPENDENCIAS
--------------------------------------------------------------------------
    python -m pip install --upgrade pip
    python -m pip install pymupdf python-docx

  * pymupdf     -> se importa como `fitz` (motor de lectura del PDF).
  * python-docx -> se importa como `docx` (generación del .docx).

USO
    python pdf_to_word.py entrada.pdf salida.docx
    python pdf_to_word.py entrada.pdf                 # -> entrada.docx
    python pdf_to_word.py entrada.pdf salida.docx --imagenes   # incrusta imágenes
--------------------------------------------------------------------------

ESTRUCTURA DEL DICCIONARIO DE PyMuPDF  (page.get_text("dict"))
--------------------------------------------------------------------------
page.get_text("dict") devuelve:

    {
      "width":  <ancho de la página en puntos>,
      "height": <alto  de la página en puntos>,
      "blocks": [ bloque, bloque, ... ]
    }

Cada BLOQUE:
    {
      "type":  0 = texto | 1 = imagen,
      "bbox":  (x0, y0, x1, y1),   # caja delimitadora del bloque
      "lines": [ linea, linea, ... ]        # solo si type == 0
      # si type == 1 -> tiene "image" (bytes), "width", "height", ...
    }

Cada LÍNEA:
    {
      "bbox":  (x0, y0, x1, y1),
      "dir":   (cos, sen) de la dirección del texto,  # (1,0) = horizontal
      "spans": [ span, span, ... ]
    }

Cada SPAN (fragmento contiguo con el MISMO formato):
    {
      "text":  "texto del fragmento",
      "font":  "ABCDEF+Arial-BoldMT",   # nombre de la fuente (con prefijo de subset)
      "size":  11.04,                    # tamaño en PUNTOS
      "flags": 20,                       # máscara de bits con el estilo (ver abajo)
      "color": 0,                        # color RGB empaquetado en un entero
      "bbox":  (x0, y0, x1, y1),
      "origin":(x, y)                    # punto de origen (línea base) del texto
    }

`flags` es una MÁSCARA DE BITS. Bits relevantes (PyMuPDF):
    bit 0 -> valor  1  : superíndice
    bit 1 -> valor  2  : CURSIVA (italic)
    bit 2 -> valor  4  : con serifa (serifed)
    bit 3 -> valor  8  : monoespaciada
    bit 4 -> valor 16  : NEGRITA (bold)
Se comprueban con AND de bits:  es_negrita = bool(flags & 16)
"""

import sys
import argparse

import fitz  # PyMuPDF

from docx import Document
from docx.shared import Pt, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml.ns import qn


# ---------------------------------------------------------------------------
# Constantes de los bits de `flags` (documentadas arriba).
# ---------------------------------------------------------------------------
FLAG_SUPERSCRIPT = 1
FLAG_ITALIC      = 2
FLAG_SERIF       = 4
FLAG_MONO        = 8
FLAG_BOLD        = 16


# ---------------------------------------------------------------------------
# UTILIDADES DE FORMATO
# ---------------------------------------------------------------------------
def int_a_rgb(color_int):
    """Convierte el color empaquetado (entero sRGB de PyMuPDF) a RGBColor.

    PyMuPDF entrega el color como un entero de 24 bits: 0xRRGGBB.
    """
    if color_int is None:
        return RGBColor(0, 0, 0)
    r = (color_int >> 16) & 0xFF
    g = (color_int >> 8) & 0xFF
    b = color_int & 0xFF
    return RGBColor(r, g, b)


def limpiar_nombre_fuente(font):
    """Devuelve un nombre de fuente utilizable por Word.

    PyMuPDF suele anteponer un prefijo de "subset" de 6 letras seguido de '+'
    (p. ej. 'ABCDEF+Arial-BoldMT'). Ese prefijo NO es parte del nombre real,
    así que se elimina. Se conserva el resto tal cual para respetar la fuente.
    """
    if not font:
        return "Calibri"
    # Quitar el prefijo de subset "ABCDEF+"
    if "+" in font:
        font = font.split("+", 1)[1]
    # Quitar sufijos habituales de estilo del nombre PostScript para que Word
    # reconozca la familia (el estilo se aplica aparte con bold/italic).
    for suf in ("-BoldItalic", "-BoldOblique", "-Italic", "-Oblique",
                "-Bold", "-Regular", "-Roman", "MT", "PSMT", "PS"):
        if font.endswith(suf):
            font = font[: -len(suf)]
    return font.replace("-", " ").strip() or "Calibri"


def estilo_desde_flags(flags):
    """Devuelve (negrita, cursiva) leyendo la máscara de bits `flags`."""
    negrita = bool(flags & FLAG_BOLD)
    cursiva = bool(flags & FLAG_ITALIC)
    return negrita, cursiva


def fijar_fuente_run(run, nombre_fuente):
    """Asigna el nombre de fuente al run (incluye la variante para East Asian,
    necesaria para que Word respete la fuente en todos los alfabetos)."""
    run.font.name = nombre_fuente
    rpr = run._element.get_or_add_rPr()
    rfonts = rpr.find(qn("w:rFonts"))
    if rfonts is None:
        rfonts = rpr.makeelement(qn("w:rFonts"), {})
        rpr.append(rfonts)
    for attr in ("w:ascii", "w:hAnsi", "w:cs", "w:eastAsia"):
        rfonts.set(qn(attr), nombre_fuente)


# ---------------------------------------------------------------------------
# ORDEN DE LECTURA
# ---------------------------------------------------------------------------
def ordenar_por_lectura(elementos, tol_y=3.0):
    """Ordena una lista de elementos que tengan 'bbox' respetando el orden de
    lectura humano:

      - Primero de ARRIBA hacia ABAJO  (coordenada Y0 del bbox).
      - Dentro de la misma "fila" (diferencia de Y menor que `tol_y`),
        de IZQUIERDA a DERECHA (coordenada X0 del bbox).

    Se agrupa por franjas horizontales para que dos bloques que están a la
    misma altura (p. ej. dos columnas o una etiqueta y su valor) queden en el
    orden correcto y no se intercalen por milésimas de diferencia en Y.
    """
    # bbox = (x0, y0, x1, y1). Índices: 0=x0, 1=y0.
    elems = sorted(elementos, key=lambda e: (round(e["bbox"][1] / tol_y), e["bbox"][0]))
    return elems


# ---------------------------------------------------------------------------
# CONVERSIÓN PRINCIPAL
# ---------------------------------------------------------------------------
def convertir(pdf_path, docx_path, incrustar_imagenes=False):
    doc_pdf = fitz.open(pdf_path)
    doc_out = Document()

    # Un solo run de referencia para el estilo "Normal" (evita fuente por defecto rara).
    doc_out.styles["Normal"].font.name = "Calibri"
    doc_out.styles["Normal"].font.size = Pt(11)

    for num_pagina, pagina in enumerate(doc_pdf):
        # --- Ajustar el tamaño de página de salida al del PDF ---------------
        # page.rect da el rectángulo de la página en puntos.
        seccion = doc_out.sections[-1] if num_pagina == 0 else doc_out.add_section()
        seccion.page_width = Pt(pagina.rect.width)
        seccion.page_height = Pt(pagina.rect.height)
        # Márgenes mínimos para que la sangría izquierda (X del PDF) coincida.
        seccion.left_margin = Pt(0)
        seccion.right_margin = Pt(0)
        seccion.top_margin = Pt(0)
        seccion.bottom_margin = Pt(0)

        # --- Extraer el contenido estructurado de la página ----------------
        # get_text("dict") entrega bloques -> líneas -> spans con sus bbox,
        # fuente, tamaño y flags de estilo.
        info = pagina.get_text("dict")
        bloques = info.get("blocks", [])

        # 1) Ordenar los BLOQUES por su posición espacial (orden de lectura).
        bloques = ordenar_por_lectura(bloques)

        prev_y1 = None  # para calcular el hueco vertical entre líneas/bloques

        for bloque in bloques:
            # --- BLOQUE DE IMAGEN (type == 1) ------------------------------
            if bloque.get("type") == 1:
                if incrustar_imagenes and "image" in bloque:
                    _insertar_imagen(doc_out, bloque)
                    prev_y1 = bloque["bbox"][3]
                continue

            # --- BLOQUE DE TEXTO (type == 0) -------------------------------
            # 1b) Ordenar las LÍNEAS del bloque también por lectura.
            lineas = ordenar_por_lectura(bloque.get("lines", []))

            for linea in lineas:
                spans = linea.get("spans", [])
                # Ordenar los spans de la línea de izquierda a derecha (X0).
                spans = sorted(spans, key=lambda s: s["bbox"][0])
                # Ignorar líneas totalmente vacías.
                if not any(s.get("text", "").strip() for s in spans):
                    continue

                # Crear un PÁRRAFO por línea (preserva la posición vertical).
                parrafo = doc_out.add_paragraph()
                pf = parrafo.paragraph_format

                # 4) POSICIÓN / INDENTACIÓN --------------------------------
                # X0 de la línea -> sangría izquierda del párrafo (en puntos).
                x0 = linea["bbox"][0]
                pf.left_indent = Pt(max(0.0, x0))

                # Hueco vertical respecto al elemento anterior -> espacio antes.
                y0 = linea["bbox"][1]
                if prev_y1 is not None:
                    gap = y0 - prev_y1
                    # Solo aplicar huecos positivos y "razonables" para no
                    # acumular saltos enormes (se limita a 60 pt).
                    pf.space_before = Pt(min(max(gap, 0.0), 60.0))
                else:
                    pf.space_before = Pt(0)
                pf.space_after = Pt(0)
                # Interlineado exacto según el alto de la línea.
                alto_linea = linea["bbox"][3] - linea["bbox"][1]
                if alto_linea > 0:
                    pf.line_spacing = Pt(alto_linea)

                # 2) y 3) Recorrer los SPANS y crear un RUN por cada uno,
                #         copiando fuente, tamaño, negrita/cursiva y color.
                for span in spans:
                    texto = span.get("text", "")
                    if texto == "":
                        continue
                    run = parrafo.add_run(texto)

                    # -- 2. Nombre de fuente y estilo (negrita/cursiva) -----
                    nombre = limpiar_nombre_fuente(span.get("font", ""))
                    fijar_fuente_run(run, nombre)
                    negrita, cursiva = estilo_desde_flags(span.get("flags", 0))
                    run.font.bold = negrita
                    run.font.italic = cursiva

                    # -- 3. Tamaño exacto en puntos -------------------------
                    tam = span.get("size")
                    if tam and tam > 0:
                        run.font.size = Pt(tam)

                    # -- Color del texto ------------------------------------
                    run.font.color.rgb = int_a_rgb(span.get("color", 0))

                prev_y1 = linea["bbox"][3]

        # Salto de página entre páginas del PDF (excepto tras la última).
        if num_pagina < len(doc_pdf) - 1:
            doc_out.add_page_break()

    doc_out.save(docx_path)
    doc_pdf.close()
    return docx_path


def _insertar_imagen(doc_out, bloque):
    """Inserta la imagen de un bloque (type==1) de forma INLINE.

    Nota: python-docx no permite posicionamiento absoluto flotante sencillo,
    así que la imagen se coloca en el flujo, no en su coordenada exacta.
    """
    import io
    try:
        img_bytes = bloque["image"]
        ancho_pt = bloque["bbox"][2] - bloque["bbox"][0]
        p = doc_out.add_paragraph()
        run = p.add_run()
        run.add_picture(io.BytesIO(img_bytes), width=Pt(min(ancho_pt, 468)))
    except Exception as e:  # imagen en formato no soportado, etc.
        print(f"  [aviso] no se pudo incrustar una imagen: {e}", file=sys.stderr)


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------
def main():
    ap = argparse.ArgumentParser(
        description="Convierte PDF a Word (.docx) respetando orden, fuente, "
                    "tamaño y posición aproximada.")
    ap.add_argument("entrada", help="Ruta del PDF de entrada")
    ap.add_argument("salida", nargs="?", help="Ruta del .docx de salida "
                    "(por defecto: mismo nombre con .docx)")
    ap.add_argument("--imagenes", action="store_true",
                    help="Incrustar también las imágenes (inline)")
    args = ap.parse_args()

    salida = args.salida or (args.entrada.rsplit(".", 1)[0] + ".docx")
    print(f"Convirtiendo:\n  {args.entrada}\n  -> {salida}")
    convertir(args.entrada, salida, incrustar_imagenes=args.imagenes)
    print("Listo ✅")


if __name__ == "__main__":
    main()
