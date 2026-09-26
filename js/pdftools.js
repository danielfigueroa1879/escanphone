/* ============================================================================
   Herramientas PDF — suite privada, 100% en el navegador (sin APIs de pago).
   Módulo independiente: NO toca el OCR existente (appOCR en tools.js). Reutiliza
   las mismas librerías open-source ya usadas por la app, cargadas bajo demanda:
     · pdf-lib   → unir, organizar, extraer, eliminar, dividir, imágenes→PDF, comprimir
     · pdf.js    → miniaturas, PDF→imágenes, extracción de texto (PDF→Word), comprimir
     · JSZip     → empaquetar múltiples salidas y construir el DOCX (OOXML)
     · tesseract → OCR de respaldo para PDF escaneado en PDF→Word
   Todo el procesamiento es local; no se sube ningún documento a terceros.
   ========================================================================== */
(function () {
  'use strict';

  const $ = id => document.getElementById(id);
  const toast = m => { if (typeof window.showToast === 'function') window.showToast(m); };
  const baseName = n => (n || 'archivo').replace(/\.[^.]+$/, '') || 'archivo';

  // Límites de seguridad (evitan colgar el dispositivo con archivos enormes).
  const MAX_FILE_MB = 200;          // por archivo
  const MAX_PAGES_THUMB = 400;      // tope de miniaturas a renderizar

  const CDN = {
    pdfjs:  'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js',
    pdfjsW: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js',
    pdflib: 'https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js',
    jszip:  'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js',
    tess:   'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js'
  };

  // ---------------------- Carga perezosa de librerías ----------------------
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
  async function ensurePdfLib() { if (!window.PDFLib) await cargarScript(CDN.pdflib); return window.PDFLib; }
  async function ensureJSZip() { if (!window.JSZip) await cargarScript(CDN.jszip); return window.JSZip; }
  async function ensurePdfjs() {
    if (!window.pdfjsLib) await cargarScript(CDN.pdfjs);
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = CDN.pdfjsW;
    return window.pdfjsLib;
  }
  async function ensureTesseract() { if (!window.Tesseract) await cargarScript(CDN.tess); return window.Tesseract; }

  // ---------------------------- Utilidades ----------------------------
  const BACK_SVG = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>';
  const THEME_BTN = '<button class="icon-btn" type="button" onclick="cambiarTema()" aria-label="Cambiar tema" title="Tema">🌓</button>';

  function kb(b) {
    if (b >= 1048576) return (b / 1048576).toFixed(2) + ' MB';
    return Math.max(1, Math.round(b / 1024)) + ' KB';
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function download(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 8000);
  }
  function readAB(file) { return file.arrayBuffer(); }

  // Valida que sea un PDF real (cabecera %PDF) y respete el tamaño máximo.
  async function validarPdf(file) {
    if (!file) throw new Error('No se seleccionó ningún archivo.');
    if (file.size > MAX_FILE_MB * 1048576)
      throw new Error('El archivo supera ' + MAX_FILE_MB + ' MB. Divídelo o comprímelo antes.');
    const esPdfNombre = /\.pdf$/i.test(file.name) || file.type === 'application/pdf';
    let head;
    try { head = new Uint8Array(await file.slice(0, 5).arrayBuffer()); } catch (_) { head = new Uint8Array(); }
    const firma = head[0] === 0x25 && head[1] === 0x50 && head[2] === 0x44 && head[3] === 0x46; // %PDF
    if (!firma && !esPdfNombre) throw new Error('El archivo no parece un PDF válido.');
    return true;
  }
  function esImagen(file) {
    return /^image\//.test(file.type) || /\.(png|jpe?g|webp|gif|bmp)$/i.test(file.name || '');
  }

  // Carga un PDF con pdf-lib manejando errores de archivos corruptos/cifrados.
  async function abrirConPdfLib(bytes) {
    const { PDFDocument } = await ensurePdfLib();
    try {
      return await PDFDocument.load(bytes, { ignoreEncryption: true });
    } catch (e) {
      throw new Error('No se pudo leer el PDF (puede estar dañado o protegido).');
    }
  }
  async function abrirConPdfjs(bytes) {
    const pdfjs = await ensurePdfjs();
    try {
      return await pdfjs.getDocument({ data: bytes.slice ? bytes.slice() : bytes }).promise;
    } catch (e) {
      throw new Error('No se pudo abrir el PDF (dañado o protegido).');
    }
  }

  // Renderiza una página de pdf.js a un canvas con un ancho objetivo.
  async function renderPagina(pdf, num, targetW) {
    const page = await pdf.getPage(num);
    const base = page.getViewport({ scale: 1 });
    const scale = Math.max(0.1, targetW / base.width);
    const vp = page.getViewport({ scale });
    const c = document.createElement('canvas');
    c.width = Math.ceil(vp.width); c.height = Math.ceil(vp.height);
    await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
    return c;
  }

  // Barra de progreso genérica por herramienta.
  function setProg(id, pct, msg, showCancel) {
    const card = $(id + 'Prog');
    if (card) card.style.display = '';
    const bar = $(id + 'Bar'); if (bar) bar.style.width = Math.max(0, Math.min(100, pct)) + '%';
    const st = $(id + 'Status'); if (st && msg != null) st.textContent = msg;
    const p = $(id + 'Pct'); if (p) p.textContent = Math.round(Math.max(0, Math.min(100, pct))) + '%';
    const cx = $(id + 'Cancel'); if (cx) cx.style.display = showCancel ? '' : 'none';
  }
  function ocultarProg(id) { const c = $(id + 'Prog'); if (c) c.style.display = 'none'; }

  // Token de cancelación para operaciones largas.
  function nuevoToken() { return { cancelado: false }; }

  // ---------------------- Estructura visual de una herramienta ----------------------
  function crearVista(id, emoji, title, subtitle, bodyHTML) {
    let v = $(id);
    if (!v) { v = document.createElement('div'); v.className = 'container view'; v.id = id; document.body.appendChild(v); }
    v.innerHTML =
      '<div class="tool-head">' +
        '<button class="icon-btn back" type="button" onclick="volverPDF()" aria-label="Volver" title="Volver">' + BACK_SVG + '</button>' +
        '<div class="tool-ico">' + emoji + '</div>' +
        '<div class="tool-txt"><h1>' + esc(title) + '</h1><p class="subtitle">' + esc(subtitle) + '</p></div>' +
        THEME_BTN +
      '</div>' + bodyHTML +
      '<footer class="footer">© 2026 Todos los derechos reservados.<br>Plataforma desarrollada por <span class="autor">Daniel Figueroa Chacama</span>.<br><span class="rol">Ingeniero en Informática &amp; Ciberseguridad</span></footer>';
    return v;
  }
  function dropHTML(id, accept, multiple, titulo, sub) {
    return '<input type="file" id="' + id + 'Input" accept="' + accept + '"' + (multiple ? ' multiple' : '') + ' style="display:none;">' +
      '<div class="drop-zone" id="' + id + 'Drop">' +
        '<div class="dz-emoji">📄</div>' +
        '<div class="dz-title">' + titulo + '</div>' +
        '<div class="dz-sub">' + sub + '</div>' +
      '</div>';
  }
  function progHTML(id) {
    return '<div class="card" id="' + id + 'Prog" style="display:none;">' +
      '<div class="bar-wrap"><div class="bar"><span id="' + id + 'Bar"></span></div>' +
      '<div class="bar-meta"><span id="' + id + 'Status">Preparando…</span><span class="pct" id="' + id + 'Pct">0%</span></div></div>' +
      '<button class="btn" id="' + id + 'Cancel" style="display:none; margin-top:12px;">Cancelar</button></div>';
  }
  function wireDrop(id, onFiles) {
    const inp = $(id + 'Input'), zone = $(id + 'Drop');
    if (inp) inp.addEventListener('change', e => { if (e.target.files.length) onFiles(Array.from(e.target.files)); inp.value = ''; });
    if (zone) {
      zone.addEventListener('click', () => inp && inp.click());
      ['dragenter', 'dragover'].forEach(ev => zone.addEventListener(ev, e => { e.preventDefault(); zone.classList.add('dragover'); }));
      ['dragleave', 'dragend', 'drop'].forEach(ev => zone.addEventListener(ev, e => { e.preventDefault(); zone.classList.remove('dragover'); }));
      zone.addEventListener('drop', e => {
        const f = e.dataTransfer && e.dataTransfer.files ? Array.from(e.dataTransfer.files) : [];
        if (f.length) onFiles(f);
      });
    }
  }

  // Parsea "1, 3-5, 8" → [0,2,3,4,7] (0-based, únicos, ordenados, validados).
  function parseRangos(txt, total) {
    const out = new Set();
    (txt || '').split(',').forEach(part => {
      part = part.trim(); if (!part) return;
      const m = part.match(/^(\d+)\s*-\s*(\d+)$/);
      if (m) {
        let a = +m[1], b = +m[2]; if (a > b) [a, b] = [b, a];
        for (let i = a; i <= b; i++) if (i >= 1 && i <= total) out.add(i - 1);
      } else if (/^\d+$/.test(part)) {
        const n = +part; if (n >= 1 && n <= total) out.add(n - 1);
      }
    });
    return Array.from(out).sort((x, y) => x - y);
  }

  // ====================================================================
  // ===========================  HUB / MENÚ  ===========================
  // ====================================================================
  const PDF_TOOLS = [
    { id: 'appOCR',      emoji: '🔎', title: 'OCR / PDF buscable', desc: 'Reconoce texto de escaneos e imágenes y crea un PDF con texto seleccionable.' },
    { id: 'pdfMerge',    emoji: '🔗', title: 'Unir PDF',           desc: 'Combina varios PDF en uno; reordena y quita archivos antes de unir.' },
    { id: 'pdfOrganize', emoji: '🗂️', title: 'Organizar PDF',      desc: 'Reordena, rota, duplica, elimina e inserta páginas de otro PDF.' },
    { id: 'pdfExtract',  emoji: '✂️', title: 'Extraer páginas',    desc: 'Crea un PDF nuevo solo con las páginas que elijas.' },
    { id: 'pdfRemove',   emoji: '🗑️', title: 'Eliminar páginas',   desc: 'Quita las páginas marcadas y conserva el resto.' },
    { id: 'pdfSplit',    emoji: '🪓', title: 'Dividir PDF',        desc: 'Separa por páginas, por rangos o cada N páginas.' },
    { id: 'pdfCompress', emoji: '🗜️', title: 'Comprimir PDF',      desc: 'Reduce el tamaño con niveles de calidad. Muestra el ahorro.' },
    { id: 'pdfImg2Pdf',  emoji: '🖼️', title: 'Imágenes a PDF',     desc: 'Convierte JPG, PNG o WebP en un único PDF; reordena las imágenes.' },
    { id: 'pdfPdf2Img',  emoji: '📸', title: 'PDF a imágenes',     desc: 'Exporta las páginas como JPG, PNG o WebP a la resolución que elijas.' },
    { id: 'pdfPdf2Word', emoji: '📝', title: 'PDF a Word',         desc: 'Genera un DOCX editable; usa OCR automáticamente si el PDF es escaneado.' }
  ];

  function crearHub() {
    let v = $('appPDF');
    if (!v) { v = document.createElement('div'); v.className = 'container view'; v.id = 'appPDF'; document.body.appendChild(v); }
    const cards = PDF_TOOLS.map(t =>
      '<button class="tool-card" type="button" data-go="' + t.id + '">' +
        '<div class="tc-emoji">' + t.emoji + '</div>' +
        '<div class="tc-txt"><h3>' + esc(t.title) + '</h3><p>' + esc(t.desc) + '</p></div>' +
        '<span class="tc-go">›</span>' +
      '</button>').join('');
    v.innerHTML =
      '<div class="header-row">' +
        '<button class="icon-btn back" type="button" onclick="volverInicio()" aria-label="Volver" title="Volver">' + BACK_SVG + '</button>' +
        '<div class="header-txt"><h1>Herramientas PDF</h1><p class="subtitle">Todo se procesa en tu dispositivo. Tus documentos no se envían a ningún servidor.</p></div>' +
        THEME_BTN +
      '</div>' +
      '<div class="section-label">Elige una herramienta</div>' +
      '<div class="launcher-grid">' + cards + '</div>' +
      '<footer class="footer">© 2026 Todos los derechos reservados.<br>Plataforma desarrollada por <span class="autor">Daniel Figueroa Chacama</span>.<br><span class="rol">Ingeniero en Informática &amp; Ciberseguridad</span></footer>';
    v.querySelectorAll('[data-go]').forEach(b => b.addEventListener('click', () => window.abrirHerramienta(b.dataset.go)));
  }
  window.volverPDF = () => window.abrirHerramienta('appPDF');

  // ====================================================================
  // ===================  Lista reordenable (DnD)  =====================
  // Reordenamiento con botones ▲▼ (fiable en móvil) + arrastrar en escritorio.
  // ====================================================================
  function pintarListaReordenable(cont, items, opts) {
    // items: [{key, thumb?, label, sub?}] ; opts: {onReorder, acciones(item,idx)->html, onAccion}
    cont.innerHTML = '';
    items.forEach((it, idx) => {
      const row = document.createElement('div');
      row.className = 'pdf-row';
      row.draggable = true;
      row.dataset.idx = idx;
      row.innerHTML =
        (it.thumb ? '<img class="pdf-row-thumb" src="' + it.thumb + '" alt="">' : '<span class="pdf-row-ico">📄</span>') +
        '<div class="pdf-row-info"><div class="pdf-row-name">' + esc(it.label) + '</div>' +
          (it.sub ? '<div class="pdf-row-sub">' + esc(it.sub) + '</div>' : '') + '</div>' +
        '<div class="pdf-row-actions">' +
          '<button class="pdf-mini" data-act="up" title="Subir">▲</button>' +
          '<button class="pdf-mini" data-act="down" title="Bajar">▼</button>' +
          (opts.acciones ? opts.acciones(it, idx) : '') +
          '<button class="pdf-mini danger" data-act="del" title="Quitar">✕</button>' +
        '</div>';
      row.querySelectorAll('[data-act]').forEach(b => b.addEventListener('click', e => {
        e.stopPropagation();
        const act = b.dataset.act;
        if (act === 'up' && idx > 0) { const a = items.splice(idx, 1)[0]; items.splice(idx - 1, 0, a); opts.onReorder(); }
        else if (act === 'down' && idx < items.length - 1) { const a = items.splice(idx, 1)[0]; items.splice(idx + 1, 0, a); opts.onReorder(); }
        else if (act === 'del') { items.splice(idx, 1); opts.onReorder(); }
        else if (opts.onAccion) opts.onAccion(act, idx);
      }));
      // Arrastrar en escritorio
      row.addEventListener('dragstart', e => { row.classList.add('dragging'); e.dataTransfer.setData('text/plain', String(idx)); });
      row.addEventListener('dragend', () => row.classList.remove('dragging'));
      row.addEventListener('dragover', e => e.preventDefault());
      row.addEventListener('drop', e => {
        e.preventDefault();
        const from = +e.dataTransfer.getData('text/plain');
        const to = idx;
        if (from === to || isNaN(from)) return;
        const a = items.splice(from, 1)[0];
        items.splice(to, 0, a);
        opts.onReorder();
      });
      cont.appendChild(row);
    });
  }

  // ====================================================================
  // ==========================  1. UNIR PDF  ==========================
  // ====================================================================
  const merge = { files: [] };
  function buildMerge() {
    crearVista('pdfMerge', '🔗', 'Unir PDF', 'Combina varios PDF en uno solo.',
      '<div class="card">' +
        dropHTML('mrg', 'application/pdf', true, 'Sube tus PDF', 'Toca o arrastra varios archivos PDF') +
        '<div class="pdf-list" id="mrgList" style="margin-top:14px;"></div>' +
        '<button class="btn brand full" id="mrgRun" style="margin-top:14px;" disabled>🔗 Unir y descargar</button>' +
      '</div>' + progHTML('mrg'));
    wireDrop('mrg', addMergeFiles);
    $('mrgRun').addEventListener('click', runMerge);
    renderMerge();
  }
  async function addMergeFiles(files) {
    for (const f of files) {
      try { await validarPdf(f); merge.files.push({ file: f, key: f.name + Math.random() }); }
      catch (e) { toast('«' + f.name + '»: ' + e.message); }
    }
    renderMerge();
  }
  function renderMerge() {
    const items = merge.files.map(x => ({ key: x.key, label: x.file.name, sub: kb(x.file.size) }));
    pintarListaReordenable($('mrgList'), items, {
      onReorder: () => { merge.files = items.map(i => merge.files.find(f => f.key === i.key)); renderMerge(); }
    });
    $('mrgRun').disabled = merge.files.length < 2;
    if (merge.files.length && merge.files.length < 2) toast('Agrega al menos 2 PDF para unir.');
  }
  async function runMerge() {
    if (merge.files.length < 2) return;
    $('mrgRun').disabled = true;
    try {
      const { PDFDocument } = await ensurePdfLib();
      const out = await PDFDocument.create();
      for (let i = 0; i < merge.files.length; i++) {
        setProg('mrg', 5 + (i / merge.files.length) * 85, 'Uniendo ' + (i + 1) + '/' + merge.files.length + '…');
        const bytes = new Uint8Array(await readAB(merge.files[i].file));
        const src = await abrirConPdfLib(bytes);
        const pages = await out.copyPages(src, src.getPageIndices());
        pages.forEach(p => out.addPage(p));
      }
      setProg('mrg', 95, 'Generando archivo…');
      const blob = new Blob([await out.save()], { type: 'application/pdf' });
      download(blob, 'unido.pdf');
      setProg('mrg', 100, '¡Listo! PDF descargado.');
      toast('✅ PDF unido');
    } catch (e) {
      console.error(e); setProg('mrg', 0, 'Error: ' + e.message); toast('❌ ' + e.message);
    } finally { $('mrgRun').disabled = false; }
  }

  // ====================================================================
  // ========================  2. ORGANIZAR PDF  =======================
  // ====================================================================
  const org = { sources: {}, pages: [], sel: new Set() };
  function buildOrganize() {
    crearVista('pdfOrganize', '🗂️', 'Organizar PDF', 'Reordena, rota, duplica, elimina e inserta páginas.',
      '<div class="card">' +
        dropHTML('org', 'application/pdf', false, 'Sube un PDF', 'Toca o arrastra el PDF a organizar') +
        '<div id="orgTools" style="display:none; margin-top:12px;">' +
          '<div class="pdf-toolbar">' +
            '<button class="btn sm" id="orgAdd">➕ Añadir PDF</button>' +
            '<button class="btn sm" id="orgRotate">↻ Rotar sel.</button>' +
            '<button class="btn sm" id="orgDup">⧉ Duplicar sel.</button>' +
            '<button class="btn sm danger-btn" id="orgDel">🗑 Eliminar sel.</button>' +
          '</div>' +
          '<p class="name-hint" id="orgHint" style="margin:8px 2px 0;">Arrastra para reordenar (o usa ▲▼). Toca una miniatura para seleccionar.</p>' +
          '<div class="pdf-grid" id="orgGrid"></div>' +
          '<button class="btn brand full" id="orgRun" style="margin-top:14px;">✅ Generar PDF</button>' +
        '</div>' +
      '</div>' + progHTML('org'));
    wireDrop('org', fs => addOrganizeSource(fs[0], true));
    $('orgAdd').addEventListener('click', () => pickInto(f => addOrganizeSource(f, false)));
    $('orgRotate').addEventListener('click', () => { org.pages.forEach((p, i) => { if (org.sel.has(i)) p.rot = (p.rot + 90) % 360; }); renderOrganize(); });
    $('orgDup').addEventListener('click', () => {
      const dups = []; org.pages.forEach((p, i) => { if (org.sel.has(i)) dups.push(Object.assign({}, p)); });
      org.pages = org.pages.concat(dups); org.sel.clear(); renderOrganize();
    });
    $('orgDel').addEventListener('click', () => {
      if (!org.sel.size) { toast('Selecciona páginas primero.'); return; }
      org.pages = org.pages.filter((_, i) => !org.sel.has(i)); org.sel.clear(); renderOrganize();
    });
    $('orgRun').addEventListener('click', runOrganize);
  }
  function pickInto(cb) {
    const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'application/pdf';
    inp.onchange = () => { if (inp.files[0]) cb(inp.files[0]); };
    inp.click();
  }
  async function addOrganizeSource(file, reset) {
    if (!file) return;
    try {
      await validarPdf(file);
      setProg('org', 8, 'Cargando páginas…', false);
      if (reset) { org.sources = {}; org.pages = []; org.sel.clear(); }
      const bytes = new Uint8Array(await readAB(file));
      const sid = 's' + Date.now() + Math.floor(Math.random() * 1000);
      const pdf = await abrirConPdfjs(bytes);
      const n = Math.min(pdf.numPages, MAX_PAGES_THUMB);
      if (pdf.numPages > MAX_PAGES_THUMB) toast('Se muestran las primeras ' + MAX_PAGES_THUMB + ' páginas.');
      org.sources[sid] = { bytes };
      for (let i = 1; i <= n; i++) {
        setProg('org', 8 + (i / n) * 80, 'Miniatura ' + i + '/' + n + '…');
        const c = await renderPagina(pdf, i, 150);
        org.pages.push({ sid, index: i - 1, rot: 0, thumb: c.toDataURL('image/jpeg', 0.7) });
      }
      ocultarProg('org');
      $('orgTools').style.display = '';
      $('orgDrop').style.display = 'none';
      renderOrganize();
    } catch (e) { console.error(e); ocultarProg('org'); toast('❌ ' + e.message); }
  }
  function renderOrganize() {
    const grid = $('orgGrid');
    grid.innerHTML = '';
    org.pages.forEach((p, idx) => {
      const cell = document.createElement('div');
      cell.className = 'pdf-cell' + (org.sel.has(idx) ? ' selected' : '');
      cell.draggable = true; cell.dataset.idx = idx;
      cell.innerHTML =
        '<div class="pdf-cell-thumb"><img src="' + p.thumb + '" alt="" style="transform:rotate(' + p.rot + 'deg);"></div>' +
        '<div class="pdf-cell-bar">' +
          '<span class="pdf-cell-num">' + (idx + 1) + '</span>' +
          '<button class="pdf-mini" data-a="rot" title="Rotar">↻</button>' +
          '<button class="pdf-mini" data-a="dup" title="Duplicar">⧉</button>' +
          '<button class="pdf-mini danger" data-a="del" title="Eliminar">✕</button>' +
        '</div>';
      cell.querySelector('.pdf-cell-thumb').addEventListener('click', () => {
        if (org.sel.has(idx)) org.sel.delete(idx); else org.sel.add(idx); renderOrganize();
      });
      cell.querySelectorAll('[data-a]').forEach(b => b.addEventListener('click', e => {
        e.stopPropagation();
        const a = b.dataset.a;
        if (a === 'rot') p.rot = (p.rot + 90) % 360;
        else if (a === 'dup') org.pages.splice(idx + 1, 0, Object.assign({}, p));
        else if (a === 'del') org.pages.splice(idx, 1);
        org.sel.clear(); renderOrganize();
      }));
      cell.addEventListener('dragstart', e => { cell.classList.add('dragging'); e.dataTransfer.setData('text/plain', String(idx)); });
      cell.addEventListener('dragend', () => cell.classList.remove('dragging'));
      cell.addEventListener('dragover', e => e.preventDefault());
      cell.addEventListener('drop', e => {
        e.preventDefault();
        const from = +e.dataTransfer.getData('text/plain');
        if (isNaN(from) || from === idx) return;
        const a = org.pages.splice(from, 1)[0];
        org.pages.splice(idx, 0, a); org.sel.clear(); renderOrganize();
      });
      grid.appendChild(cell);
    });
    $('orgRun').disabled = !org.pages.length;
  }
  async function runOrganize() {
    if (!org.pages.length) return;
    $('orgRun').disabled = true;
    try {
      const { PDFDocument, degrees } = await ensurePdfLib();
      const libDocs = {};
      const out = await PDFDocument.create();
      for (let i = 0; i < org.pages.length; i++) {
        setProg('org', 5 + (i / org.pages.length) * 88, 'Página ' + (i + 1) + '/' + org.pages.length + '…');
        const pg = org.pages[i];
        if (!libDocs[pg.sid]) libDocs[pg.sid] = await abrirConPdfLib(org.sources[pg.sid].bytes);
        const [copied] = await out.copyPages(libDocs[pg.sid], [pg.index]);
        if (pg.rot) {
          const cur = copied.getRotation().angle || 0;
          copied.setRotation(degrees((cur + pg.rot) % 360));
        }
        out.addPage(copied);
      }
      setProg('org', 96, 'Generando archivo…');
      const blob = new Blob([await out.save()], { type: 'application/pdf' });
      download(blob, 'organizado.pdf');
      setProg('org', 100, '¡Listo! PDF descargado.');
      toast('✅ PDF organizado');
    } catch (e) { console.error(e); setProg('org', 0, 'Error: ' + e.message); toast('❌ ' + e.message); }
    finally { $('orgRun').disabled = false; }
  }

  // ====================================================================
  // ============  3 y 4. EXTRAER / ELIMINAR PÁGINAS  ==================
  // Comparten la misma UI de selección; cambia solo qué páginas se guardan.
  // ====================================================================
  function buildPagesTool(id, emoji, title, subtitle, modo) {
    // modo: 'extract' guarda las seleccionadas; 'remove' guarda las NO seleccionadas.
    const st = { bytes: null, sel: new Set(), total: 0, thumbs: [] };
    crearVista(id, emoji, title, subtitle,
      '<div class="card">' +
        dropHTML(id, 'application/pdf', false, 'Sube un PDF', 'Toca o arrastra el PDF') +
        '<div id="' + id + 'Panel" style="display:none; margin-top:12px;">' +
          '<div class="field-row"><div class="fr-label">Páginas' +
            '<small>' + (modo === 'extract' ? 'Se guardarán las páginas indicadas o marcadas' : 'Se eliminarán las páginas indicadas o marcadas') + '</small></div>' +
            '<input class="pdf-input" id="' + id + 'Spec" placeholder="ej: 1, 3-5, 8" inputmode="numeric">' +
          '</div>' +
          '<div class="pdf-toolbar"><button class="btn sm" id="' + id + 'All">Marcar todas</button>' +
            '<button class="btn sm" id="' + id + 'None">Limpiar</button></div>' +
          '<div class="pdf-grid" id="' + id + 'Grid"></div>' +
          '<button class="btn brand full" id="' + id + 'Run" style="margin-top:14px;">' +
            (modo === 'extract' ? '✂️ Extraer y descargar' : '🗑 Eliminar y descargar') + '</button>' +
        '</div>' +
      '</div>' + progHTML(id));
    wireDrop(id, fs => cargar(fs[0]));

    async function cargar(file) {
      if (!file) return;
      try {
        await validarPdf(file);
        setProg(id, 8, 'Cargando páginas…');
        const bytes = new Uint8Array(await readAB(file));
        st.bytes = bytes; st.name = file.name; st.sel.clear(); st.thumbs = [];
        const pdf = await abrirConPdfjs(bytes);
        st.total = pdf.numPages;
        const n = Math.min(pdf.numPages, MAX_PAGES_THUMB);
        for (let i = 1; i <= n; i++) {
          setProg(id, 8 + (i / n) * 82, 'Miniatura ' + i + '/' + n + '…');
          const c = await renderPagina(pdf, i, 150);
          st.thumbs.push(c.toDataURL('image/jpeg', 0.7));
        }
        ocultarProg(id);
        $(id + 'Panel').style.display = ''; $(id + 'Drop').style.display = 'none';
        pintar();
      } catch (e) { console.error(e); ocultarProg(id); toast('❌ ' + e.message); }
    }
    function pintar() {
      const grid = $(id + 'Grid'); grid.innerHTML = '';
      st.thumbs.forEach((thumb, i) => {
        const cell = document.createElement('div');
        cell.className = 'pdf-cell' + (st.sel.has(i) ? ' selected' : '');
        cell.innerHTML = '<div class="pdf-cell-thumb"><img src="' + thumb + '" alt=""></div>' +
          '<div class="pdf-cell-bar"><span class="pdf-cell-num">' + (i + 1) + '</span>' +
          '<span class="pdf-check">' + (st.sel.has(i) ? '✓' : '') + '</span></div>';
        cell.addEventListener('click', () => { if (st.sel.has(i)) st.sel.delete(i); else st.sel.add(i); syncSpec(); pintar(); });
        grid.appendChild(cell);
      });
    }
    function syncSpec() {
      const arr = Array.from(st.sel).sort((a, b) => a - b).map(i => i + 1);
      $(id + 'Spec').value = arr.join(', ');
    }
    $(id + 'Spec').addEventListener('input', () => {
      const idxs = parseRangos($(id + 'Spec').value, st.total);
      st.sel = new Set(idxs); pintar();
    });
    $(id + 'All').addEventListener('click', () => { st.sel = new Set(st.thumbs.map((_, i) => i)); syncSpec(); pintar(); });
    $(id + 'None').addEventListener('click', () => { st.sel.clear(); syncSpec(); pintar(); });
    $(id + 'Run').addEventListener('click', async () => {
      const chosen = Array.from(st.sel).sort((a, b) => a - b);
      let keep;
      if (modo === 'extract') keep = chosen;
      else keep = st.thumbs.map((_, i) => i).filter(i => !st.sel.has(i));
      if (!keep.length) { toast(modo === 'extract' ? 'Selecciona al menos una página.' : 'No puedes eliminar todas las páginas.'); return; }
      $(id + 'Run').disabled = true;
      try {
        const { PDFDocument } = await ensurePdfLib();
        setProg(id, 20, 'Procesando…');
        const src = await abrirConPdfLib(st.bytes);
        const out = await PDFDocument.create();
        const pages = await out.copyPages(src, keep);
        pages.forEach(p => out.addPage(p));
        setProg(id, 92, 'Generando archivo…');
        const blob = new Blob([await out.save()], { type: 'application/pdf' });
        download(blob, baseName(st.name) + (modo === 'extract' ? '-extraido.pdf' : '-editado.pdf'));
        setProg(id, 100, '¡Listo! PDF descargado.');
        toast('✅ Hecho');
      } catch (e) { console.error(e); setProg(id, 0, 'Error: ' + e.message); toast('❌ ' + e.message); }
      finally { $(id + 'Run').disabled = false; }
    });
  }

  // ====================================================================
  // =========================  5. DIVIDIR PDF  ========================
  // ====================================================================
  const split = { bytes: null, total: 0, name: '', mode: 'all' };
  function buildSplit() {
    crearVista('pdfSplit', '🪓', 'Dividir PDF', 'Separa el PDF en varios archivos.',
      '<div class="card">' +
        dropHTML('spl', 'application/pdf', false, 'Sube un PDF', 'Toca o arrastra el PDF a dividir') +
        '<div id="splPanel" style="display:none; margin-top:12px;">' +
          '<div class="field-row"><div class="fr-label">Modo</div>' +
            '<div class="seg" id="splModeSeg">' +
              '<button type="button" class="active" data-m="all">Cada página</button>' +
              '<button type="button" data-m="ranges">Por rangos</button>' +
              '<button type="button" data-m="every">Cada N</button>' +
            '</div></div>' +
          '<div class="field-row" id="splRangesRow" style="display:none;"><div class="fr-label">Rangos' +
            '<small>Cada rango será un PDF. Ej: 1-3, 4-6, 7-10</small></div>' +
            '<input class="pdf-input" id="splRanges" placeholder="1-3, 4-6, 7-10"></div>' +
          '<div class="field-row" id="splEveryRow" style="display:none;"><div class="fr-label">N páginas por archivo</div>' +
            '<input class="pdf-input" id="splEvery" type="number" min="1" value="1"></div>' +
          '<p class="name-hint" id="splInfo" style="margin:6px 2px 0;"></p>' +
          '<button class="btn brand full" id="splRun" style="margin-top:14px;">🪓 Dividir y descargar (.zip)</button>' +
        '</div>' +
      '</div>' + progHTML('spl'));
    wireDrop('spl', fs => cargar(fs[0]));
    $('splModeSeg').querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
      split.mode = b.dataset.m;
      $('splModeSeg').querySelectorAll('button').forEach(x => x.classList.toggle('active', x === b));
      $('splRangesRow').style.display = split.mode === 'ranges' ? '' : 'none';
      $('splEveryRow').style.display = split.mode === 'every' ? '' : 'none';
    }));
    $('splRun').addEventListener('click', runSplit);
    async function cargar(file) {
      if (!file) return;
      try {
        await validarPdf(file);
        const bytes = new Uint8Array(await readAB(file));
        const src = await abrirConPdfLib(bytes);
        split.bytes = bytes; split.total = src.getPageCount(); split.name = file.name;
        $('splPanel').style.display = ''; $('splDrop').style.display = 'none';
        $('splInfo').textContent = 'El PDF tiene ' + split.total + ' páginas.';
      } catch (e) { console.error(e); toast('❌ ' + e.message); }
    }
  }
  async function runSplit() {
    if (!split.bytes) return;
    $('splRun').disabled = true;
    try {
      const { PDFDocument } = await ensurePdfLib();
      const JSZip = await ensureJSZip();
      const zip = new JSZip();
      // Construir grupos de páginas (0-based) según el modo.
      let grupos = [];
      if (split.mode === 'all') {
        for (let i = 0; i < split.total; i++) grupos.push([i]);
      } else if (split.mode === 'ranges') {
        (($('splRanges').value || '').split(',')).forEach(part => {
          const idxs = parseRangos(part, split.total);
          if (idxs.length) grupos.push(idxs);
        });
      } else {
        const n = Math.max(1, parseInt($('splEvery').value, 10) || 1);
        for (let i = 0; i < split.total; i += n) {
          const g = []; for (let j = i; j < Math.min(i + n, split.total); j++) g.push(j); grupos.push(g);
        }
      }
      if (!grupos.length) { toast('Indica al menos un rango válido.'); $('splRun').disabled = false; return; }
      const src = await abrirConPdfLib(split.bytes);
      for (let g = 0; g < grupos.length; g++) {
        setProg('spl', 5 + (g / grupos.length) * 88, 'Parte ' + (g + 1) + '/' + grupos.length + '…');
        const out = await PDFDocument.create();
        const pages = await out.copyPages(src, grupos[g]);
        pages.forEach(p => out.addPage(p));
        const bytes = await out.save();
        const etiqueta = grupos[g].length === 1 ? ('p' + (grupos[g][0] + 1)) : ('p' + (grupos[g][0] + 1) + '-' + (grupos[g][grupos[g].length - 1] + 1));
        zip.file(baseName(split.name) + '_' + etiqueta + '.pdf', bytes);
      }
      setProg('spl', 95, 'Empaquetando .zip…');
      const blob = await zip.generateAsync({ type: 'blob' });
      download(blob, baseName(split.name) + '_dividido.zip');
      setProg('spl', 100, '¡Listo! ' + grupos.length + ' archivos.');
      toast('✅ PDF dividido');
    } catch (e) { console.error(e); setProg('spl', 0, 'Error: ' + e.message); toast('❌ ' + e.message); }
    finally { $('splRun').disabled = false; }
  }

  // ====================================================================
  // ========================  6. COMPRIMIR PDF  =======================
  // Reencode de páginas a imagen JPEG (método open-source fiable en navegador).
  // Ideal para PDF escaneados/con muchas imágenes. Muestra original→final→%.
  // ====================================================================
  const comp = { file: null, level: 'balanced', method: 'auto', token: null };
  function buildCompress() {
    crearVista('pdfCompress', '🗜️', 'Comprimir PDF', 'Reduce el peso del PDF conservando la mejor calidad posible.',
      '<div class="card">' +
        dropHTML('cmp', 'application/pdf', false, 'Sube un PDF', 'Toca o arrastra el PDF a comprimir') +
        '<div id="cmpPanel" style="display:none; margin-top:12px;">' +
          '<div class="field-row"><div class="fr-label">Método<small>Cómo comprimir</small></div>' +
            '<div class="seg" id="cmpMethodSeg">' +
              '<button type="button" class="active" data-m="auto">Automático</button>' +
              '<button type="button" data-m="text">Conservar texto</button>' +
              '<button type="button" data-m="raster">Rasterizar</button>' +
            '</div></div>' +
          '<div class="field-row" id="cmpLvlRow"><div class="fr-label">Nivel<small>Calidad vs. tamaño</small></div>' +
            '<div class="seg" id="cmpLvlSeg">' +
              '<button type="button" data-l="low">Baja</button>' +
              '<button type="button" class="active" data-l="balanced">Media</button>' +
              '<button type="button" data-l="high">Alta</button>' +
            '</div></div>' +
          '<p class="name-hint" style="margin:6px 2px 0;"><b>Automático:</b> detecta si el PDF es de texto y lo comprime <b>sin perder nitidez ni el texto seleccionable</b>; si es escaneado, rasteriza. <b>Conservar texto:</b> nunca rasteriza (mantiene el texto vectorial). <b>Rasterizar:</b> convierte cada página a imagen (máxima reducción en escaneos). El Nivel solo aplica al rasterizar.</p>' +
          '<div class="pdf-stats" id="cmpStats" style="display:none;"></div>' +
          '<button class="btn brand full" id="cmpRun" style="margin-top:14px;">🗜️ Comprimir</button>' +
          '<a class="btn primary full" id="cmpDl" style="display:none; margin-top:10px;">⬇ Descargar comprimido</a>' +
        '</div>' +
      '</div>' + progHTML('cmp'));
    wireDrop('cmp', fs => cargar(fs[0]));
    $('cmpLvlSeg').querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
      comp.level = b.dataset.l; $('cmpLvlSeg').querySelectorAll('button').forEach(x => x.classList.toggle('active', x === b));
    }));
    $('cmpMethodSeg').querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
      comp.method = b.dataset.m; $('cmpMethodSeg').querySelectorAll('button').forEach(x => x.classList.toggle('active', x === b));
      $('cmpLvlRow').style.display = comp.method === 'text' ? 'none' : '';
    }));
    $('cmpRun').addEventListener('click', runCompress);
    $('cmpCancel').addEventListener('click', () => { if (comp.token) comp.token.cancelado = true; });
    async function cargar(file) {
      if (!file) return;
      try { await validarPdf(file); comp.file = file; $('cmpPanel').style.display = ''; $('cmpDrop').style.display = 'none';
        $('cmpStats').style.display = 'none'; $('cmpDl').style.display = 'none'; }
      catch (e) { toast('❌ ' + e.message); }
    }
  }
  // ¿El PDF tiene texto digital? Muestrea algunas páginas con pdf.js.
  async function detectarTextoPdf(pdf) {
    const total = pdf.numPages;
    const muestras = Math.min(total, 5);
    let chars = 0;
    for (let k = 0; k < muestras; k++) {
      const num = 1 + Math.floor(k * (total - 1) / Math.max(1, muestras - 1));
      const tc = await (await pdf.getPage(num)).getTextContent();
      chars += (tc.items || []).reduce((a, it) => a + ((it.str || '').trim().length), 0);
    }
    return chars / muestras; // caracteres promedio por página muestreada
  }
  // Compresión que CONSERVA el texto vectorial: re-guarda con object streams
  // (sin rasterizar). Reducción modesta pero mantiene texto seleccionable.
  async function comprimirTexto(bytes) {
    const doc = await abrirConPdfLib(bytes);
    const out = await doc.save({ useObjectStreams: true });
    return new Blob([out], { type: 'application/pdf' });
  }
  // Compresión por rasterizado (cada página → imagen JPEG).
  async function comprimirRaster(bytes, cfg, prog) {
    const { PDFDocument } = await ensurePdfLib();
    const pdf = await abrirConPdfjs(bytes);
    const out = await PDFDocument.create();
    const total = pdf.numPages;
    for (let i = 1; i <= total; i++) {
      if (comp.token && comp.token.cancelado) throw new Error('Cancelado por el usuario.');
      if (prog) prog(i, total);
      const page = await pdf.getPage(i);
      const base = page.getViewport({ scale: 1 });
      const scale = Math.min(3, Math.max(0.3, cfg.w / base.width));
      const vp = page.getViewport({ scale });
      const c = document.createElement('canvas');
      c.width = Math.ceil(vp.width); c.height = Math.ceil(vp.height);
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
      await page.render({ canvasContext: ctx, viewport: vp }).promise;
      const jpg = await new Promise(r => c.toBlob(r, 'image/jpeg', cfg.q));
      const img = await out.embedJpg(new Uint8Array(await jpg.arrayBuffer()));
      const p = out.addPage([c.width, c.height]);
      p.drawImage(img, { x: 0, y: 0, width: c.width, height: c.height });
      c.width = c.height = 0;
    }
    return new Blob([await out.save()], { type: 'application/pdf' });
  }
  async function runCompress() {
    if (!comp.file) return;
    const cfg = { low: { w: 2000, q: 0.82 }, balanced: { w: 1500, q: 0.68 }, high: { w: 1100, q: 0.55 } }[comp.level];
    comp.token = nuevoToken();
    $('cmpRun').disabled = true; $('cmpDl').style.display = 'none';
    try {
      await ensurePdfLib();
      const bytes = new Uint8Array(await readAB(comp.file));
      let blob, modoUsado;
      const rasterProg = (i, total) => setProg('cmp', 3 + (i / total) * 88, 'Rasterizando página ' + i + '/' + total + '…', true);

      if (comp.method === 'text') {
        setProg('cmp', 20, 'Optimizando sin rasterizar…', true);
        blob = await comprimirTexto(bytes); modoUsado = 'texto';
      } else if (comp.method === 'raster') {
        blob = await comprimirRaster(bytes, cfg, rasterProg); modoUsado = 'raster';
      } else {
        // Automático: detectar texto para decidir.
        setProg('cmp', 8, 'Analizando el PDF…', true);
        const pdf = await abrirConPdfjs(bytes);
        const avg = await detectarTextoPdf(pdf);
        const esTexto = avg > 80; // ~80+ caracteres por página → PDF de texto
        if (esTexto) {
          setProg('cmp', 30, 'Optimizando sin rasterizar (conserva texto)…', true);
          const t = await comprimirTexto(bytes);
          if (t.size < comp.file.size * 0.97) { blob = t; modoUsado = 'texto'; }
          else {
            // No ayudó lo suficiente: rasterizar y quedarnos con el más chico.
            const r = await comprimirRaster(bytes, cfg, rasterProg);
            if (r.size < t.size) { blob = r; modoUsado = 'raster'; } else { blob = t; modoUsado = 'texto'; }
          }
        } else {
          blob = await comprimirRaster(bytes, cfg, rasterProg); modoUsado = 'raster';
        }
      }

      setProg('cmp', 96, 'Generando archivo…', false);
      const orig = comp.file.size, fin = blob.size;
      const pct = Math.round((1 - fin / orig) * 100);
      $('cmpStats').style.display = '';
      $('cmpStats').innerHTML =
        '<div class="pdf-stat"><span>Original</span><b>' + kb(orig) + '</b></div>' +
        '<div class="pdf-stat"><span>Final</span><b>' + kb(fin) + '</b></div>' +
        '<div class="pdf-stat"><span>Reducción</span><b class="' + (pct > 0 ? 'good' : 'bad') + '">' + (pct >= 0 ? '↓' + pct + '%' : '↑' + Math.abs(pct) + '%') + '</b></div>';
      const dl = $('cmpDl');
      dl.href = URL.createObjectURL(blob); dl.download = baseName(comp.file.name) + '-comprimido.pdf';
      dl.style.display = '';
      const etq = modoUsado === 'texto' ? ' (texto conservado)' : ' (rasterizado)';
      setProg('cmp', 100, '¡Listo!' + etq, false);
      if (pct <= 0) toast(modoUsado === 'texto'
        ? 'Este PDF ya estaba optimizado. Para reducir más, usa «Rasterizar».'
        : 'Ya estaba optimizado; prueba el nivel Alta.');
      else toast('✅ Comprimido ' + pct + '%' + etq);
    } catch (e) {
      console.error(e); setProg('cmp', 0, 'Error: ' + e.message, false);
      if (!/Cancelado/.test(e.message)) toast('❌ ' + e.message); else toast('Operación cancelada');
    } finally { $('cmpRun').disabled = false; }
  }

  // ====================================================================
  // =======================  7. IMÁGENES A PDF  =======================
  // ====================================================================
  const i2p = { imgs: [] };
  function buildImg2Pdf() {
    crearVista('pdfImg2Pdf', '🖼️', 'Imágenes a PDF', 'Convierte JPG, PNG o WebP en un PDF.',
      '<div class="card">' +
        dropHTML('i2p', 'image/png,image/jpeg,image/webp,image/*', true, 'Sube tus imágenes', 'Toca o arrastra JPG, PNG o WebP') +
        '<div class="field-row" style="margin-top:12px;"><div class="fr-label">Tamaño de página</div>' +
          '<div class="seg" id="i2pFitSeg"><button type="button" class="active" data-f="img">Según imagen</button>' +
          '<button type="button" data-f="a4">A4 vertical</button></div></div>' +
        '<div class="pdf-list" id="i2pList" style="margin-top:12px;"></div>' +
        '<button class="btn brand full" id="i2pRun" style="margin-top:14px;" disabled>🖼️ Crear PDF</button>' +
      '</div>' + progHTML('i2p'));
    wireDrop('i2p', addImgs);
    let fit = 'img';
    $('i2pFitSeg').querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
      fit = b.dataset.f; $('i2pFitSeg').querySelectorAll('button').forEach(x => x.classList.toggle('active', x === b));
    }));
    $('i2pRun').addEventListener('click', () => runImg2Pdf(fit));
    function addImgs(files) {
      files.forEach(f => { if (esImagen(f)) i2p.imgs.push({ file: f, key: f.name + Math.random(), url: URL.createObjectURL(f) }); else toast('«' + f.name + '» no es imagen.'); });
      render();
    }
    function render() {
      const items = i2p.imgs.map(x => ({ key: x.key, thumb: x.url, label: x.file.name, sub: kb(x.file.size) }));
      pintarListaReordenable($('i2pList'), items, {
        onReorder: () => { i2p.imgs = items.map(i => i2p.imgs.find(f => f.key === i.key)); render(); }
      });
      $('i2pRun').disabled = !i2p.imgs.length;
    }
  }
  // Decodifica una imagen (cualquier formato) a bytes JPEG/PNG vía canvas.
  async function imagenABytes(file) {
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('No se pudo leer una imagen.')); i.src = url; });
      const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight;
      const ctx = c.getContext('2d');
      const png = /png$/i.test(file.type) || /\.png$/i.test(file.name);
      if (!png) { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height); }
      ctx.drawImage(img, 0, 0);
      const mime = png ? 'image/png' : 'image/jpeg';
      const blob = await new Promise(r => c.toBlob(r, mime, 0.92));
      return { bytes: new Uint8Array(await blob.arrayBuffer()), png, w: c.width, h: c.height };
    } finally { URL.revokeObjectURL(url); }
  }
  async function runImg2Pdf(fit) {
    if (!i2p.imgs.length) return;
    $('i2pRun').disabled = true;
    try {
      const { PDFDocument } = await ensurePdfLib();
      const out = await PDFDocument.create();
      for (let i = 0; i < i2p.imgs.length; i++) {
        setProg('i2p', 5 + (i / i2p.imgs.length) * 88, 'Imagen ' + (i + 1) + '/' + i2p.imgs.length + '…');
        const d = await imagenABytes(i2p.imgs[i].file);
        const emb = d.png ? await out.embedPng(d.bytes) : await out.embedJpg(d.bytes);
        if (fit === 'a4') {
          const A4W = 595.28, A4H = 841.89, M = 20;
          const page = out.addPage([A4W, A4H]);
          const s = Math.min((A4W - 2 * M) / d.w, (A4H - 2 * M) / d.h);
          const w = d.w * s, h = d.h * s;
          page.drawImage(emb, { x: (A4W - w) / 2, y: (A4H - h) / 2, width: w, height: h });
        } else {
          const page = out.addPage([d.w, d.h]);
          page.drawImage(emb, { x: 0, y: 0, width: d.w, height: d.h });
        }
      }
      setProg('i2p', 96, 'Generando archivo…');
      const blob = new Blob([await out.save()], { type: 'application/pdf' });
      download(blob, 'imagenes.pdf');
      setProg('i2p', 100, '¡Listo! PDF descargado.');
      toast('✅ PDF creado');
    } catch (e) { console.error(e); setProg('i2p', 0, 'Error: ' + e.message); toast('❌ ' + e.message); }
    finally { $('i2pRun').disabled = false; }
  }

  // ====================================================================
  // =======================  8. PDF A IMÁGENES  =======================
  // ====================================================================
  const p2i = { file: null, fmt: 'jpeg', scale: 2, token: null };
  function buildPdf2Img() {
    crearVista('pdfPdf2Img', '📸', 'PDF a imágenes', 'Exporta las páginas del PDF como imágenes.',
      '<div class="card">' +
        dropHTML('p2i', 'application/pdf', false, 'Sube un PDF', 'Toca o arrastra el PDF') +
        '<div id="p2iPanel" style="display:none; margin-top:12px;">' +
          '<div class="field-row"><div class="fr-label">Formato</div>' +
            '<div class="seg" id="p2iFmtSeg"><button type="button" class="active" data-f="jpeg">JPG</button>' +
            '<button type="button" data-f="png">PNG</button><button type="button" data-f="webp">WebP</button></div></div>' +
          '<div class="field-row"><div class="fr-label">Resolución</div>' +
            '<div class="seg" id="p2iResSeg"><button type="button" data-r="1">Normal</button>' +
            '<button type="button" class="active" data-r="2">Alta</button><button type="button" data-r="3">Máxima</button></div></div>' +
          '<button class="btn brand full" id="p2iRun" style="margin-top:14px;">📸 Convertir todas (.zip)</button>' +
          '<div class="pdf-thumbs" id="p2iThumbs"></div>' +
        '</div>' +
      '</div>' + progHTML('p2i'));
    wireDrop('p2i', fs => cargar(fs[0]));
    $('p2iFmtSeg').querySelectorAll('button').forEach(b => b.addEventListener('click', () => { p2i.fmt = b.dataset.f; $('p2iFmtSeg').querySelectorAll('button').forEach(x => x.classList.toggle('active', x === b)); }));
    $('p2iResSeg').querySelectorAll('button').forEach(b => b.addEventListener('click', () => { p2i.scale = +b.dataset.r; $('p2iResSeg').querySelectorAll('button').forEach(x => x.classList.toggle('active', x === b)); }));
    $('p2iRun').addEventListener('click', runPdf2ImgAll);
    $('p2iCancel').addEventListener('click', () => { if (p2i.token) p2i.token.cancelado = true; });
    async function cargar(file) {
      if (!file) return;
      try { await validarPdf(file); p2i.file = file; $('p2iPanel').style.display = ''; $('p2iDrop').style.display = 'none'; $('p2iThumbs').innerHTML = ''; }
      catch (e) { toast('❌ ' + e.message); }
    }
  }
  function mimeDe(fmt) { return fmt === 'png' ? 'image/png' : fmt === 'webp' ? 'image/webp' : 'image/jpeg'; }
  function extDe(fmt) { return fmt === 'jpeg' ? 'jpg' : fmt; }
  async function runPdf2ImgAll() {
    if (!p2i.file) return;
    p2i.token = nuevoToken(); $('p2iRun').disabled = true;
    try {
      const JSZip = await ensureJSZip();
      const bytes = new Uint8Array(await readAB(p2i.file));
      const pdf = await abrirConPdfjs(bytes);
      const zip = new JSZip();
      const total = pdf.numPages;
      const mime = mimeDe(p2i.fmt), q = p2i.fmt === 'png' ? undefined : 0.9;
      const thumbs = $('p2iThumbs'); thumbs.innerHTML = '';
      for (let i = 1; i <= total; i++) {
        if (p2i.token.cancelado) throw new Error('Cancelado por el usuario.');
        setProg('p2i', 3 + (i / total) * 90, 'Página ' + i + '/' + total + '…', true);
        const page = await pdf.getPage(i);
        const vp = page.getViewport({ scale: p2i.scale });
        const c = document.createElement('canvas'); c.width = Math.ceil(vp.width); c.height = Math.ceil(vp.height);
        const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
        await page.render({ canvasContext: ctx, viewport: vp }).promise;
        let blob = await new Promise(r => c.toBlob(r, mime, q));
        if (!blob) blob = await new Promise(r => c.toBlob(r, 'image/png')); // WebP no soportado → PNG
        zip.file(baseName(p2i.file.name) + '_p' + i + '.' + extDe(p2i.fmt), blob);
        // Miniatura + descarga individual
        if (i <= 60) {
          const thumbUrl = URL.createObjectURL(blob);
          const cell = document.createElement('div'); cell.className = 'pdf-cell';
          cell.innerHTML = '<div class="pdf-cell-thumb"><img src="' + thumbUrl + '" alt=""></div><div class="pdf-cell-bar"><span class="pdf-cell-num">' + i + '</span><button class="pdf-mini" title="Descargar">⬇</button></div>';
          cell.querySelector('button').addEventListener('click', () => download(blob, baseName(p2i.file.name) + '_p' + i + '.' + extDe(p2i.fmt)));
          thumbs.appendChild(cell);
        }
        c.width = c.height = 0;
      }
      setProg('p2i', 96, 'Empaquetando .zip…', false);
      const blob = await zip.generateAsync({ type: 'blob' });
      download(blob, baseName(p2i.file.name) + '_imagenes.zip');
      setProg('p2i', 100, '¡Listo! ' + total + ' imágenes.', false);
      toast('✅ Convertido (toca una miniatura ⬇ para bajar una sola)');
    } catch (e) {
      console.error(e); setProg('p2i', 0, 'Error: ' + e.message, false);
      if (!/Cancelado/.test(e.message)) toast('❌ ' + e.message); else toast('Operación cancelada');
    } finally { $('p2iRun').disabled = false; }
  }

  // ====================================================================
  // =========================  9. PDF A WORD  =========================
  // Extrae texto digital con pdf.js; si el PDF es escaneado, usa OCR. Arma un
  // DOCX (OOXML) con JSZip. No promete diseño idéntico en documentos complejos.
  // ====================================================================
  const p2w = { file: null, token: null, mode: 'fiel', lang: 'spa+eng' };
  function buildPdf2Word() {
    crearVista('pdfPdf2Word', '📝', 'PDF a Word', 'Genera un DOCX editable respetando el diseño original.',
      '<div class="card">' +
        dropHTML('p2w', 'application/pdf', false, 'Sube un PDF', 'Toca o arrastra el PDF') +
        '<div id="p2wPanel" style="display:none; margin-top:12px;">' +
          '<div class="field-row"><div class="fr-label">Modo<small>Cómo reconstruir el documento</small></div>' +
            '<div class="seg" id="p2wModeSeg"><button type="button" class="active" data-m="fiel">Diseño fiel</button>' +
            '<button type="button" data-m="simple">Texto simple</button></div></div>' +
          '<div class="field-row"><div class="fr-label">Idioma (OCR)<small>Para PDF escaneados</small></div>' +
            '<div class="seg" id="p2wLangSeg"><button type="button" class="active" data-l="spa+eng">ES + EN</button>' +
            '<button type="button" data-l="spa">Español</button><button type="button" data-l="eng">English</button></div></div>' +
          '<div class="field-row" id="p2wImgRow" style="display:none;"><div class="fr-label">Incluir imágenes de página<small>Incrusta cada página como imagen</small></div>' +
            '<label class="switch"><input type="checkbox" id="p2wImg"><span class="track"></span></label></div>' +
          '<p class="name-hint" style="margin:6px 2px 0;"><b>Diseño fiel (recomendado):</b> reconstruye cada página con la imagen original de fondo (conserva <b>firmas, sellos, logos y el diseño exacto</b>) y coloca el texto <b>editable en su posición, tamaño y color reales</b> encima. <b>Texto simple:</b> extrae el texto en párrafos (reflujo), útil si solo quieres editar el contenido.</p>' +
          '<p class="name-hint" style="margin:6px 2px 0; opacity:.85;">Nota: la fuente se aproxima a una equivalente (Arial/Times/Courier). El diseño fiel mantiene ubicación y aspecto; documentos con tablas o columnas muy complejas pueden requerir ajustes menores.</p>' +
          '<button class="btn brand full" id="p2wRun" style="margin-top:14px;">📝 Convertir a Word (.docx)</button>' +
          '<a class="btn primary full" id="p2wDl" style="display:none; margin-top:10px;">⬇ Descargar .docx</a>' +
        '</div>' +
      '</div>' + progHTML('p2w'));
    wireDrop('p2w', fs => cargar(fs[0]));
    $('p2wModeSeg').querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
      p2w.mode = b.dataset.m; $('p2wModeSeg').querySelectorAll('button').forEach(x => x.classList.toggle('active', x === b));
      $('p2wImgRow').style.display = p2w.mode === 'simple' ? '' : 'none';
    }));
    $('p2wLangSeg').querySelectorAll('button').forEach(b => b.addEventListener('click', () => { p2w.lang = b.dataset.l; $('p2wLangSeg').querySelectorAll('button').forEach(x => x.classList.toggle('active', x === b)); }));
    $('p2wRun').addEventListener('click', () => runPdf2Word(p2w.lang));
    $('p2wCancel').addEventListener('click', () => { if (p2w.token) p2w.token.cancelado = true; });
    async function cargar(file) {
      if (!file) return;
      try { await validarPdf(file); p2w.file = file; $('p2wPanel').style.display = ''; $('p2wDrop').style.display = 'none'; $('p2wDl').style.display = 'none'; }
      catch (e) { toast('❌ ' + e.message); }
    }
  }
  // Convierte los items de texto de una página en párrafos (agrupando por línea).
  function itemsAParrafos(textContent) {
    const items = (textContent.items || []).filter(it => it.str != null);
    if (!items.length) return [];
    // Agrupar por coordenada Y (línea), luego ordenar por X.
    const lineas = [];
    items.forEach(it => {
      const y = Math.round(it.transform[5]);
      const h = Math.abs(it.transform[3]) || Math.abs(it.transform[0]) || 10;
      let linea = lineas.find(l => Math.abs(l.y - y) <= Math.max(3, h * 0.5));
      if (!linea) { linea = { y, h, parts: [] }; lineas.push(linea); }
      linea.parts.push({ x: it.transform[4], s: it.str });
    });
    lineas.sort((a, b) => b.y - a.y); // de arriba a abajo
    const alturas = lineas.map(l => l.h).sort((a, b) => a - b);
    const hMed = alturas[Math.floor(alturas.length / 2)] || 10;
    return lineas.map(l => {
      l.parts.sort((a, b) => a.x - b.x);
      const text = l.parts.map(p => p.s).join('').replace(/\s+/g, ' ').trim();
      return { text, heading: l.h > hMed * 1.35 && text.length < 120 };
    }).filter(p => p.text.length);
  }
  // Construye un .docx válido a partir de bloques:
  //  {type:'p', text, heading?} | {type:'img', bytes, w, h, ext} | {type:'pagebreak'}
  async function construirDocx(bloques) {
    const JSZip = await ensureJSZip();
    const zip = new JSZip();
    const media = [];   // {name, bytes}
    const rels = [];    // {id, target}
    const exts = new Set();
    let imgN = 0, drawId = 1000;

    function imgXml(b) {
      imgN++;
      const ext = (b.ext || 'png').toLowerCase();
      exts.add(ext);
      const name = 'image' + imgN + '.' + ext;
      media.push({ name, bytes: b.bytes });
      const rid = 'rIdImg' + imgN;
      rels.push({ id: rid, target: 'media/' + name });
      const MAXW = 5486400; // ~6 pulgadas de ancho útil (EMU)
      let cx = Math.max(1, Math.round((b.w || 600) * 9525));
      let cy = Math.max(1, Math.round((b.h || 800) * 9525));
      if (cx > MAXW) { const k = MAXW / cx; cx = Math.round(cx * k); cy = Math.round(cy * k); }
      const did = drawId++;
      return '<w:p><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">' +
        '<wp:extent cx="' + cx + '" cy="' + cy + '"/><wp:docPr id="' + did + '" name="Imagen ' + did + '"/>' +
        '<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
        '<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="' + did + '" name="Imagen ' + did + '"/><pic:cNvPicPr/></pic:nvPicPr>' +
        '<pic:blipFill><a:blip r:embed="' + rid + '"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>' +
        '<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="' + cx + '" cy="' + cy + '"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>' +
        '</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>';
    }

    const body = bloques.map(b => {
      if (b.type === 'pagebreak') return '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
      if (b.type === 'img') return imgXml(b);
      if (b.heading)
        return '<w:p><w:pPr><w:spacing w:before="200" w:after="80"/></w:pPr><w:r><w:rPr><w:b/><w:sz w:val="30"/></w:rPr><w:t xml:space="preserve">' + esc(b.text) + '</w:t></w:r></w:p>';
      return '<w:p><w:r><w:t xml:space="preserve">' + esc(b.text) + '</w:t></w:r></w:p>';
    }).join('');

    const documentXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
      'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ' +
      'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing">' +
      '<w:body>' + body + '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134"/></w:sectPr></w:body></w:document>';

    let defaults = '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>';
    if (exts.has('png')) defaults += '<Default Extension="png" ContentType="image/png"/>';
    if (exts.has('jpg')) defaults += '<Default Extension="jpg" ContentType="image/jpeg"/>';
    if (exts.has('jpeg')) defaults += '<Default Extension="jpeg" ContentType="image/jpeg"/>';
    zip.file('[Content_Types].xml',
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' + defaults +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
      '</Types>');
    zip.folder('_rels').file('.rels',
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
      '</Relationships>');
    const wf = zip.folder('word');
    wf.file('document.xml', documentXml);
    if (rels.length) {
      wf.folder('_rels').file('document.xml.rels',
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        rels.map(r => '<Relationship Id="' + r.id + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="' + r.target + '"/>').join('') +
        '</Relationships>');
      const mf = wf.folder('media');
      media.forEach(m => mf.file(m.name, m.bytes));
    }
    return zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
  }

  // Renderiza una página a imagen JPEG para incrustar en el DOCX.
  async function paginaComoImagen(pdf, num, targetW) {
    const c = await renderPagina(pdf, num, targetW);
    const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.72));
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const w = c.width, h = c.height; c.width = c.height = 0;
    return { type: 'img', bytes, w, h, ext: 'jpg' };
  }

  // -------------------- Modo "Diseño fiel" (overlay) --------------------
  const hex2 = n => ('0' + Math.max(0, Math.min(255, n | 0)).toString(16)).slice(-2);
  function famDe(styles, fontName) {
    const ff = ((styles && styles[fontName] && styles[fontName].fontFamily) || '') + ' ' + (fontName || '');
    if (/serif/i.test(ff) && !/sans/i.test(ff)) return 'Times New Roman';
    if (/mono|courier|consol/i.test(ff)) return 'Courier New';
    return 'Arial';
  }
  // Color de texto = píxel más oscuro dentro de la caja (en el canvas renderizado).
  function colorTexto(data, W, H, px0, py0, px1, py1) {
    let best = 999, br = 0, bg = 0, bb = 0;
    const xa = Math.max(0, px0 | 0), xb = Math.min(W - 1, px1 | 0);
    const ya = Math.max(0, py0 | 0), yb = Math.min(H - 1, py1 | 0);
    for (let y = ya; y <= yb; y += 2) for (let x = xa; x <= xb; x += 2) {
      const o = (y * W + x) * 4;
      const lum = 0.299 * data[o] + 0.587 * data[o + 1] + 0.114 * data[o + 2];
      if (lum < best) { best = lum; br = data[o]; bg = data[o + 1]; bb = data[o + 2]; }
    }
    if (best > 190) return '000000'; // no se detectó tinta clara → negro por defecto
    return hex2(br) + hex2(bg) + hex2(bb);
  }
  // Extrae palabras con bbox del resultado de tesseract (v5: blocks anidados).
  function palabrasOCR(data) {
    const words = [];
    (data.blocks || []).forEach(b => (b.paragraphs || []).forEach(p =>
      (p.lines || []).forEach(l => (l.words || []).forEach(w => {
        if (w.text && w.text.trim() && w.bbox) words.push({ text: w.text, bbox: w.bbox });
      }))));
    if (!words.length && Array.isArray(data.words)) data.words.forEach(w => { if (w.text && w.text.trim() && w.bbox) words.push({ text: w.text, bbox: w.bbox }); });
    return words;
  }
  // Construye las "cajas" de texto de una página con texto digital.
  async function cajasDigital(pdf, num) {
    const page = await pdf.getPage(num);
    const vp1 = page.getViewport({ scale: 1 });
    const Wpt = vp1.width, Hpt = vp1.height;
    const S = Math.min(2.5, Math.max(1, 1500 / Wpt));
    const vp = page.getViewport({ scale: S });
    const c = document.createElement('canvas'); c.width = Math.ceil(vp.width); c.height = Math.ceil(vp.height);
    const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
    const data = ctx.getImageData(0, 0, c.width, c.height).data; const CW = c.width, CH = c.height;
    const tc = await page.getTextContent();
    const styles = tc.styles || {};
    const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.72));
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const cajas = [];
    (tc.items || []).forEach(it => {
      const s = it.str || ''; if (!s.trim()) return;
      const size = it.height || Math.hypot(it.transform[2], it.transform[3]) || 10;
      const x = it.transform[4], yb = it.transform[5];
      const wpt = it.width || s.length * size * 0.5;
      const topPt = Hpt - (yb + size * 0.8);
      const px0 = x * S, px1 = (x + wpt) * S;
      const py0 = (Hpt - (yb + size * 0.9)) * S, py1 = (Hpt - (yb - size * 0.2)) * S;
      const color = colorTexto(data, CW, CH, px0, py0, px1, py1);
      const bold = /bold|black|heavy/i.test(((styles[it.fontName] && styles[it.fontName].fontFamily) || '') + ' ' + (it.fontName || ''));
      cajas.push({ xPt: x, yPt: Math.max(0, topPt), wPt: wpt + 2, hPt: size * 1.3, sizePt: size, family: famDe(styles, it.fontName), bold, color, fill: 'FFFFFF', text: s });
    });
    c.width = c.height = 0;
    return { wPt: Wpt, hPt: Hpt, bytes, cajas };
  }
  // Cajas de una página escaneada usando OCR (posición por palabra).
  async function cajasOCR(pdf, num, worker) {
    const page = await pdf.getPage(num);
    const vp1 = page.getViewport({ scale: 1 });
    const Wpt = vp1.width, Hpt = vp1.height;
    const S = Math.min(3, Math.max(1.5, 2000 / Wpt));
    const vp = page.getViewport({ scale: S });
    const c = document.createElement('canvas'); c.width = Math.ceil(vp.width); c.height = Math.ceil(vp.height);
    const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
    const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.72));
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const { data } = await worker.recognize(c, {}, { blocks: true });
    const cajas = palabrasOCR(data).map(w => {
      const b = w.bbox, h = (b.y1 - b.y0);
      return { xPt: b.x0 / S, yPt: b.y0 / S, wPt: (b.x1 - b.x0) / S + 1, hPt: h / S, sizePt: (h / S) * 0.8, family: 'Arial', bold: false, color: '000000', fill: 'FFFFFF', text: w.text };
    });
    c.width = c.height = 0;
    return { wPt: Wpt, hPt: Hpt, bytes, cajas };
  }
  // Construye un DOCX que reproduce el diseño: imagen de página al fondo +
  // texto editable posicionado (frames absolutos anclados a la página).
  async function construirDocxFiel(paginas) {
    const JSZip = await ensureJSZip();
    const zip = new JSZip();
    const media = []; const rels = []; let imgN = 0, drawId = 3000;
    const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
      'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ' +
      'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"';
    function bgImg(pg) {
      imgN++; const name = 'image' + imgN + '.jpg'; media.push({ name, bytes: pg.bytes });
      const rid = 'rIdImg' + imgN; rels.push({ id: rid, target: 'media/' + name });
      const cx = Math.round(pg.wPt * 12700), cy = Math.round(pg.hPt * 12700); const did = drawId++;
      return '<w:r><w:drawing><wp:anchor behindDoc="1" allowOverlap="1" layoutInCell="1" locked="0" relativeHeight="0" simplePos="0" distT="0" distB="0" distL="0" distR="0">' +
        '<wp:simplePos x="0" y="0"/>' +
        '<wp:positionH relativeFrom="page"><wp:posOffset>0</wp:posOffset></wp:positionH>' +
        '<wp:positionV relativeFrom="page"><wp:posOffset>0</wp:posOffset></wp:positionV>' +
        '<wp:extent cx="' + cx + '" cy="' + cy + '"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:wrapNone/>' +
        '<wp:docPr id="' + did + '" name="Fondo ' + did + '"/><wp:cNvGraphicFramePr/>' +
        '<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
        '<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="' + did + '" name="Fondo"/><pic:cNvPicPr/></pic:nvPicPr>' +
        '<pic:blipFill><a:blip r:embed="' + rid + '"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>' +
        '<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="' + cx + '" cy="' + cy + '"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>' +
        '</pic:pic></a:graphicData></a:graphic></wp:anchor></w:drawing></w:r>';
    }
    function frame(c) {
      const wTw = Math.max(60, Math.round(c.wPt * 20)), hTw = Math.max(60, Math.round(c.hPt * 20));
      const xTw = Math.max(0, Math.round(c.xPt * 20)), yTw = Math.max(0, Math.round(c.yPt * 20));
      const sz = Math.max(6, Math.round(c.sizePt * 2));
      const fam = esc(c.family || 'Arial');
      return '<w:p><w:pPr>' +
        '<w:framePr w:w="' + wTw + '" w:h="' + hTw + '" w:hRule="exact" w:wrap="none" w:vAnchor="page" w:hAnchor="page" w:x="' + xTw + '" w:y="' + yTw + '"/>' +
        '<w:shd w:val="clear" w:color="auto" w:fill="' + (c.fill || 'FFFFFF') + '"/>' +
        '<w:spacing w:after="0" w:line="240" w:lineRule="auto"/><w:rPr><w:sz w:val="' + sz + '"/></w:rPr></w:pPr>' +
        '<w:r><w:rPr><w:rFonts w:ascii="' + fam + '" w:hAnsi="' + fam + '"/>' + (c.bold ? '<w:b/>' : '') +
        '<w:color w:val="' + (c.color || '000000') + '"/><w:sz w:val="' + sz + '"/></w:rPr>' +
        '<w:t xml:space="preserve">' + esc(c.text) + '</w:t></w:r></w:p>';
    }
    const partes = paginas.map((pg, idx) => {
      let s = idx > 0 ? '<w:p><w:r><w:br w:type="page"/></w:r></w:p>' : '';
      s += '<w:p><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr>' + bgImg(pg) + '</w:p>';
      pg.cajas.forEach(c => { s += frame(c); });
      return s;
    }).join('');
    const p0 = paginas[0] || { wPt: 595, hPt: 842 };
    const pgW = Math.round(p0.wPt * 20), pgH = Math.round(p0.hPt * 20);
    const documentXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<w:document ' + NS + '><w:body>' + partes +
      '<w:sectPr><w:pgSz w:w="' + pgW + '" w:h="' + pgH + '"/><w:pgMar w:top="0" w:right="0" w:bottom="0" w:left="0" w:header="0" w:footer="0" w:gutter="0"/></w:sectPr></w:body></w:document>';
    zip.file('[Content_Types].xml',
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Default Extension="jpg" ContentType="image/jpeg"/>' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
    zip.folder('_rels').file('.rels',
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
    const wf = zip.folder('word');
    wf.file('document.xml', documentXml);
    wf.folder('_rels').file('document.xml.rels',
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      rels.map(r => '<Relationship Id="' + r.id + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="' + r.target + '"/>').join('') +
      '</Relationships>');
    const mf = wf.folder('media');
    media.forEach(m => mf.file(m.name, m.bytes));
    return zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
  }
  async function runPdf2Word(lang) {
    if (!p2w.file) return;
    p2w.token = nuevoToken(); $('p2wRun').disabled = true; $('p2wDl').style.display = 'none';
    let worker = null;
    try {
      const bytes = new Uint8Array(await readAB(p2w.file));
      const pdf = await abrirConPdfjs(bytes);
      const total = pdf.numPages;
      // Detectar si el PDF trae texto digital (muestreo).
      setProg('p2w', 5, 'Analizando el documento…', true);
      const avg = await detectarTextoPdf(pdf);
      const escaneado = avg < 20;
      let blob, etq;

      if (p2w.mode === 'fiel') {
        // ---- Diseño fiel: imagen de fondo + texto posicionado editable ----
        if (escaneado) { const T = await ensureTesseract(); worker = await T.createWorker(lang, 1); }
        const paginas = [];
        for (let i = 1; i <= total; i++) {
          if (p2w.token.cancelado) throw new Error('Cancelado por el usuario.');
          setProg('p2w', 8 + (i / total) * 86, (escaneado ? 'OCR + diseño' : 'Reconstruyendo') + ' página ' + i + '/' + total + '…', true);
          paginas.push(escaneado ? await cajasOCR(pdf, i, worker) : await cajasDigital(pdf, i));
        }
        if (worker) { await worker.terminate(); worker = null; }
        setProg('p2w', 96, 'Generando .docx…', false);
        blob = await construirDocxFiel(paginas);
        etq = escaneado ? '(diseño fiel · OCR)' : '(diseño fiel)';
      } else {
        // ---- Texto simple: reflujo de párrafos (+ imágenes opcionales) ----
        const incluirImg = $('p2wImg') && $('p2wImg').checked;
        if (escaneado) { const T = await ensureTesseract(); worker = await T.createWorker(lang, 1); }
        const bloques = [];
        for (let i = 1; i <= total; i++) {
          if (p2w.token.cancelado) throw new Error('Cancelado por el usuario.');
          if (i > 1) bloques.push({ type: 'pagebreak' });
          setProg('p2w', 8 + (i / total) * 86, (escaneado ? 'OCR' : 'Procesando') + ' página ' + i + '/' + total + '…', true);
          if (incluirImg) {
            const baseW = (await pdf.getPage(i)).getViewport({ scale: 1 }).width;
            bloques.push(await paginaComoImagen(pdf, i, Math.min(1400, baseW * 2)));
          }
          if (!escaneado) {
            itemsAParrafos(await (await pdf.getPage(i)).getTextContent()).forEach(p => bloques.push(Object.assign({ type: 'p' }, p)));
          } else {
            const c = await renderPagina(pdf, i, Math.min(2200, (await pdf.getPage(i)).getViewport({ scale: 1 }).width * 2.5));
            const { data } = await worker.recognize(c);
            (data.text || '').split(/\n+/).forEach(line => { const t = line.replace(/\s+/g, ' ').trim(); if (t) bloques.push({ type: 'p', text: t }); });
            c.width = c.height = 0;
          }
        }
        if (worker) { await worker.terminate(); worker = null; }
        if (!bloques.length) bloques.push({ type: 'p', text: '(No se detectó contenido en el documento.)' });
        setProg('p2w', 96, 'Generando .docx…', false);
        blob = await construirDocx(bloques);
        etq = (escaneado ? '(texto · OCR)' : '(texto digital)') + (incluirImg ? ' + imágenes' : '');
      }

      const dl = $('p2wDl'); dl.href = URL.createObjectURL(blob); dl.download = baseName(p2w.file.name) + '.docx'; dl.style.display = '';
      setProg('p2w', 100, '¡Listo! ' + etq, false);
      toast('✅ Word generado ' + etq);
    } catch (e) {
      console.error(e); setProg('p2w', 0, 'Error: ' + e.message, false);
      if (!/Cancelado/.test(e.message)) toast('❌ ' + e.message); else toast('Operación cancelada');
    } finally {
      if (worker) { try { await worker.terminate(); } catch (_) {} }
      $('p2wRun').disabled = false;
    }
  }

  // ====================================================================
  // ==============================  INIT  =============================
  // ====================================================================
  function init() {
    crearHub();
    buildMerge();
    buildOrganize();
    buildPagesTool('pdfExtract', '✂️', 'Extraer páginas', 'Crea un PDF solo con las páginas elegidas.', 'extract');
    buildPagesTool('pdfRemove', '🗑️', 'Eliminar páginas', 'Quita páginas y conserva el resto.', 'remove');
    buildSplit();
    buildCompress();
    buildImg2Pdf();
    buildPdf2Img();
    buildPdf2Word();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
