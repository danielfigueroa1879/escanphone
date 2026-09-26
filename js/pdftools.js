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
  const p2w = { file: null, token: null, lang: 'spa+eng' };
  function buildPdf2Word() {
    crearVista('pdfPdf2Word', '📝', 'PDF a Word', 'Extrae el texto editable en el mismo orden del original.',
      '<div class="card">' +
        dropHTML('p2w', 'application/pdf', false, 'Sube un PDF', 'Toca o arrastra el PDF') +
        '<div id="p2wPanel" style="display:none; margin-top:12px;">' +
          '<div class="field-row"><div class="fr-label">Idioma (OCR)<small>Para páginas escaneadas o en imagen</small></div>' +
            '<div class="seg" id="p2wLangSeg"><button type="button" class="active" data-l="spa+eng">ES + EN</button>' +
            '<button type="button" data-l="spa">Español</button><button type="button" data-l="eng">English</button></div></div>' +
          '<p class="name-hint" style="margin:6px 2px 0;">Genera <b>texto real editable</b> en el <b>mismo orden</b> que el original, conservando la <b>fuente real</b> (Calibri, Arial, Times…), la <b>negrita/cursiva</b>, el <b>tamaño de letra</b> y la <b>posición/indentación</b>. Detecta <b>tablas</b> y las crea como <b>tablas reales</b> de Word. Si una página es imagen o está escaneada, se reconoce con <b>OCR</b> automáticamente. <b>No se insertan imágenes:</b> el resultado es 100% texto editable.</p>' +
          '<button class="btn brand full" id="p2wRun" style="margin-top:14px;">📝 Convertir a Word (.docx)</button>' +
          '<a class="btn primary full" id="p2wDl" style="display:none; margin-top:10px;">⬇ Descargar .docx</a>' +
        '</div>' +
      '</div>' + progHTML('p2w'));
    wireDrop('p2w', fs => cargar(fs[0]));
    $('p2wLangSeg').querySelectorAll('button').forEach(b => b.addEventListener('click', () => { p2w.lang = b.dataset.l; $('p2wLangSeg').querySelectorAll('button').forEach(x => x.classList.toggle('active', x === b)); }));
    $('p2wRun').addEventListener('click', () => runPdf2Word(p2w.lang));
    $('p2wCancel').addEventListener('click', () => { if (p2w.token) p2w.token.cancelado = true; });
    async function cargar(file) {
      if (!file) return;
      try { await validarPdf(file); p2w.file = file; $('p2wPanel').style.display = ''; $('p2wDrop').style.display = 'none'; $('p2wDl').style.display = 'none'; }
      catch (e) { toast('❌ ' + e.message); }
    }
  }
  // Familia genérica de respaldo (cuando no se logra el nombre real).
  function famJS(styles, fontName) {
    const ff = ((styles && styles[fontName] && styles[fontName].fontFamily) || '') + ' ' + (fontName || '');
    if (/serif/i.test(ff) && !/sans/i.test(ff)) return 'Times New Roman';
    if (/mono|courier|consol/i.test(ff)) return 'Courier New';
    return 'Calibri';
  }
  function biJS(styles, fontName) {
    const ff = ((styles && styles[fontName] && styles[fontName].fontFamily) || '') + ' ' + (fontName || '');
    return { bold: /bold|black|heavy|semibold/i.test(ff), italic: /italic|oblique/i.test(ff) };
  }
  // Limpia el nombre REAL de la fuente (de pdf.js commonObjs), p. ej.
  // "BAAAAA+Calibri-Bold" → { family:'Calibri', bold:true, italic:false }.
  function limpiaFuente(name) {
    if (!name) return null;
    let n = name.indexOf('+') >= 0 ? name.slice(name.indexOf('+') + 1) : name;
    const bold = /bold|black|heavy|semibold/i.test(n);
    const italic = /italic|oblique/i.test(n);
    let fam = n.replace(/[-,\s]?(BoldItalic|SemiBold|DemiBold|Bold|Italic|Oblique|Regular|Roman|Light|Medium|Black|Heavy|Condensed|Thin)/gi, '')
      .replace(/(PSMT|PS|MT)$/i, '').replace(/[-,_\s]+$/, '').trim();
    if (/^TimesNewRoman/i.test(fam) || /^Times/i.test(fam)) fam = 'Times New Roman';
    else if (/^Calibri/i.test(fam)) fam = 'Calibri';
    else if (/^Arial/i.test(fam)) fam = 'Arial';
    else if (/^Cambria/i.test(fam)) fam = 'Cambria';
    else if (/^Courier/i.test(fam)) fam = 'Courier New';
    else if (/^Verdana/i.test(fam)) fam = 'Verdana';
    else if (/^Georgia/i.test(fam)) fam = 'Georgia';
    if (!fam) fam = 'Calibri';
    return { family: fam, bold, italic };
  }
  // Construye el mapa fontName → {family,bold,italic} usando el nombre real que
  // pdf.js expone en page.commonObjs (requiere haber cargado la página).
  function resolverFuentes(page, tc) {
    const map = {};
    const names = new Set((tc.items || []).map(it => it.fontName));
    names.forEach(fn => {
      if (!fn) return;
      let obj = null;
      try { obj = page.commonObjs.get(fn); } catch (_) { obj = null; }
      const cleaned = obj && obj.name ? limpiaFuente(obj.name) : null;
      if (cleaned) map[fn] = cleaned;
    });
    return map;
  }
  // Extrae las LÍNEAS de una página (agrupa items por Y; ordena por X).
  // Cada línea: { y (baseline), size, minx, right, parts:[{x,text,font,sizePt,bold,italic}] }
  function extraerLineas(textContent, fontMap) {
    const styles = textContent.styles || {};
    const items = (textContent.items || []).filter(it => it.str != null && it.str !== '');
    if (!items.length) return [];
    const lineas = [];
    items.forEach(it => {
      const size = it.height || Math.hypot(it.transform[2], it.transform[3]) || 10;
      const y = it.transform[5], x = it.transform[4];
      const w = it.width || (it.str.length * size * 0.5);
      let ln = lineas.find(l => Math.abs(l.y - y) <= Math.max(2, size * 0.5));
      if (!ln) { ln = { y, size, minx: x, right: x + w, parts: [] }; lineas.push(ln); }
      ln.minx = Math.min(ln.minx, x); ln.right = Math.max(ln.right, x + w); ln.size = Math.max(ln.size, size);
      // Fuente real (nombre exacto + negrita/cursiva) o respaldo genérico.
      const fm = fontMap && fontMap[it.fontName];
      const font = fm ? fm.family : famJS(styles, it.fontName);
      const bi = fm ? fm : biJS(styles, it.fontName);
      ln.parts.push({ x, text: it.str, font: font, sizePt: size, bold: !!bi.bold, italic: !!bi.italic });
    });
    lineas.forEach(l => l.parts.sort((a, b) => a.x - b.x));
    lineas.sort((a, b) => b.y - a.y); // de arriba a abajo
    return lineas;
  }
  // Fusiona LÍNEAS consecutivas que pertenecen al MISMO párrafo, para que el
  // texto fluya y se pueda editar/justificar como en el original. Empieza un
  // párrafo nuevo cuando hay hueco vertical grande, cambia la sangría, o la
  // línea previa terminó corta (fin de párrafo). Las tablas pasan intactas.
  function fusionarParrafos(mezcla) {
    const rights = mezcla.filter(m => !m.type).map(l => l.right);
    const textRight = rights.length ? Math.max.apply(null, rights) : 9999;
    const out = []; let para = null, prevY = null, prevRight = null;
    const flush = () => { if (para) { if (para.lines > 1) para.align = 'both'; delete para.lines; out.push(para); para = null; } };
    for (const m of mezcla) {
      if (m.type === 'table') { flush(); out.push(m); prevY = null; prevRight = null; continue; }
      const l = m;
      const texto = l.parts.map(p => p.text).join('');
      if (!texto.trim()) { continue; }
      let nueva = false;
      if (!para) nueva = true;
      else {
        const gap = prevY - l.y;
        if (gap > l.size * 1.9) nueva = true;                       // hueco grande → nuevo párrafo
        else if (Math.abs(l.minx - para.indentPt) > 14) nueva = true; // cambia la sangría
        else if (prevRight < textRight * 0.80) nueva = true;        // línea previa corta → fin de párrafo
      }
      if (nueva) {
        flush();
        const sb = (prevY != null) ? Math.max(0, Math.min(48, (prevY - l.y) - l.size)) : 0;
        para = { type: 'p', indentPt: Math.max(0, l.minx), spaceBeforePt: sb, runs: [], lines: 0 };
      } else if (para.runs.length) {
        const last = para.runs[para.runs.length - 1];
        if (!/[\s-]$/.test(last.text)) last.text += ' ';            // separar líneas unidas con un espacio
      }
      l.parts.forEach(p => para.runs.push({ text: p.text, font: p.font, sizePt: p.sizePt, bold: p.bold, italic: p.italic }));
      para.lines++;
      prevY = l.y; prevRight = l.right;
    }
    flush();
    return out;
  }
  // Pipeline por página: líneas → tablas → separar columnas → fusión de párrafos.
  function itemsAParrafos(textContent, fontMap) {
    return fusionarParrafos(dividirColumnas(agruparEnTablas(extraerLineas(textContent, fontMap))));
  }
  // ---- Detección de TABLAS por alineación de columnas (sin PyMuPDF) --------
  // Recibe líneas ricas [{indentPt, spaceBeforePt, runs:[{x,text,sizePt,...}]}]
  // y agrupa filas consecutivas que forman columnas alineadas en un bloque
  // {type:'table', rows:[[celda,...],...]}. El resto quedan como 'p'.
  function anchoRun(r) { return (r.text ? r.text.length : 0) * (r.sizePt || 10) * 0.5; }
  function celdasDeLinea(l) {
    const rs = (l.parts || l.runs || []).slice().sort((a, b) => a.x - b.x);
    if (!rs.length) return [];
    const size = rs.reduce((m, r) => Math.max(m, r.sizePt || 10), 10);
    const umbral = Math.max(24, size * 3); // hueco mínimo para separar columnas
    const cells = []; let cur = null;
    rs.forEach(r => {
      if (!cur) { cur = { x: r.x, text: r.text }; cur.xEnd = r.x + anchoRun(r); return; }
      const gap = r.x - cur.xEnd;
      if (gap > umbral) { cells.push(cur); cur = { x: r.x, text: r.text }; }
      else { cur.text += r.text; }
      cur.xEnd = r.x + anchoRun(r);
    });
    if (cur) cells.push(cur);
    return cells;
  }
  function agruparEnTablas(lineas) {
    // Precalcular celdas por línea.
    const info = lineas.map(l => ({ l, cells: celdasDeLinea(l) }));
    const salida = [];
    let i = 0;
    while (i < info.length) {
      // ¿Arranca aquí un grupo de filas "tabulares" (>=2 celdas)?
      if (info[i].cells.length >= 2) {
        let j = i;
        while (j < info.length && info[j].cells.length >= 2) j++;
        const grupo = info.slice(i, j);
        const tabla = intentarTabla(grupo);
        if (tabla) { salida.push(tabla); i = j; continue; }
      }
      salida.push(info[i].l);
      i++;
    }
    return salida;
  }
  function intentarTabla(grupo) {
    if (grupo.length < 2) return null;
    // Clusterizar las posiciones X de todas las celdas en columnas.
    const xs = [];
    grupo.forEach(g => g.cells.forEach(c => xs.push(c.x)));
    xs.sort((a, b) => a - b);
    const cols = []; const TOL = 22;
    xs.forEach(x => {
      const c = cols.find(k => Math.abs(k.x - x) <= TOL);
      if (c) { c.x = (c.x * c.n + x) / (c.n + 1); c.n++; } else cols.push({ x, n: 1 });
    });
    cols.sort((a, b) => a.x - b.x);
    if (cols.length < 2) return null;
    // Construir la matriz asignando cada celda a su columna más cercana.
    const rows = []; let consistentes = 0;
    for (const g of grupo) {
      const fila = new Array(cols.length).fill('');
      let ok = true;
      for (const c of g.cells) {
        let idx = 0, best = Infinity;
        cols.forEach((k, n) => { const d = Math.abs(k.x - c.x); if (d < best) { best = d; idx = n; } });
        if (fila[idx]) { ok = false; break; }            // dos celdas a la misma columna → no es tabla limpia
        fila[idx] = (c.text || '').trim();
      }
      if (!ok) return null;
      if (g.cells.length === cols.length) consistentes++;
      rows.push(fila);
    }
    // Exigir alineación consistente en la mayoría de filas para evitar falsos positivos.
    if (consistentes < Math.ceil(grupo.length * 0.6)) return null;
    return { type: 'table', rows };
  }

  // Separa COLUMNAS: si una línea tiene un hueco horizontal grande (columnas
  // lado a lado, como un membrete a la izquierda y el título a la derecha),
  // la divide en varias líneas independientes conservando la X de cada una.
  // Así no se concatenan textos de columnas distintas y cada bloque queda en
  // su posición horizontal. Las tablas y los bloques ya formados pasan igual.
  function dividirColumnas(mezcla) {
    const out = [];
    for (const m of mezcla) {
      if (m.type) { out.push(m); continue; }              // tabla u otro bloque
      const parts = m.parts || [];
      if (parts.length < 2) { out.push(m); continue; }
      const gut = Math.max(48, (m.size || 12) * 3.5);      // hueco mínimo de columna
      const segs = []; let cur = [parts[0]];
      for (let k = 1; k < parts.length; k++) {
        const prev = cur[cur.length - 1];
        const gap = parts[k].x - (prev.x + anchoRun(prev));
        if (gap > gut) { segs.push(cur); cur = [parts[k]]; } else cur.push(parts[k]);
      }
      segs.push(cur);
      if (segs.length === 1) { out.push(m); continue; }
      for (const sg of segs) {
        const last = sg[sg.length - 1];
        out.push({ y: m.y, size: m.size, minx: sg[0].x, right: last.x + anchoRun(last), parts: sg });
      }
    }
    return out;
  }

  // Construye un .docx válido a partir de bloques:
  //  {type:'p', text|runs, indentPt?, spaceBeforePt?} | {type:'table', rows} |
  //  {type:'img', bytes, w, h, ext} | {type:'pagebreak'}
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

    // Un run con su formato (fuente, tamaño, negrita, cursiva).
    function runXml(r) {
      const sz = Math.max(6, Math.round((r.sizePt || 11) * 2)); // half-points
      const fam = esc(r.font || 'Arial');
      return '<w:r><w:rPr><w:rFonts w:ascii="' + fam + '" w:hAnsi="' + fam + '" w:cs="' + fam + '"/>' +
        (r.bold ? '<w:b/>' : '') + (r.italic ? '<w:i/>' : '') +
        '<w:sz w:val="' + sz + '"/></w:rPr><w:t xml:space="preserve">' + esc(r.text) + '</w:t></w:r>';
    }
    // Tabla real de Word con bordes (definidos inline, sin depender de estilos).
    function tablaXml(rows) {
      const nCols = rows.reduce((m, r) => Math.max(m, r.length), 0) || 1;
      const bordes = '<w:tblBorders>' +
        ['top', 'left', 'bottom', 'right', 'insideH', 'insideV']
          .map(s => '<w:' + s + ' w:val="single" w:sz="4" w:space="0" w:color="auto"/>').join('') +
        '</w:tblBorders>';
      const grid = '<w:tblGrid>' + Array(nCols).fill('<w:gridCol w:w="0"/>').join('') + '</w:tblGrid>';
      const trs = rows.map(fila => {
        const tcs = [];
        for (let j = 0; j < nCols; j++) {
          const val = fila[j] || '';
          tcs.push('<w:tc><w:tcPr><w:tcW w:w="0" w:type="auto"/></w:tcPr>' +
            '<w:p><w:r><w:t xml:space="preserve">' + esc(val) + '</w:t></w:r></w:p></w:tc>');
        }
        return '<w:tr>' + tcs.join('') + '</w:tr>';
      }).join('');
      return '<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/>' + bordes + '</w:tblPr>' + grid + trs + '</w:tbl><w:p/>';
    }
    const body = bloques.map(b => {
      if (b.type === 'pagebreak') return '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
      if (b.type === 'img') return imgXml(b);
      if (b.type === 'table') return tablaXml(b.rows || []);
      // Párrafo con posición (indentación), espacio vertical y alineación.
      const ind = b.indentPt ? '<w:ind w:left="' + Math.round(b.indentPt * 20) + '"/>' : '';
      const sb = '<w:spacing w:before="' + Math.round((b.spaceBeforePt || 0) * 20) + '" w:after="0"/>';
      const jc = b.align ? '<w:jc w:val="' + b.align + '"/>' : '';
      const pPr = '<w:pPr>' + ind + sb + jc + '</w:pPr>';
      let runs;
      if (b.runs && b.runs.length) runs = b.runs.map(runXml).join('');
      else if (b.heading) runs = '<w:r><w:rPr><w:b/><w:sz w:val="30"/></w:rPr><w:t xml:space="preserve">' + esc(b.text || '') + '</w:t></w:r>';
      else runs = '<w:r><w:t xml:space="preserve">' + esc(b.text || '') + '</w:t></w:r>';
      return '<w:p>' + pPr + runs + '</w:p>';
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

  // Convierte una página escaneada/imagen a párrafos ordenados usando OCR.
  // Reutiliza el bbox de cada palabra para ordenar por líneas (arriba→abajo,
  // izquierda→derecha), igual que el orden del documento original.
  async function ocrPaginaAParrafos(pdf, num, worker) {
    const base = (await pdf.getPage(num)).getViewport({ scale: 1 }).width;
    const c = await renderPagina(pdf, num, Math.min(2200, base * 2.5));
    const S = c.width / base; // px por punto → para convertir bbox a puntos
    const { data } = await worker.recognize(c, {}, { blocks: true });
    c.width = c.height = 0;
    // Agrupar palabras por línea usando su posición vertical (bbox del OCR).
    const words = [];
    (data.blocks || []).forEach(b => (b.paragraphs || []).forEach(p =>
      (p.lines || []).forEach(l => (l.words || []).forEach(w => {
        if (w.text && w.text.trim() && w.bbox) words.push({ t: w.text, x: w.bbox.x0, y: (w.bbox.y0 + w.bbox.y1) / 2, h: w.bbox.y1 - w.bbox.y0 });
      }))));
    if (words.length) {
      const lineas = [];
      words.forEach(w => {
        let ln = lineas.find(L => Math.abs(L.y - w.y) <= Math.max(6, w.h * 0.6));
        if (!ln) { ln = { y: w.y, minx: w.x, h: w.h, parts: [] }; lineas.push(ln); }
        ln.minx = Math.min(ln.minx, w.x); ln.h = Math.max(ln.h, w.h);
        ln.parts.push(w);
      });
      lineas.sort((a, b) => a.y - b.y);
      const out = []; let prevY = null;
      lineas.forEach(L => {
        L.parts.sort((a, b) => a.x - b.x);
        const texto = L.parts.map(p => p.t).join(' ').replace(/\s+/g, ' ').trim();
        if (!texto) return;
        const sizePt = (L.h / S) * 0.8;   // alto de línea (px) → tamaño en puntos
        let sb = 0;
        if (prevY != null) sb = Math.max(0, Math.min(48, (L.y - prevY) / S - sizePt));
        prevY = L.y;
        out.push({ type: 'p', indentPt: Math.max(0, L.minx / S), spaceBeforePt: sb, runs: [{ text: texto, font: 'Arial', sizePt: sizePt, bold: false, italic: false }] });
      });
      return out;
    }
    // Respaldo: texto plano por saltos de línea.
    return (data.text || '').split(/\n+/).map(t => ({ type: 'p', runs: [{ text: t.replace(/\s+/g, ' ').trim(), font: 'Arial', sizePt: 11 }] })).filter(p => p.runs[0].text);
  }

  async function runPdf2Word(lang) {
    if (!p2w.file) return;
    p2w.token = nuevoToken(); $('p2wRun').disabled = true; $('p2wDl').style.display = 'none';
    let worker = null;
    try {
      const bytes = new Uint8Array(await readAB(p2w.file));
      const pdf = await abrirConPdfjs(bytes);
      const total = pdf.numPages;
      const bloques = [];
      let usoOCR = false;
      // Por CADA página: si tiene texto digital, se extrae en orden; si es
      // imagen/escaneada, se pasa por OCR y se ordena. SIEMPRE texto, sin imágenes.
      for (let i = 1; i <= total; i++) {
        if (p2w.token.cancelado) throw new Error('Cancelado por el usuario.');
        if (i > 1) bloques.push({ type: 'pagebreak' });
        setProg('p2w', 4 + (i / total) * 90, 'Procesando página ' + i + '/' + total + '…', true);
        const page = await pdf.getPage(i);
        const tc = await page.getTextContent();
        const chars = (tc.items || []).reduce((a, it) => a + ((it.str || '').trim().length), 0);
        let parrafos;
        if (chars >= 15) {
          // Cargar las fuentes reales de la página (nombre exacto + negrita/cursiva).
          let fontMap = {};
          try { await page.getOperatorList(); fontMap = resolverFuentes(page, tc); } catch (_) {}
          // Página con texto real → líneas, tablas y párrafos fusionados en orden.
          parrafos = itemsAParrafos(tc, fontMap);
        } else {
          // Página en imagen/escaneada → OCR (rápido, solo esta página).
          if (!worker) { setProg('p2w', 4 + (i / total) * 90, 'Cargando OCR…', true); const T = await ensureTesseract(); worker = await T.createWorker(lang, 1); }
          setProg('p2w', 4 + (i / total) * 90, 'OCR página ' + i + '/' + total + '…', true);
          parrafos = await ocrPaginaAParrafos(pdf, i, worker);
          usoOCR = true;
        }
        parrafos.forEach(b => bloques.push(b));
      }
      if (worker) { await worker.terminate(); worker = null; }
      if (!bloques.length) bloques.push({ type: 'p', text: '(No se detectó texto en el documento.)' });
      // Normalizar la sangría: restar el margen izquierdo COMÚN del documento
      // (así el texto normal queda al margen y solo se conservan las sangrías
      // relativas de listas/citas), evitando el doble margen.
      const inds = bloques.filter(b => b.type === 'p' && b.indentPt).map(b => b.indentPt);
      if (inds.length) {
        const baseX = Math.min.apply(null, inds);
        bloques.forEach(b => { if (b.type === 'p' && b.indentPt) b.indentPt = Math.max(0, b.indentPt - baseX); });
      }
      setProg('p2w', 96, 'Generando .docx…', false);
      const blob = await construirDocx(bloques);
      const dl = $('p2wDl'); dl.href = URL.createObjectURL(blob); dl.download = baseName(p2w.file.name) + '.docx'; dl.style.display = '';
      const etq = usoOCR ? '(texto · con OCR)' : '(texto)';
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
