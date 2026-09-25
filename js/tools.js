(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const show = id => { const e = $(id); if (e) e.style.display = ''; };
  const hide = id => { const e = $(id); if (e) e.style.display = 'none'; };
  const toast = m => { if (typeof window.showToast === 'function') window.showToast(m); };
  const baseName = n => (n || 'archivo').replace(/\.[^.]+$/, '') || 'archivo';

  // ---------- CDNs (se cargan solo al usar cada herramienta) ----------
  const CDN = {
    pdfjs:  'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js',
    pdfjsW: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js',
    tess:   'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js',
    pdflib: 'https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js',
    imgly:  'https://cdn.jsdelivr.net/npm/@imgly/background-removal@1.5.5/+esm',
    tfjs:   'https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.11.0/dist/tf.min.js',
    // Modelos ESRGAN nativos por escala (x2/x3/x4): una sola pasada por
    // factor. "medium" = calidad media/rápida; "thick" = máxima calidad.
    upBases: {
      medium: { url: 'https://cdn.jsdelivr.net/npm/@upscalerjs/esrgan-medium@1.0.0/dist/umd/models/esrgan-medium/src/', g: 'ESRGANMedium' },
      thick:  { url: 'https://cdn.jsdelivr.net/npm/@upscalerjs/esrgan-thick@1.0.0/dist/umd/models/esrgan-thick/src/',  g: 'ESRGANThick' }
    },
    upscaler:'https://cdn.jsdelivr.net/npm/upscaler@1.0.0/dist/browser/umd/upscaler.min.js'
  };
  const _scripts = {};
  function cargarScript(src) {
    if (_scripts[src]) return _scripts[src];
    _scripts[src] = new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = src; s.async = true;
      s.onload = () => res();
      s.onerror = () => rej(new Error('No se pudo cargar un componente. Revisa tu conexión.'));
      document.head.appendChild(s);
    });
    return _scripts[src];
  }

  // ------------------------- Router de vistas -------------------------
  function mostrarVista(id) {
    document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.id === id));
    window.scrollTo(0, 0);
  }
  function abrirHerramienta(id) {
    mostrarVista(id);
    try { history.pushState({ view: id }, ''); } catch (_) {}
  }
  function volverInicio() {
    mostrarVista('homeLauncher');
    try { history.pushState({ view: 'homeLauncher' }, ''); } catch (_) {}
  }
  window.abrirHerramienta = abrirHerramienta;
  window.volverInicio = volverInicio;
  window.addEventListener('popstate', e => {
    mostrarVista((e.state && e.state.view) || 'homeLauncher');
  });

  // --------------------- Catálogo de herramientas ---------------------
  // Para agregar una herramienta nueva: añade una entrada aquí y crea
  // su panel <div class="container view" id="...">.
  const HERRAMIENTAS = [
    { id: 'appEscaner', emoji: '📄', title: 'Escáner de Documentos',
      desc: 'Combina frente y reverso o centra un documento para imprimir.' },
    { id: 'appOCR', emoji: '🔎', title: 'OCR de PDF', badge: 'Nuevo',
      desc: 'Convierte un PDF escaneado en texto seleccionable y buscable.' },
    { id: 'appImagen', emoji: '🗜️', title: 'Convertir / Comprimir a WebP', badge: 'Nuevo',
      desc: 'Pasa JPG o PNG a WebP y comprime según el porcentaje.' },
    { id: 'appFondo', emoji: '🪄', title: 'Quitar fondo', badge: 'Nuevo',
      desc: 'Elimina el fondo de una foto y déjala transparente.' },
    { id: 'appColor', emoji: '🎨', title: 'Cambiar fondo de color', badge: 'Nuevo',
      desc: 'Pon fondo blanco, azul, verde o rojo detrás de la foto.' },
    { id: 'appAmpliar', emoji: '🔍', title: 'Ampliar foto', badge: 'IA',
      desc: 'Agranda la foto 2×, 3× o 4× con IA (súper resolución).' },
    { soon: true, emoji: '➕', title: 'Más herramientas', desc: 'Se irán agregando pronto.' }
  ];
  function renderLauncher() {
    const grid = $('launcherGrid');
    if (!grid) return;
    grid.innerHTML = '';
    HERRAMIENTAS.forEach(t => {
      const card = document.createElement(t.soon ? 'div' : 'button');
      card.className = 'tool-card' + (t.soon ? ' soon' : '');
      if (!t.soon) { card.type = 'button'; card.addEventListener('click', () => abrirHerramienta(t.id)); }
      card.innerHTML =
        '<div class="tc-emoji">' + t.emoji + '</div>' +
        '<div class="tc-txt"><h3>' + t.title + '</h3><p>' + t.desc + '</p></div>' +
        (t.badge ? '<span class="tc-badge">' + t.badge + '</span>' : '') +
        (t.soon ? '' : '<span class="tc-go">›</span>');
      grid.appendChild(card);
    });
  }

  // ------------------------- Utilidades UI ---------------------------
  function setBar(barId, pctId, statusId, pct, status) {
    const p = Math.max(0, Math.min(100, pct));
    if ($(barId)) $(barId).style.width = p + '%';
    if ($(pctId)) $(pctId).textContent = Math.round(p) + '%';
    if (statusId && status != null && $(statusId)) $(statusId).textContent = status;
  }
  function segActivate(segId, btn) {
    const seg = $(segId); if (!seg) return;
    seg.querySelectorAll('button').forEach(b => b.classList.toggle('active', b === btn));
  }
  function imageFileToCanvas(file) {
    return new Promise((res, rej) => {
      const img = new Image(); const u = URL.createObjectURL(file);
      img.onload = () => {
        const c = document.createElement('canvas');
        c.width = img.naturalWidth; c.height = img.naturalHeight;
        c.getContext('2d').drawImage(img, 0, 0);
        URL.revokeObjectURL(u); res(c);
      };
      img.onerror = () => { URL.revokeObjectURL(u); rej(new Error('No se pudo leer la imagen.')); };
      img.src = u;
    });
  }

  // ==================================================================
  // ==========================  OCR DE PDF  ==========================
  // ==================================================================
  let ocrLang = 'spa+eng', ocrOut = 'pdf', ocrFile = null, ocrText = '', ocrBusy = false, ocrUrl = null;

  window.ocrSetLang = (btn, l) => { ocrLang = l; segActivate('ocrLangSeg', btn); };
  window.ocrSetOut = (btn, o) => { ocrOut = o; segActivate('ocrOutSeg', btn); };

  function ocrPick(file) {
    if (!file) return;
    ocrFile = file;
    const fn = $('ocrFileName'); fn.textContent = '📎 ' + file.name; fn.style.display = 'inline-block';
    $('ocrRun').disabled = false;
    hide('ocrProgressCard'); hide('ocrResultCard');
  }
  window.ocrReset = () => {
    ocrFile = null; ocrText = '';
    $('ocrInput').value = ''; $('ocrFileName').style.display = 'none';
    $('ocrRun').disabled = true; hide('ocrProgressCard'); hide('ocrResultCard');
  };
  window.ocrCopiar = () => {
    if (!ocrText) { toast('No hay texto para copiar'); return; }
    (navigator.clipboard ? navigator.clipboard.writeText(ocrText) : Promise.reject())
      .then(() => toast('📋 Texto copiado')).catch(() => toast('No se pudo copiar'));
  };

  async function renderPdfPage(pdf, num) {
    const page = await pdf.getPage(num);
    const base = page.getViewport({ scale: 1 });
    const scale = Math.min(3, Math.max(1, 2200 / Math.max(base.width, base.height)));
    const vp = page.getViewport({ scale });
    const c = document.createElement('canvas');
    c.width = Math.ceil(vp.width); c.height = Math.ceil(vp.height);
    await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
    return c;
  }

  // Extrae las palabras reconocidas con sus coordenadas (bbox en píxeles).
  function extractWords(data) {
    const words = [];
    (data.blocks || []).forEach(b => (b.paragraphs || []).forEach(p =>
      (p.lines || []).forEach(l => (l.words || []).forEach(w => {
        if (w.text && w.bbox) words.push({ text: w.text, bbox: w.bbox });
      }))));
    if (!words.length && Array.isArray(data.words)) {
      data.words.forEach(w => { if (w.text && w.bbox) words.push({ text: w.text, bbox: w.bbox }); });
    }
    if (!words.length && data.hocr) {
      try {
        const doc = new DOMParser().parseFromString(data.hocr, 'text/html');
        doc.querySelectorAll('.ocrx_word').forEach(el => {
          const m = (el.getAttribute('title') || '').match(/bbox (\d+) (\d+) (\d+) (\d+)/);
          const t = el.textContent || '';
          if (m && t.trim()) words.push({ text: t, bbox: { x0: +m[1], y0: +m[2], x1: +m[3], y1: +m[4] } });
        });
      } catch (_) {}
    }
    return words;
  }

  // Deja solo caracteres representables por la fuente estándar (WinAnsi).
  function sanitizeWinAnsi(s) {
    if (!s) return '';
    s = s.replace(/[‘’′]/g, "'").replace(/[“”″]/g, '"')
         .replace(/[–—]/g, '-').replace(/…/g, '...').replace(/ /g, ' ');
    let out = '';
    for (const ch of s) {
      const c = ch.codePointAt(0);
      if (c === 9 || (c >= 32 && c <= 126) || (c >= 160 && c <= 255)) out += ch;
    }
    return out.trim();
  }

  function dataURLtoBytes(dataURL) {
    const bin = atob(dataURL.split(',')[1]);
    const u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    return u;
  }

  // Dibuja una capa de texto INVISIBLE sobre la página, alineada a la imagen
  // → el PDF conserva su aspecto original pero queda seleccionable/buscable.
  function dibujarCapaTexto(page, words, cw, ch, font) {
    const size0 = page.getSize();
    const sx = size0.width / cw, sy = size0.height / ch;
    for (const w of words) {
      const t = sanitizeWinAnsi(w.text);
      if (!t) continue;
      const b = w.bbox;
      const wordH = (b.y1 - b.y0) * sy;
      if (!(wordH > 0)) continue;
      const size = Math.max(1, Math.min(wordH * 0.9, 400));
      const x = b.x0 * sx;
      const y = size0.height - b.y1 * sy + wordH * 0.12; // línea base
      try { page.drawText(t, { x, y, size, font, opacity: 0 }); } catch (_) {}
    }
  }

  window.ocrProcesar = async function () {
    if (ocrBusy || !ocrFile) return;
    ocrBusy = true; $('ocrRun').disabled = true;
    show('ocrProgressCard'); hide('ocrResultCard');
    setBar('ocrBar', 'ocrPct', 'ocrStatus', 3, 'Cargando componentes…');
    let worker = null;
    try {
      await cargarScript(CDN.tess);
      const esPdf = ocrFile.type === 'application/pdf' || /\.pdf$/i.test(ocrFile.name);

      // 1) Fuente de páginas
      let pdfjsDoc = null, originalBytes = null, total = 1;
      if (esPdf) {
        await cargarScript(CDN.pdfjs);
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = CDN.pdfjsW;
        setBar('ocrBar', 'ocrPct', 'ocrStatus', 6, 'Leyendo el PDF…');
        originalBytes = new Uint8Array(await ocrFile.arrayBuffer());
        pdfjsDoc = await window.pdfjsLib.getDocument({ data: originalBytes.slice() }).promise;
        total = pdfjsDoc.numPages;
      }

      // 2) Documento de salida (PDF): partimos del PDF ORIGINAL y solo le
      //    agregamos la capa de texto. Así se descarga el mismo archivo,
      //    idéntico, pero con el OCR ya aplicado.
      let outDoc = null, usarOriginal = false, font = null;
      if (ocrOut === 'pdf') {
        await cargarScript(CDN.pdflib);
        if (esPdf) {
          try {
            outDoc = await window.PDFLib.PDFDocument.load(originalBytes, { ignoreEncryption: true });
            usarOriginal = outDoc.getPageCount() === total;
            if (!usarOriginal) outDoc = null;
          } catch (_) { outDoc = null; }
        }
        if (!outDoc) outDoc = await window.PDFLib.PDFDocument.create();
        font = await outDoc.embedFont(window.PDFLib.StandardFonts.Helvetica);
      }

      // 3) OCR página por página
      const st = { done: 0 };
      worker = await window.Tesseract.createWorker(ocrLang, 1, {
        logger: m => {
          if (m.status === 'recognizing text' && typeof m.progress === 'number') {
            const frac = (st.done + m.progress) / total;
            setBar('ocrBar', 'ocrPct', 'ocrStatus', 8 + frac * 86,
              'Reconociendo texto… (' + Math.min(st.done + 1, total) + '/' + total + ')');
          }
        }
      });

      let textAll = '';
      for (let i = 0; i < total; i++) {
        const canvas = esPdf ? await renderPdfPage(pdfjsDoc, i + 1) : await imageFileToCanvas(ocrFile);
        const { data } = await worker.recognize(canvas, {}, { text: true, blocks: true, hocr: true });
        textAll += (data.text || '') + '\n\n';

        if (ocrOut === 'pdf') {
          const words = extractWords(data);
          let page;
          if (usarOriginal) {
            page = outDoc.getPage(i);
          } else {
            const jpg = dataURLtoBytes(canvas.toDataURL('image/jpeg', 0.82));
            const img = await outDoc.embedJpg(jpg);
            page = outDoc.addPage([img.width, img.height]);
            page.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });
          }
          dibujarCapaTexto(page, words, canvas.width, canvas.height, font);
        }
        canvas.width = canvas.height = 0; // liberar memoria
        st.done++;
      }
      await worker.terminate(); worker = null;
      ocrText = textAll.trim();

      // 4) Generar archivo descargable
      setBar('ocrBar', 'ocrPct', 'ocrStatus', 96, 'Generando archivo…');
      if (ocrUrl) { URL.revokeObjectURL(ocrUrl); ocrUrl = null; }
      let blob, filename;
      if (ocrOut === 'pdf') {
        blob = new Blob([await outDoc.save()], { type: 'application/pdf' });
        filename = baseName(ocrFile.name) + '_ocr.pdf';
      } else {
        blob = new Blob([ocrText || ''], { type: 'text/plain;charset=utf-8' });
        filename = baseName(ocrFile.name) + '_ocr.txt';
      }
      ocrUrl = URL.createObjectURL(blob);
      const dl = $('ocrDownload'); dl.href = ocrUrl; dl.download = filename;
      $('ocrTextPreview').textContent = ocrText || '(No se detectó texto en el documento.)';
      setBar('ocrBar', 'ocrPct', 'ocrStatus', 100, '¡Listo! Descarga tu archivo.');
      show('ocrResultCard');
    } catch (e) {
      console.error(e);
      setBar('ocrBar', 'ocrPct', 'ocrStatus', 0, 'Error: ' + (e.message || e));
      toast('❌ ' + (e.message || 'Falló el OCR'));
      $('ocrRun').disabled = false;
    } finally {
      if (worker) { try { await worker.terminate(); } catch (_) {} }
      ocrBusy = false;
    }
  };

  // Tamaño legible (KB / MB)
  function kb(bytes) {
    return bytes >= 1048576 ? (bytes / 1048576).toFixed(2) + ' MB' : Math.max(1, Math.round(bytes / 1024)) + ' KB';
  }

  // Convierte/recomprime un blob de imagen al formato pedido.
  // quality: 0–1 (si es null se lee el control deslizante de compresión).
  function convertir(srcBlob, fmt, quality) {
    return new Promise((res, rej) => {
      const img = new Image(); const u = URL.createObjectURL(srcBlob);
      img.onload = () => {
        const c = document.createElement('canvas');
        c.width = img.naturalWidth; c.height = img.naturalHeight;
        const ctx = c.getContext('2d');
        const mime = fmt === 'png' ? 'image/png' : fmt === 'jpeg' ? 'image/jpeg' : 'image/webp';
        if (mime === 'image/jpeg') { ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, c.width, c.height); }
        ctx.drawImage(img, 0, 0);
        URL.revokeObjectURL(u);
        const q = quality != null ? quality : (+$('imgQuality').value) / 100;
        const done = (b, usedFmt) => b ? res({ blob: b, fmt: usedFmt }) : rej(new Error('No se pudo convertir la imagen.'));
        c.toBlob(b => {
          if (!b && mime === 'image/webp') { // Safari antiguo sin WebP → PNG
            toast('Tu navegador no exporta WebP; se usó PNG.');
            c.toBlob(b2 => done(b2, 'png'), 'image/png');
          } else done(b, fmt);
        }, mime, q);
      };
      img.onerror = () => { URL.revokeObjectURL(u); rej(new Error('No se pudo leer la imagen.')); };
      img.src = u;
    });
  }

  // ==================================================================
  // ==============  CONVERTIR / COMPRIMIR A WEBP  ====================
  // ==================================================================
  let imgFmt = 'webp', imgFile = null, imgBusy = false, imgUrl = null, imgSrcUrl = null;

  window.imgSetFmt = (btn, f) => {
    imgFmt = f; segActivate('imgFmtSeg', btn);
    $('imgQualityRow').style.display = (f === 'png') ? 'none' : 'flex';
    const dl = $('imgDownload'); if (dl && imgFile) dl.download = baseName(imgFile.name) + '.' + (f === 'jpeg' ? 'jpg' : f);
  };

  function imgPick(file) {
    if (!file) return;
    if (!/^image\//.test(file.type) && !/\.(png|jpe?g|webp|gif|bmp)$/i.test(file.name)) {
      toast('Elige una imagen (PNG, JPG o WebP)'); return;
    }
    imgFile = file;
    $('imgThumbName').textContent = file.name;
    $('imgSizeOrig').textContent = kb(file.size);
    if (imgSrcUrl) URL.revokeObjectURL(imgSrcUrl);
    imgSrcUrl = URL.createObjectURL(file);
    $('imgResultPreview').src = imgSrcUrl;          // miniatura de la original
    hide('imgDrop'); $('imgThumbRow').style.display = 'flex';
    hide('imgThumbNew'); hide('imgDownload');        // aún sin procesar
    $('imgRun').disabled = false; hide('imgProgressCard');
  }
  window.imgReset = () => {
    imgFile = null; $('imgInput').value = '';
    show('imgDrop'); $('imgThumbRow').style.display = 'none';
    $('imgRun').disabled = true; hide('imgProgressCard');
  };

  window.imgProcesar = async function () {
    if (imgBusy || !imgFile) return;
    imgBusy = true; $('imgRun').disabled = true;
    show('imgProgressCard'); hide('imgThumbNew'); hide('imgDownload');
    setBar('imgBar', 'imgPct', 'imgStatus', 25, 'Procesando imagen…');
    try {
      const { blob, fmt } = await convertir(imgFile, imgFmt);
      setBar('imgBar', 'imgPct', 'imgStatus', 90, 'Generando archivo…');
      if (imgUrl) URL.revokeObjectURL(imgUrl);
      imgUrl = URL.createObjectURL(blob);
      $('imgResultPreview').src = imgUrl;            // miniatura del resultado
      const ext = fmt === 'jpeg' ? 'jpg' : fmt;
      const dl = $('imgDownload'); dl.href = imgUrl; dl.download = baseName(imgFile.name) + '.' + ext;
      const saved = Math.round((1 - blob.size / imgFile.size) * 100);
      $('imgSizeNew').textContent = kb(blob.size);
      $('imgSizeSaved').textContent = saved > 0 ? '↓' + saved + '%' : (saved < 0 ? '↑' + Math.abs(saved) + '%' : '');
      $('imgThumbNew').style.display = ''; dl.style.display = '';
      setBar('imgBar', 'imgPct', 'imgStatus', 100, '¡Listo! Descarga tu imagen.');
    } catch (e) {
      console.error(e);
      setBar('imgBar', 'imgPct', 'imgStatus', 0, 'Error: ' + (e.message || e));
      toast('❌ ' + (e.message || 'Falló el proceso'));
      $('imgRun').disabled = false;
    } finally {
      imgBusy = false;
    }
  };

  // ==================================================================
  // =========================  QUITAR FONDO  ========================
  // ==================================================================
  let fondoFmt = 'png', fondoFile = null, fondoBusy = false, fondoUrl = null, fondoSrcUrl = null;

  window.fondoSetFmt = (btn, f) => {
    fondoFmt = f; segActivate('fondoFmtSeg', btn);
    const dl = $('fondoDownload'); if (dl && fondoFile) dl.download = baseName(fondoFile.name) + '-sin-fondo.' + f;
  };

  function fondoPick(file) {
    if (!file) return;
    if (!/^image\//.test(file.type) && !/\.(png|jpe?g|webp|gif|bmp)$/i.test(file.name)) {
      toast('Elige una imagen (PNG, JPG o WebP)'); return;
    }
    fondoFile = file;
    const fn = $('fondoFileName'); fn.textContent = '📎 ' + file.name; fn.style.display = 'inline-block';
    if (fondoSrcUrl) URL.revokeObjectURL(fondoSrcUrl);
    fondoSrcUrl = URL.createObjectURL(file);
    $('fondoPreview').src = fondoSrcUrl; $('fondoPreviewWrap').style.display = 'flex';
    $('fondoRun').disabled = false;
    hide('fondoProgressCard'); hide('fondoResultCard');
  }
  window.fondoReset = () => {
    fondoFile = null; $('fondoInput').value = '';
    $('fondoFileName').style.display = 'none'; $('fondoPreviewWrap').style.display = 'none';
    $('fondoRun').disabled = true; hide('fondoProgressCard'); hide('fondoResultCard');
  };

  window.fondoProcesar = async function () {
    if (fondoBusy || !fondoFile) return;
    fondoBusy = true; $('fondoRun').disabled = true;
    show('fondoProgressCard'); hide('fondoResultCard'); $('fondoHint').textContent = '';
    try {
      setBar('fondoBar', 'fondoPct', 'fondoStatus', 4, 'Cargando modelo de IA…');
      $('fondoHint').textContent = 'La primera vez se descarga el modelo de alta calidad (~90 MB). Puede tardar según tu conexión.';
      const mod = await import(CDN.imgly);
      const removeBackground = mod.removeBackground || mod.default;
      if (typeof removeBackground !== 'function') throw new Error('No se pudo iniciar el removedor de fondo.');
      const pngBlob = await quitarFondoIA(removeBackground, fondoFile, (key, cur, tot) => {
        const pct = tot ? 6 + (cur / tot) * 80 : 45;
        setBar('fondoBar', 'fondoPct', 'fondoStatus', pct,
          /fetch/i.test(key || '') ? 'Descargando modelo…' : 'Quitando el fondo…');
      });
      $('fondoHint').textContent = '';
      setBar('fondoBar', 'fondoPct', 'fondoStatus', 90, 'Generando archivo…');
      let outBlob = pngBlob, ext = 'png';
      if (fondoFmt === 'webp') { const r = await convertir(pngBlob, 'webp', 0.92); outBlob = r.blob; ext = r.fmt === 'jpeg' ? 'jpg' : r.fmt; }
      if (fondoUrl) URL.revokeObjectURL(fondoUrl);
      fondoUrl = URL.createObjectURL(outBlob);
      $('fondoResultPreview').src = fondoUrl;
      const dl = $('fondoDownload'); dl.href = fondoUrl; dl.download = baseName(fondoFile.name) + '-sin-fondo.' + ext;
      $('fondoSizeInfo').textContent = ext.toUpperCase() + ' · ' + kb(outBlob.size);
      setBar('fondoBar', 'fondoPct', 'fondoStatus', 100, '¡Listo! Descarga tu imagen.');
      show('fondoResultCard');
    } catch (e) {
      console.error(e);
      setBar('fondoBar', 'fondoPct', 'fondoStatus', 0, 'Error: ' + (e.message || e));
      toast('❌ ' + (e.message || 'Falló el proceso'));
      $('fondoRun').disabled = false;
    } finally {
      fondoBusy = false;
    }
  };

  // ==================================================================
  // ===================  CAMBIAR FONDO DE COLOR  ====================
  // ==================================================================
  let colorFile = null, colorImgEl = null, colorMime = 'image/png', colorSel = '#ffffff',
      colorUrl = null, colorToken = 0;

  function toBlobAsync(canvas, mime, q) {
    return new Promise(res => canvas.toBlob(b => res(b), mime, q));
  }

  // Codifica intentando conservar el MISMO peso que el archivo original
  // (misma resolución y formato). PNG queda sin pérdida.
  async function encodeMismoPeso(canvas, mime, targetBytes) {
    if (mime === 'image/png') {
      return { blob: await toBlobAsync(canvas, 'image/png'), mime: 'image/png' };
    }
    let lo = 0.3, hi = 0.97, best = null;
    for (let i = 0; i < 7; i++) {
      const q = (lo + hi) / 2;
      const b = await toBlobAsync(canvas, mime, q);
      if (!b) { return { blob: await toBlobAsync(canvas, 'image/png'), mime: 'image/png' }; }
      if (b.size > targetBytes) { hi = q; } else { best = b; lo = q; }
    }
    if (!best) best = await toBlobAsync(canvas, mime, 0.85);
    return { blob: best, mime };
  }

  function blobToImage(blob) {
    return new Promise((res, rej) => {
      const u = URL.createObjectURL(blob); const i = new Image();
      i.onload = () => { URL.revokeObjectURL(u); res(i); };
      i.onerror = () => { URL.revokeObjectURL(u); rej(new Error('No se pudo leer el recorte.')); };
      i.src = u;
    });
  }

  // Afina/suaviza el contorno del recorte (feather): desenfoca ligeramente
  // el canal alfa y realza el borde para que quede limpio y sin fleco.
  function refinarBordes(img) {
    const w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
    const src = document.createElement('canvas'); src.width = w; src.height = h;
    const sctx = src.getContext('2d'); sctx.drawImage(img, 0, 0);
    const id = sctx.getImageData(0, 0, w, h); const data = id.data;
    // Canvas con el alfa en gris para poder desenfocarlo
    const am = document.createElement('canvas'); am.width = w; am.height = h;
    const actx = am.getContext('2d');
    const aimg = actx.createImageData(w, h); const ad = aimg.data;
    for (let i = 0; i < data.length; i += 4) { const a = data[i + 3]; ad[i] = ad[i + 1] = ad[i + 2] = a; ad[i + 3] = 255; }
    actx.putImageData(aimg, 0, 0);
    // Desenfoque suave del alfa (radio adaptativo a la resolución)
    const r = Math.max(1.0, Math.min(2.4, Math.max(w, h) / 750));
    const bc = document.createElement('canvas'); bc.width = w; bc.height = h;
    const bctx = bc.getContext('2d');
    if ('filter' in bctx) bctx.filter = 'blur(' + r + 'px)';
    bctx.drawImage(am, 0, 0);
    const bd = bctx.getImageData(0, 0, w, h).data;
    // Rampa de umbral: interior sólido (→255), exterior limpio (→0) y un
    // borde suave de 1–2 px. lo=55 recorta el fleco/halo del fondo.
    const lo = 55, hi = 205, span = hi - lo;
    for (let i = 0; i < data.length; i += 4) {
      let a = (bd[i] - lo) / span * 255;
      data[i + 3] = a < 0 ? 0 : a > 255 ? 255 : a;
    }
    sctx.putImageData(id, 0, 0);
    return src;
  }

  // Quita el fondo con IA (modelo de alta calidad, WebGPU si está disponible)
  // y devuelve un PNG con el contorno ya afinado.
  async function quitarFondoIA(removeBackground, file, progress) {
    const base = { model: 'isnet', output: { format: 'image/png', quality: 1 }, progress };
    const useGpu = !!(navigator.gpu);
    let pngBlob;
    try {
      pngBlob = await removeBackground(file, useGpu ? Object.assign({ device: 'gpu' }, base) : base);
    } catch (e) {
      if (useGpu) { pngBlob = await removeBackground(file, base); } // respaldo a CPU
      else throw e;
    }
    try {
      const img = await blobToImage(pngBlob);
      const canvas = refinarBordes(img);
      const refined = await toBlobAsync(canvas, 'image/png');
      if (refined) return refined;
    } catch (_) { /* si el afinado falla, usa el recorte original */ }
    return pngBlob;
  }

  window.colorSet = (btn, hex) => {
    colorSel = hex;
    $('colorChips').querySelectorAll('.color-chip').forEach(b => b.classList.toggle('active', b === btn));
    colorRedraw();
  };

  // ¿La imagen tiene zonas transparentes? (para saber si el color se verá)
  function tieneTransparencia(img) {
    const s = 80;
    const r = Math.min(1, s / Math.max(img.naturalWidth, img.naturalHeight, 1));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(img.naturalWidth * r));
    c.height = Math.max(1, Math.round(img.naturalHeight * r));
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0, c.width, c.height);
    try {
      const d = ctx.getImageData(0, 0, c.width, c.height).data;
      for (let i = 3; i < d.length; i += 4) if (d[i] < 250) return true;
    } catch (_) { return true; }
    return false;
  }

  // Quita el fondo con IA para poder aplicar el color (fotos opacas).
  window.colorQuitarFondo = async function () {
    if (!colorFile) return;
    const btn = $('colorQuitarBtn'); btn.disabled = true; $('colorProgWrap').style.display = '';
    try {
      setBar('colorBar', 'colorPct', 'colorStatus', 4, 'Cargando modelo de IA…');
      const mod = await import(CDN.imgly);
      const removeBackground = mod.removeBackground || mod.default;
      if (typeof removeBackground !== 'function') throw new Error('No se pudo iniciar el removedor de fondo.');
      const pngBlob = await quitarFondoIA(removeBackground, colorFile, (key, cur, tot) => {
        const pct = tot ? 6 + (cur / tot) * 82 : 45;
        setBar('colorBar', 'colorPct', 'colorStatus', pct,
          /fetch/i.test(key || '') ? 'Descargando modelo…' : 'Quitando el fondo…');
      });
      setBar('colorBar', 'colorPct', 'colorStatus', 100, '¡Listo!');
      const u = URL.createObjectURL(pngBlob);
      const im = new Image();
      im.onload = () => {
        URL.revokeObjectURL(u);
        colorImgEl = im;                 // ahora el sujeto está recortado (con transparencia)
        hide('colorBgBox');
        colorRedraw();                   // aplica el color elegido detrás
      };
      im.onerror = () => { URL.revokeObjectURL(u); toast('No se pudo procesar la imagen.'); btn.disabled = false; };
      im.src = u;
    } catch (e) {
      console.error(e);
      setBar('colorBar', 'colorPct', 'colorStatus', 0, 'Error: ' + (e.message || e));
      toast('❌ ' + (e.message || 'Falló el proceso'));
      btn.disabled = false;
    }
  };

  function colorPick(file) {
    if (!file) return;
    if (!/^image\//.test(file.type) && !/\.(png|jpe?g|webp|gif|bmp)$/i.test(file.name)) {
      toast('Elige una imagen (PNG, JPG o WebP)'); return;
    }
    colorFile = file;
    let t = file.type;
    if (!/^image\/(png|jpeg|webp)$/.test(t)) {
      t = /\.jpe?g$/i.test(file.name) ? 'image/jpeg' : /\.webp$/i.test(file.name) ? 'image/webp' : 'image/png';
    }
    colorMime = t;
    $('colorName').textContent = file.name;
    $('colorOrigSize').textContent = kb(file.size);
    hide('colorDownload'); $('colorNewSize').textContent = '…';
    const u = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(u);
      colorImgEl = img;
      hide('colorDrop'); $('colorThumbRow').style.display = 'flex';
      // Si la foto es opaca (sin transparencia), el color no se verá:
      // ofrecemos quitar el fondo automáticamente.
      const btn = $('colorQuitarBtn'); btn.disabled = false; $('colorProgWrap').style.display = 'none';
      $('colorBgBox').style.display = tieneTransparencia(img) ? 'none' : '';
      colorRedraw();
    };
    img.onerror = () => { URL.revokeObjectURL(u); toast('No se pudo leer la imagen.'); };
    img.src = u;
  }

  window.colorReset = () => {
    colorFile = null; colorImgEl = null; $('colorInput').value = '';
    show('colorDrop'); $('colorThumbRow').style.display = 'none';
    hide('colorBgBox');
  };

  async function colorRedraw() {
    if (!colorImgEl) return;
    const c = $('colorCanvas');
    c.width = colorImgEl.naturalWidth; c.height = colorImgEl.naturalHeight;
    const ctx = c.getContext('2d');
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.fillStyle = colorSel; ctx.fillRect(0, 0, c.width, c.height); // fondo elegido
    ctx.drawImage(colorImgEl, 0, 0);                                  // foto encima
    const my = ++colorToken;
    const dl = $('colorDownload'); dl.style.display = 'none';
    $('colorNewSize').textContent = 'optimizando…';
    const { blob, mime } = await encodeMismoPeso(c, colorMime, colorFile.size);
    if (my !== colorToken) return; // otro color seleccionado mientras tanto
    const ext = mime === 'image/jpeg' ? 'jpg' : mime === 'image/webp' ? 'webp' : 'png';
    if (colorUrl) URL.revokeObjectURL(colorUrl);
    colorUrl = URL.createObjectURL(blob);
    dl.href = colorUrl; dl.download = baseName(colorFile.name) + '-fondo.' + ext;
    $('colorNewSize').textContent = kb(blob.size);
    dl.style.display = '';
  }

  // ==================================================================
  // =========================  AMPLIAR FOTO  ========================
  // ==================================================================
  let ampFile = null, ampImgEl = null, ampFactor = 2, ampMime = 'image/png',
      ampBusy = false, ampUrl = null, ampSrcUrl = null, ampCalidad = 'medium';

  window.ampSetCalidad = (btn, q) => {
    ampCalidad = q; segActivate('ampCalidadSeg', btn);
    if (ampImgEl) ampActualizarAviso();
  };
  const AMP_MAX = 8000;   // límite de seguridad para el lado mayor de SALIDA (px)
  const AMP_MAX_IN = 1000; // tope del lado mayor de ENTRADA para la IA (px)

  window.ampSetFactor = (btn, f) => {
    ampFactor = f; segActivate('ampFactorSeg', btn);
    if (ampImgEl) { ampActualizarNuevo(); ampActualizarAviso(); }
  };

  // Muestra el aviso cuando la IA puede tardar (foto grande, factor alto o
  // calidad alta) y muestra/oculta el selector de calidad según la IA.
  function ampActualizarAviso() {
    const ia = $('ampIAToggle') && $('ampIAToggle').checked;
    const fila = $('ampCalidadRow'); if (fila) fila.style.display = ia ? '' : 'none';
    const el = $('ampAviso'); if (!el) return;
    if (!ampImgEl || !ia) { el.style.display = 'none'; return; }
    const side = Math.max(ampImgEl.naturalWidth, ampImgEl.naturalHeight);
    const alta = ampCalidad === 'thick';
    el.style.display = (side > 1500 || (side > 1000 && ampFactor >= 4) || (alta && side > 900)) ? '' : 'none';
  }

  function ampActualizarNuevo() {
    if (!ampImgEl) return;
    let tw = Math.round(ampImgEl.naturalWidth * ampFactor);
    let th = Math.round(ampImgEl.naturalHeight * ampFactor);
    const m = Math.max(tw, th);
    if (m > AMP_MAX) { const k = AMP_MAX / m; tw = Math.round(tw * k); th = Math.round(th * k); }
    $('ampNewDims').textContent = tw + '×' + th + ' px';
  }

  function ampPick(file) {
    if (!file) return;
    if (!/^image\//.test(file.type) && !/\.(png|jpe?g|webp|gif|bmp)$/i.test(file.name)) {
      toast('Elige una imagen (PNG, JPG o WebP)'); return;
    }
    ampFile = file;
    let t = file.type;
    if (!/^image\/(png|jpeg|webp)$/.test(t)) {
      t = /\.jpe?g$/i.test(file.name) ? 'image/jpeg' : /\.webp$/i.test(file.name) ? 'image/webp' : 'image/png';
    }
    ampMime = t;
    $('ampName').textContent = file.name;
    if (ampSrcUrl) URL.revokeObjectURL(ampSrcUrl);
    ampSrcUrl = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      ampImgEl = img;
      $('ampOrigDims').textContent = img.naturalWidth + '×' + img.naturalHeight;
      $('ampPreview').src = ampSrcUrl;
      hide('ampDrop'); $('ampThumbRow').style.display = 'flex';
      hide('ampNewWrap'); hide('ampDownload'); hide('ampProgressCard');
      $('ampRun').disabled = false;
      if ($('ampHD')) $('ampHD').disabled = false;
      if ($('ampUltra')) $('ampUltra').disabled = false;
      ampActualizarNuevo(); ampActualizarAviso();
    };
    img.onerror = () => { toast('No se pudo leer la imagen.'); };
    img.src = ampSrcUrl;
  }
  window.ampReset = () => {
    ampFile = null; ampImgEl = null; $('ampInput').value = '';
    show('ampDrop'); $('ampThumbRow').style.display = 'none';
    $('ampRun').disabled = true;
    if ($('ampHD')) $('ampHD').disabled = true;
    if ($('ampUltra')) $('ampUltra').disabled = true;
    hide('ampProgressCard');
  };

  function srcToImage(src) {
    return new Promise((res, rej) => {
      const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('recorte')); i.src = src;
    });
  }

  // Redimensiona un lienzo/imagen a un tamaño exacto con suavizado alto.
  function redimensionar(fuente, tw, th) {
    const c = document.createElement('canvas'); c.width = tw; c.height = th;
    const ctx = c.getContext('2d');
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(fuente, 0, 0, tw, th);
    return c;
  }

  // Mejora rápida de calidad (SIN descargas ni GPU): realce de nitidez por
  // máscara de enfoque (unsharp mask) usando el desenfoque acelerado del
  // navegador, más un auto-contraste suave (estira el rango tonal) y una
  // saturación ligera. Corre en milisegundos, incluso en fotos grandes, y
  // hace que la foto se vea notablemente más nítida y viva al instante.
  function mejorarCalidad(canvas, amount) {
    const w = canvas.width, h = canvas.height;
    if (!w || !h) return canvas;
    amount = amount == null ? 0.6 : amount;   // fuerza del enfoque
    const ctx = canvas.getContext('2d');

    // 1) Copia desenfocada de referencia. El blur del navegador es rápido
    //    (usa GPU cuando está disponible) → base para la máscara de enfoque.
    let blurData = null;
    try {
      if ('filter' in ctx) {
        const bc = document.createElement('canvas');
        bc.width = w; bc.height = h;
        const bctx = bc.getContext('2d');
        const radius = Math.max(0.8, Math.min(2.4, Math.max(w, h) / 1400));
        bctx.filter = 'blur(' + radius.toFixed(2) + 'px)';
        bctx.drawImage(canvas, 0, 0);
        blurData = bctx.getImageData(0, 0, w, h).data;
      }
    } catch (_) { blurData = null; }

    let img;
    try { img = ctx.getImageData(0, 0, w, h); }
    catch (_) { return canvas; }   // lienzo "sucio" (cross-origin) → sin cambios
    const d = img.data;

    // 2) Auto-contraste: histograma de luminancia y recorte del 0.5% en cada
    //    extremo para estirar el rango sin quemar la foto. Si la imagen es muy
    //    plana (poco rango) se deja igual para no exagerar.
    const hist = new Uint32Array(256);
    for (let i = 0; i < d.length; i += 4) {
      const l = (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000 | 0;
      hist[l]++;
    }
    const totalPx = d.length / 4;
    const cut = totalPx * 0.005;
    let lo = 0, hi = 255, acc = 0;
    for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc > cut) { lo = v; break; } }
    acc = 0;
    for (let v = 255; v >= 0; v--) { acc += hist[v]; if (acc > cut) { hi = v; break; } }
    if (hi - lo < 32) { lo = 0; hi = 255; }
    const range = hi - lo || 1;
    const lut = new Uint8Array(256);
    for (let v = 0; v < 256; v++) {
      let n = (v - lo) / range * 255;
      lut[v] = n < 0 ? 0 : n > 255 ? 255 : n;
    }
    const sat = 1.08;   // saturación suave

    // 3) Una sola pasada: enfoque + auto-contraste + saturación por píxel.
    for (let i = 0; i < d.length; i += 4) {
      let r = d[i], g = d[i + 1], b = d[i + 2];
      if (blurData) {
        r += amount * (r - blurData[i]);
        g += amount * (g - blurData[i + 1]);
        b += amount * (b - blurData[i + 2]);
      }
      r = lut[r < 0 ? 0 : r > 255 ? 255 : r | 0];
      g = lut[g < 0 ? 0 : g > 255 ? 255 : g | 0];
      b = lut[b < 0 ? 0 : b > 255 ? 255 : b | 0];
      const l = 0.299 * r + 0.587 * g + 0.114 * b;
      r = l + (r - l) * sat;
      g = l + (g - l) * sat;
      b = l + (b - l) * sat;
      d[i]     = r < 0 ? 0 : r > 255 ? 255 : r;
      d[i + 1] = g < 0 ? 0 : g > 255 ? 255 : g;
      d[i + 2] = b < 0 ? 0 : b > 255 ? 255 : b;
    }
    ctx.putImageData(img, 0, 0);
    return canvas;
  }

  // Ampliación rápida por pasos (x2 sucesivos con suavizado alto) + mejora
  // rápida de calidad (nitidez y contraste) para que el modo sin IA no solo
  // agrande sino que también SE VEA mejor, al instante.
  function ampliarCanvas(img, tw, th) {
    let cur = redimensionar(img, img.naturalWidth, img.naturalHeight);
    while (cur.width < tw || cur.height < th) {
      cur = redimensionar(cur, Math.min(tw, cur.width * 2), Math.min(th, cur.height * 2));
    }
    return mejorarCalidad(cur);
  }

  // Devuelve los píxeles de una copia desenfocada del lienzo (blur del
  // navegador, acelerado por GPU cuando está disponible).
  function blurData(canvas, radius) {
    const w = canvas.width, h = canvas.height;
    const bc = document.createElement('canvas');
    bc.width = w; bc.height = h;
    const bx = bc.getContext('2d');
    if (!('filter' in bx)) return null;
    bx.filter = 'blur(' + radius.toFixed(2) + 'px)';
    bx.drawImage(canvas, 0, 0);
    try { return bx.getImageData(0, 0, w, h).data; } catch (_) { return null; }
  }

  // MÁXIMA DEFINICIÓN (HD) — realce agresivo de detalle, SIN IA ni descargas.
  // No inventa píxeles: exprime al máximo el detalle real que ya trae la foto
  // combinando tres escalas de frecuencia:
  //   • micro-detalle (radio pequeño)  → bordes finos, textura de piel/poros
  //   • detalle medio                  → definición general
  //   • contraste local "clarity"      → volumen y profundidad
  // Más auto-contraste por percentiles y saturación. Una sola pasada de
  // píxeles → corre en milisegundos aun en fotos grandes.
  function definirHD(canvas, ultra) {
    const w = canvas.width, h = canvas.height;
    if (!w || !h) return canvas;
    const ctx = canvas.getContext('2d');

    const base = Math.max(0.6, Math.min(1.4, Math.max(w, h) / 2000));
    // ULTRA añade una escala aún más fina para exprimir el micro-detalle.
    const nano   = ultra ? blurData(canvas, base * 0.5) : null; // ultra-fino
    const micro  = blurData(canvas, base);          // frecuencia alta (detalle fino)
    const medio  = blurData(canvas, base * 2.5);     // frecuencia media
    const grande = blurData(canvas, base * 9);       // baja (contraste local)

    let img;
    try { img = ctx.getImageData(0, 0, w, h); }
    catch (_) { return canvas; }
    const d = img.data;

    // Auto-contraste por percentiles de luminancia (recorte 0.4% por lado).
    const hist = new Uint32Array(256);
    for (let i = 0; i < d.length; i += 4) {
      hist[(d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000 | 0]++;
    }
    const cut = (d.length / 4) * 0.004;
    let lo = 0, hi = 255, acc = 0;
    for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc > cut) { lo = v; break; } }
    acc = 0;
    for (let v = 255; v >= 0; v--) { acc += hist[v]; if (acc > cut) { hi = v; break; } }
    if (hi - lo < 24) { lo = 0; hi = 255; }
    const range = hi - lo || 1;
    const lut = new Uint8Array(256);
    for (let v = 0; v < 256; v++) {
      let n = (v - lo) / range * 255;
      lut[v] = n < 0 ? 0 : n > 255 ? 255 : n;
    }

    // Fuerzas del realce por escala. ULTRA sube todas las ganancias.
    const kNano  = ultra ? 1.15 : 0;      // micro-detalle extremo (solo ultra)
    const kMicro = ultra ? 1.85 : 1.35;   // detalle fino (poros, pestañas, texto)
    const kMedio = ultra ? 0.80 : 0.55;   // definición media
    const kClar  = ultra ? 0.50 : 0.35;   // contraste local (clarity)
    const sat    = ultra ? 1.14 : 1.10;

    for (let i = 0; i < d.length; i += 4) {
      for (let c = 0; c < 3; c++) {
        const j = i + c;
        let v = d[j];
        if (nano)   v += kNano  * (d[j] - nano[j]);
        if (micro)  v += kMicro * (d[j] - micro[j]);
        if (medio)  v += kMedio * (d[j] - medio[j]);
        if (grande) v += kClar  * (d[j] - grande[j]);
        v = lut[v < 0 ? 0 : v > 255 ? 255 : v | 0];
        d[j] = v;
      }
      // Saturación suave para que el color no se apague tras el realce.
      let r = d[i], g = d[i + 1], b = d[i + 2];
      const l = 0.299 * r + 0.587 * g + 0.114 * b;
      r = l + (r - l) * sat; g = l + (g - l) * sat; b = l + (b - l) * sat;
      d[i]     = r < 0 ? 0 : r > 255 ? 255 : r;
      d[i + 1] = g < 0 ? 0 : g > 255 ? 255 : g;
      d[i + 2] = b < 0 ? 0 : b > 255 ? 255 : b;
    }
    ctx.putImageData(img, 0, 0);
    return canvas;
  }

  // Ampliación con IA (super-resolución ESRGAN, modelo nativo por factor →
  // una sola pasada). REQUIERE GPU (WebGL); si no, se usa el modo rápido.
  // Procesa por parches PEQUEÑOS para no congelar la pantalla (la barra de
  // progreso avanza entre parches). progreso: 0..1.
  function hayWebGL() {
    try {
      const c = document.createElement('canvas');
      return !!(c.getContext('webgl') || c.getContext('experimental-webgl'));
    } catch (_) { return false; }
  }

  async function ampliarIA(img, factor, prog) {
    if (!hayWebGL()) throw new Error('sin-webgl'); // sin GPU → modo rápido al instante (sin descargar nada)
    await cargarScript(CDN.tfjs);
    // Backend WebGL (GPU). Si no hay GPU, la IA congelaría el navegador,
    // así que se cae al modo rápido.
    let backend = '';
    try {
      if (window.tf) {
        await window.tf.ready();
        if (window.tf.getBackend() !== 'webgl') { try { await window.tf.setBackend('webgl'); } catch (_) {} }
        await window.tf.ready();
        backend = window.tf.getBackend();
      }
    } catch (_) {}
    if (backend !== 'webgl') throw new Error('sin-webgl');

    const esc = Math.max(2, Math.min(4, Math.round(factor))); // modelo nativo x2/x3/x4
    const modelo = CDN.upBases[ampCalidad] || CDN.upBases.medium;
    await cargarScript(modelo.url + 'x' + esc + '/index.min.js');
    await cargarScript(CDN.upscaler);
    const Model = window[modelo.g + esc + 'x'];
    if (!window.Upscaler || !Model) throw new Error('IA no disponible');

    // Tope de entrada: se reduce la foto antes de la IA para acotar el
    // trabajo; el tamaño final se logra igual con el lienzo.
    let entrada = img;
    const maxSide = Math.max(img.naturalWidth, img.naturalHeight);
    if (maxSide > AMP_MAX_IN) {
      const k = AMP_MAX_IN / maxSide;
      entrada = redimensionar(img, Math.round(img.naturalWidth * k), Math.round(img.naturalHeight * k));
    }
    const inSide = Math.max(entrada.width || entrada.naturalWidth, entrada.height || entrada.naturalHeight);
    // Parches pequeños: cada inferencia es corta → la UI no se congela.
    const opts = inSide > 96 ? { patchSize: 64, padding: 4 } : {};

    const upscaler = new window.Upscaler({ model: Model });
    let cur;
    try {
      const src = await upscaler.upscale(entrada, Object.assign({}, opts, { progress: r => prog(0.05 + r * 0.9) }));
      cur = await srcToImage(src);
    } finally {
      try { upscaler.dispose && upscaler.dispose(); } catch (_) {}
    }
    // Devuelve un lienzo con el tamaño final exacto (redimensionar es 1:1 si
    // ya coincide, así que no pierde calidad cuando no hubo tope de entrada).
    let tw = Math.round(img.naturalWidth * factor), th = Math.round(img.naturalHeight * factor);
    const m = Math.max(tw, th);
    if (m > AMP_MAX) { const k = AMP_MAX / m; tw = Math.round(tw * k); th = Math.round(th * k); }
    return redimensionar(cur, tw, th);
  }

  async function ampFinalizar(canvas) {
    const mime = ampMime === 'image/png' ? 'image/png' : ampMime;
    const q = mime === 'image/png' ? undefined : 0.92;
    let blob = await toBlobAsync(canvas, mime, q);
    let ext = mime === 'image/jpeg' ? 'jpg' : mime === 'image/webp' ? 'webp' : 'png';
    if (!blob) { blob = await toBlobAsync(canvas, 'image/png'); ext = 'png'; }
    if (ampUrl) URL.revokeObjectURL(ampUrl);
    ampUrl = URL.createObjectURL(blob);
    $('ampPreview').src = ampUrl;
    const dl = $('ampDownload'); dl.href = ampUrl; dl.download = baseName(ampFile.name) + '-ampliada.' + ext;
    $('ampNewDims').textContent = canvas.width + '×' + canvas.height + ' px';
    $('ampNewSize').textContent = kb(blob.size);
    $('ampNewWrap').style.display = ''; dl.style.display = '';
  }

  window.ampProcesar = async function () {
    if (ampBusy || !ampImgEl) return;
    ampBusy = true; $('ampRun').disabled = true;
    show('ampProgressCard'); hide('ampNewWrap'); hide('ampDownload');
    let tw = Math.round(ampImgEl.naturalWidth * ampFactor);
    let th = Math.round(ampImgEl.naturalHeight * ampFactor);
    const m = Math.max(tw, th);
    if (m > AMP_MAX) { const k = AMP_MAX / m; tw = Math.round(tw * k); th = Math.round(th * k); toast('Se limitó el tamaño para evitar errores de memoria.'); }
    const usarIA = $('ampIAToggle') && $('ampIAToggle').checked;
    try {
      let canvas;
      if (usarIA) {
        setBar('ampBar', 'ampPct', 'ampStatus', 3, 'Preparando IA…');
        try {
          canvas = await ampliarIA(ampImgEl, ampFactor,
            r => setBar('ampBar', 'ampPct', 'ampStatus', Math.min(95, 5 + r * 90), 'Mejorando con IA…'));
        } catch (e) {
          console.error(e);
          toast(e && e.message === 'sin-webgl'
            ? 'Tu dispositivo no acelera la IA (sin GPU/WebGL); se usó el modo rápido con realce.'
            : 'La IA no está disponible ahora; se usó el modo rápido con realce.');
          setBar('ampBar', 'ampPct', 'ampStatus', 40, 'Ampliando y realzando…');
          canvas = ampliarCanvas(ampImgEl, tw, th);
        }
      } else {
        setBar('ampBar', 'ampPct', 'ampStatus', 30, 'Ampliando y realzando…');
        await new Promise(r => setTimeout(r, 30));
        canvas = ampliarCanvas(ampImgEl, tw, th);
      }
      setBar('ampBar', 'ampPct', 'ampStatus', 96, 'Generando archivo…');
      await ampFinalizar(canvas);
      setBar('ampBar', 'ampPct', 'ampStatus', 100, '¡Listo! Descarga tu foto.');
    } catch (e) {
      console.error(e);
      setBar('ampBar', 'ampPct', 'ampStatus', 0, 'Error: ' + (e.message || e));
      toast('❌ ' + (e.message || 'Falló la ampliación'));
      $('ampRun').disabled = false;
    } finally {
      ampBusy = false;
    }
  };

  // Botones de definición rápida (sin IA ni descargas): amplían por el factor
  // elegido con el modo rápido y aplican realce de detalle. 'ultra' aplica una
  // pasada más agresiva y una segunda pasada fina para máxima definición.
  async function ejecutarDefinicion(ultra) {
    if (ampBusy || !ampImgEl) return;
    ampBusy = true;
    $('ampRun').disabled = true;
    const btnHD = $('ampHD'), btnUltra = $('ampUltra');
    if (btnHD) btnHD.disabled = true;
    if (btnUltra) btnUltra.disabled = true;
    show('ampProgressCard'); hide('ampNewWrap'); hide('ampDownload');
    let tw = Math.round(ampImgEl.naturalWidth * ampFactor);
    let th = Math.round(ampImgEl.naturalHeight * ampFactor);
    const m = Math.max(tw, th);
    if (m > AMP_MAX) { const k = AMP_MAX / m; tw = Math.round(tw * k); th = Math.round(th * k); toast('Se limitó el tamaño para evitar errores de memoria.'); }
    const etiqueta = ultra ? 'Ultra definición' : 'HD';
    try {
      setBar('ampBar', 'ampPct', 'ampStatus', 18, 'Ampliando…');
      await new Promise(r => setTimeout(r, 20));
      // ampliarCanvas ya aplica una mejora suave; encima definimos al máximo.
      let canvas = ampliarCanvas(ampImgEl, tw, th);
      setBar('ampBar', 'ampPct', 'ampStatus', 55, 'Definiendo detalle (' + etiqueta + ')…');
      await new Promise(r => setTimeout(r, 20));
      canvas = definirHD(canvas, ultra);
      if (ultra) {
        // Segunda pasada fina para rematar el micro-contraste sin generar halos.
        setBar('ampBar', 'ampPct', 'ampStatus', 80, 'Rematando micro-detalle…');
        await new Promise(r => setTimeout(r, 20));
        canvas = mejorarCalidad(canvas, 0.35);
      }
      setBar('ampBar', 'ampPct', 'ampStatus', 96, 'Generando archivo…');
      await ampFinalizar(canvas);
      setBar('ampBar', 'ampPct', 'ampStatus', 100,
        ultra ? '¡Listo! Ultra definición aplicada.' : '¡Listo! Foto definida al máximo.');
    } catch (e) {
      console.error(e);
      setBar('ampBar', 'ampPct', 'ampStatus', 0, 'Error: ' + (e.message || e));
      toast('❌ ' + (e.message || 'Falló la definición'));
    } finally {
      $('ampRun').disabled = false;
      if (btnHD) btnHD.disabled = false;
      if (btnUltra) btnUltra.disabled = false;
      ampBusy = false;
    }
  }
  window.ampDefinir = () => ejecutarDefinicion(false);
  window.ampUltra = () => ejecutarDefinicion(true);

  // --------------------- Cableado de inputs/drag&drop ---------------------
  function wireDrop(zoneId, onFile) {
    const z = $(zoneId); if (!z) return;
    ['dragenter', 'dragover'].forEach(ev => z.addEventListener(ev, e => { e.preventDefault(); z.classList.add('dragover'); }));
    ['dragleave', 'dragend', 'drop'].forEach(ev => z.addEventListener(ev, e => { e.preventDefault(); z.classList.remove('dragover'); }));
    z.addEventListener('drop', e => { const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]; if (f) onFile(f); });
  }

  function init() {
    renderLauncher();
    $('ocrInput').addEventListener('change', e => ocrPick(e.target.files[0]));
    $('imgInput').addEventListener('change', e => imgPick(e.target.files[0]));
    $('fondoInput').addEventListener('change', e => fondoPick(e.target.files[0]));
    $('colorInput').addEventListener('change', e => colorPick(e.target.files[0]));
    $('ampInput').addEventListener('change', e => ampPick(e.target.files[0]));
    $('ampIAToggle').addEventListener('change', ampActualizarAviso);
    wireDrop('ocrDrop', ocrPick);
    wireDrop('imgDrop', imgPick);
    wireDrop('fondoDrop', fondoPick);
    wireDrop('colorDrop', colorPick);
    wireDrop('ampDrop', ampPick);
    // Estado inicial del historial para el botón "atrás".
    try { history.replaceState({ view: 'homeLauncher' }, ''); } catch (_) {}
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
