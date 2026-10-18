/* ============================================================================
   Editor de fotos — módulo independiente, 100% en el navegador.
   Pincel, borrador, líneas, flechas, formas y texto en una capa de trazos;
   ajustes de color y filtros sobre la foto; recorte, giro y volteo; historial
   de deshacer/rehacer. No se sube ninguna imagen a terceros.
   ========================================================================== */
(function () {
  'use strict';

  const MAX_SIDE = 2000;      // lado máximo al abrir (fluidez en móviles)
  const HISTORY_LIMIT = 40;
  const $ = id => document.getElementById(id);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const mk = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
  const toast = m => { if (typeof window.showToast === 'function') window.showToast(m); };
  const baseName = n => (n || 'foto').replace(/\.[^.]+$/, '') || 'foto';

  const root = $('appEditor');
  if (!root) return;
  const view = $('edView'), vctx = view.getContext('2d');
  const stage = $('edStage'), ring = $('edRing');
  const activo = () => root.classList.contains('active');

  // Estado
  let base = mk(1, 1);                 // foto (cambia solo con recorte, giro o al abrir)
  let baseData = null;                 // ImageData de base
  let adjCanvas = mk(1, 1);            // foto con ajustes y filtro
  let drawLayer = mk(1, 1);            // trazos
  let strokeLayer = mk(1, 1);          // trazo en curso / vista previa
  const adj = { brightness: 0, contrast: 0, saturation: 0, warmth: 0, vignette: 0 };
  let filter = 'none', intensity = 100;
  let tool = 'brush', color = '#e5484d';
  let history = [], hIndex = -1, restoreToken = 0, restoring = false;
  let showOriginal = false, loaded = false, fileName = 'foto';
  let crop = null, ratio = 'free';

  const FILTERS = [
    ['none', 'Ninguno'], ['bw', 'B y N'], ['sepia', 'Sepia'], ['warm', 'Cálido'],
    ['cool', 'Frío'], ['vintage', 'Vintage'], ['drama', 'Dramático'], ['noir', 'Noir'], ['invert', 'Negativo']
  ];
  const SWATCHES = ['#111418', '#ffffff', '#e5484d', '#f2994a', '#f5d90a', '#30a46c', '#12a594', '#3e63dd', '#8e4ec6', '#d6409f', '#7c5a3a'];
  const FONTS = {
    sans: '600 {s}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, system-ui, sans-serif',
    display: '800 {s}px "Avenir Next", "Segoe UI", Roboto, system-ui, sans-serif',
    serif: '700 {s}px Georgia, "Times New Roman", serif',
    mono: '500 {s}px ui-monospace, "SF Mono", Menlo, Consolas, monospace'
  };
  const TOOL_HINTS = {
    brush: 'Pincel · arrastra sobre la foto para dibujar',
    eraser: 'Borrador · borra trazos, la foto no se toca',
    line: 'Línea · arrastra desde el inicio hasta el final',
    arrow: 'Flecha · arrastra hacia donde debe apuntar',
    rect: 'Rectángulo · arrastra en diagonal',
    ellipse: 'Círculo · arrastra en diagonal',
    text: 'Texto · toca la foto para poner el texto',
    crop: 'Recorte · ajusta el marco y pulsa Aplicar'
  };

  // ---------- Procesamiento de color ----------
  function processPixels(src, out, w, h, a, flt, inten) {
    const s = src.data, d = out.data;
    const br = a.brightness * 1.6;
    const cv = a.contrast * 2.55, cf = (259 * (cv + 255)) / (255 * (259 - cv));
    const sat = 1 + a.saturation / 100;
    const wm = a.warmth * 0.45;
    const vg = a.vignette / 100, cx = w / 2, cy = h / 2, maxD = cx * cx + cy * cy;
    const k = inten / 100;
    for (let y = 0, i = 0; y < h; y++) {
      const dy = (y - cy) * (y - cy);
      for (let x = 0; x < w; x++, i += 4) {
        let r = s[i], g = s[i + 1], b = s[i + 2];
        if (flt !== 'none') {
          let fr = r, fg = g, fb = b, l;
          switch (flt) {
            case 'bw': l = .299 * r + .587 * g + .114 * b; fr = fg = fb = l; break;
            case 'sepia': fr = .393 * r + .769 * g + .189 * b; fg = .349 * r + .686 * g + .168 * b; fb = .272 * r + .534 * g + .131 * b; break;
            case 'warm': fr = r * 1.08 + 12; fg = g * 1.02 + 4; fb = b * .86; break;
            case 'cool': fr = r * .88; fg = g * 1.0 + 2; fb = b * 1.1 + 14; break;
            case 'vintage': {
              const sr = .393 * r + .769 * g + .189 * b, sg = .349 * r + .686 * g + .168 * b, sb = .272 * r + .534 * g + .131 * b;
              fr = (r * .5 + sr * .5) * .82 + 34; fg = (g * .5 + sg * .5) * .82 + 28; fb = (b * .5 + sb * .5) * .78 + 30; break;
            }
            case 'drama': {
              l = .299 * r + .587 * g + .114 * b;
              fr = 1.45 * ((l + (r - l) * .7) - 128) + 118; fg = 1.45 * ((l + (g - l) * .7) - 128) + 118; fb = 1.45 * ((l + (b - l) * .7) - 128) + 124; break;
            }
            case 'noir': l = .299 * r + .587 * g + .114 * b; fr = fg = fb = 1.6 * (l - 128) + 120; break;
            case 'invert': fr = 255 - r; fg = 255 - g; fb = 255 - b; break;
          }
          r += (fr - r) * k; g += (fg - g) * k; b += (fb - b) * k;
        }
        r += br + wm; g += br; b += br - wm;
        r = cf * (r - 128) + 128; g = cf * (g - 128) + 128; b = cf * (b - 128) + 128;
        if (sat !== 1) { const l = .299 * r + .587 * g + .114 * b; r = l + (r - l) * sat; g = l + (g - l) * sat; b = l + (b - l) * sat; }
        if (vg) { const f = 1 - vg * Math.pow(((x - cx) * (x - cx) + dy) / maxD, 1.4) * 1.1; r *= f; g *= f; b *= f; }
        d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = s[i + 3];
      }
    }
  }

  let processQueued = false;
  function scheduleProcess() {
    if (processQueued) return;
    processQueued = true;
    requestAnimationFrame(() => { processQueued = false; processNow(); render(); });
  }
  function processNow() {
    const w = base.width, h = base.height;
    if (adjCanvas.width !== w || adjCanvas.height !== h) { adjCanvas = mk(w, h); }
    const actx = adjCanvas.getContext('2d');
    const neutral = filter === 'none' && Object.values(adj).every(v => v === 0);
    if (neutral) { actx.clearRect(0, 0, w, h); actx.drawImage(base, 0, 0); return; }
    const out = actx.createImageData(w, h);
    processPixels(baseData, out, w, h, adj, filter, intensity);
    actx.putImageData(out, 0, 0);
  }

  function setBase(c) {
    base = c;
    baseData = c.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, c.width, c.height);
    processNow();
    buildFilterThumbs();
    $('edStatusSize').textContent = `${c.width} × ${c.height} px`;
  }

  // ---------- Render ----------
  let renderQueued = false;
  function requestRender() {
    if (renderQueued) return;
    renderQueued = true;
    requestAnimationFrame(() => { renderQueued = false; render(); });
  }
  function render() {
    if (view.width !== base.width || view.height !== base.height) { view.width = base.width; view.height = base.height; fit(); }
    vctx.globalAlpha = 1; vctx.globalCompositeOperation = 'source-over';
    vctx.clearRect(0, 0, view.width, view.height);
    if (showOriginal) { vctx.drawImage(base, 0, 0); return; }
    vctx.drawImage(adjCanvas, 0, 0);
    vctx.drawImage(drawLayer, 0, 0);
    if (drawing && tool !== 'eraser') { vctx.globalAlpha = opacity(); vctx.drawImage(strokeLayer, 0, 0); vctx.globalAlpha = 1; }
    if (tool === 'crop' && crop) drawCropOverlay();
  }

  function fit() {
    const cs = getComputedStyle(stage);
    const bw = stage.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    const bh = stage.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
    if (bw <= 0 || bh <= 0) return;
    const s = Math.min(bw / view.width, bh / view.height);
    view.style.width = Math.floor(view.width * s) + 'px';
    view.style.height = Math.floor(view.height * s) + 'px';
  }
  if (window.ResizeObserver) new ResizeObserver(fit).observe(stage);
  else window.addEventListener('resize', fit);

  // ---------- Historial ----------
  function snapshot() {
    const entry = { base, adj: { ...adj }, filter, intensity };
    entry.draw = new Promise(res => drawLayer.toBlob(b => res(b), 'image/png'));
    return entry;
  }
  function pushHistory() {
    history = history.slice(0, hIndex + 1);
    history.push(snapshot());
    if (history.length > HISTORY_LIMIT) history.shift();
    hIndex = history.length - 1;
    updateHistoryButtons();
  }
  function resetHistory() { history = []; hIndex = -1; pushHistory(); }
  function updateHistoryButtons() {
    $('edUndo').disabled = hIndex <= 0;
    $('edRedo').disabled = hIndex >= history.length - 1;
  }
  async function restore(i) {
    const e = history[i];
    if (!e) return;
    hIndex = i; updateHistoryButtons();
    if (tool === 'crop') crop = null;
    Object.assign(adj, e.adj); filter = e.filter; intensity = e.intensity;
    syncAdjustControls();
    if (e.base !== base) setBase(e.base); else processNow();
    const token = ++restoreToken; restoring = true;
    const blob = await e.draw;
    const bmp = await createImageBitmap(blob);
    if (token !== restoreToken) return;
    drawLayer = mk(base.width, base.height);
    drawLayer.getContext('2d').drawImage(bmp, 0, 0);
    strokeLayer = mk(base.width, base.height);
    restoring = false;
    if (tool === 'crop') crop = fullCrop();
    render();
  }
  const undo = () => { if (hIndex > 0) restore(hIndex - 1); };
  const redo = () => { if (hIndex < history.length - 1) restore(hIndex + 1); };

  // ---------- Herramientas de dibujo ----------
  let drawing = false, pointerId = null, start = null, last = null, points = [];
  const opacity = () => +$('edOpacity').value / 100;
  const pxScale = () => { const r = view.getBoundingClientRect(); return r.width ? view.width / r.width : 1; };
  const lineW = () => +$('edSize').value * pxScale();
  function toImg(e) {
    const r = view.getBoundingClientRect();
    return { x: (e.clientX - r.left) * view.width / r.width, y: (e.clientY - r.top) * view.height / r.height };
  }
  function strokeStyle(ctx) {
    ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.lineWidth = lineW();
    ctx.strokeStyle = color; ctx.fillStyle = color;
  }
  function drawBrushPath(ctx, pts) {
    strokeStyle(ctx);
    ctx.beginPath();
    if (pts.length === 1) { ctx.arc(pts[0].x, pts[0].y, ctx.lineWidth / 2, 0, Math.PI * 2); ctx.fill(); return; }
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length - 1; i++) {
      const mx = (pts[i].x + pts[i + 1].x) / 2, my = (pts[i].y + pts[i + 1].y) / 2;
      ctx.quadraticCurveTo(pts[i].x, pts[i].y, mx, my);
    }
    const lp = pts[pts.length - 1]; ctx.lineTo(lp.x, lp.y);
    ctx.stroke();
  }
  function drawShape(ctx, kind, a, b) {
    strokeStyle(ctx);
    const fill = $('edFill').checked;
    ctx.beginPath();
    if (kind === 'line' || kind === 'arrow') {
      const ang = Math.atan2(b.y - a.y, b.x - a.x);
      const head = Math.max(ctx.lineWidth * 3.2, 14 * pxScale());
      const endX = kind === 'arrow' ? b.x - Math.cos(ang) * head * .5 : b.x;
      const endY = kind === 'arrow' ? b.y - Math.sin(ang) * head * .5 : b.y;
      ctx.moveTo(a.x, a.y); ctx.lineTo(endX, endY); ctx.stroke();
      if (kind === 'arrow') {
        ctx.beginPath();
        ctx.moveTo(b.x, b.y);
        ctx.lineTo(b.x - head * Math.cos(ang - .45), b.y - head * Math.sin(ang - .45));
        ctx.lineTo(b.x - head * Math.cos(ang + .45), b.y - head * Math.sin(ang + .45));
        ctx.closePath(); ctx.fill();
      }
      return;
    }
    const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y), w = Math.abs(b.x - a.x), h = Math.abs(b.y - a.y);
    if (kind === 'rect') ctx.rect(x, y, w, h);
    else ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
    fill ? ctx.fill() : ctx.stroke();
  }
  function drawText(ctx, p) {
    const txt = $('edTextValue').value.trim();
    if (!txt) return false;
    const size = +$('edTextSize').value * pxScale();
    ctx.font = FONTS[$('edFont').value].replace('{s}', size.toFixed(1));
    ctx.textBaseline = 'top';
    const lines = txt.split('\n'), lh = size * 1.18;
    if ($('edTextBox').checked) {
      const w = Math.max(...lines.map(l => ctx.measureText(l).width)), pad = size * .3;
      ctx.fillStyle = isLight(color) ? 'rgba(17,20,24,.82)' : 'rgba(255,255,255,.9)';
      ctx.beginPath();
      ctx.roundRect ? ctx.roundRect(p.x - pad, p.y - pad, w + pad * 2, lh * lines.length + pad * 1.6, size * .25) : ctx.rect(p.x - pad, p.y - pad, w + pad * 2, lh * lines.length + pad * 1.6);
      ctx.fill();
    }
    ctx.fillStyle = color;
    lines.forEach((l, i) => ctx.fillText(l, p.x, p.y + i * lh));
    return true;
  }
  function isLight(hex) {
    const n = parseInt(hex.slice(1), 16), r = n >> 16, g = (n >> 8) & 255, b = n & 255;
    return (.299 * r + .587 * g + .114 * b) > 150;
  }
  function commitStroke() {
    const ctx = drawLayer.getContext('2d');
    ctx.globalAlpha = opacity(); ctx.drawImage(strokeLayer, 0, 0); ctx.globalAlpha = 1;
    strokeLayer.getContext('2d').clearRect(0, 0, strokeLayer.width, strokeLayer.height);
  }

  view.addEventListener('pointerdown', e => {
    if (!loaded || restoring || showOriginal || pointerId !== null) return;
    if (e.button !== undefined && e.button > 0) return;
    e.preventDefault();
    const p = toImg(e);
    if (tool === 'crop') { cropDown(p); pointerId = e.pointerId; view.setPointerCapture(e.pointerId); return; }
    if (tool === 'text') {
      if (drawText(drawLayer.getContext('2d'), p)) { pushHistory(); render(); }
      else $('edTextValue').focus();
      return;
    }
    pointerId = e.pointerId; view.setPointerCapture(e.pointerId);
    drawing = true; start = last = p; points = [p];
    if (strokeLayer.width !== base.width || strokeLayer.height !== base.height) strokeLayer = mk(base.width, base.height);
    if (tool === 'eraser') eraseSeg(p, p);
    else if (tool === 'brush') { const c = strokeLayer.getContext('2d'); c.clearRect(0, 0, c.canvas.width, c.canvas.height); drawBrushPath(c, points); }
    requestRender();
  });
  view.addEventListener('pointermove', e => {
    updateRing(e);
    if (e.pointerId !== pointerId) return;
    const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    if (tool === 'crop') { cropMove(toImg(e)); requestRender(); return; }
    if (!drawing) return;
    const c = strokeLayer.getContext('2d');
    if (tool === 'brush') {
      evs.forEach(ev => points.push(toImg(ev)));
      c.clearRect(0, 0, c.canvas.width, c.canvas.height); drawBrushPath(c, points);
    } else if (tool === 'eraser') {
      evs.forEach(ev => { const p = toImg(ev); eraseSeg(last, p); last = p; });
    } else {
      last = toImg(e);
      c.clearRect(0, 0, c.canvas.width, c.canvas.height); drawShape(c, tool, start, last);
    }
    requestRender();
  });
  function endPointer(e) {
    if (e.pointerId !== pointerId) return;
    pointerId = null;
    if (tool === 'crop') { cropMode = null; return; }
    if (!drawing) return;
    drawing = false;
    const moved = Math.hypot(last.x - start.x, last.y - start.y) > 2;
    if (tool === 'brush' || (tool !== 'eraser' && moved)) commitStroke();
    else strokeLayer.getContext('2d').clearRect(0, 0, strokeLayer.width, strokeLayer.height);
    if (tool === 'brush' || tool === 'eraser' || moved) pushHistory();
    render();
  }
  view.addEventListener('pointerup', endPointer);
  view.addEventListener('pointercancel', endPointer);
  view.addEventListener('pointerleave', () => { ring.hidden = true; });

  function eraseSeg(a, b) {
    const ctx = drawLayer.getContext('2d');
    ctx.save(); ctx.globalCompositeOperation = 'destination-out';
    ctx.lineCap = 'round'; ctx.lineWidth = lineW(); ctx.strokeStyle = '#000';
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x + .01, b.y); ctx.stroke(); ctx.restore();
  }
  function updateRing(e) {
    if (e.pointerType !== 'mouse' || !(tool === 'brush' || tool === 'eraser')) { ring.hidden = true; return; }
    const sr = stage.getBoundingClientRect(), d = +$('edSize').value;
    ring.hidden = false;
    ring.style.width = ring.style.height = Math.max(d, 4) + 'px';
    ring.style.left = (e.clientX - sr.left) + 'px'; ring.style.top = (e.clientY - sr.top) + 'px';
  }

  // ---------- Recorte ----------
  let cropMode = null, cropAnchor = null, cropOffset = null;
  function fullCrop() {
    const w = base.width, h = base.height;
    if (ratio === 'free') return { x: 0, y: 0, w, h };
    let cw = w, ch = w / ratio; if (ch > h) { ch = h; cw = h * ratio; }
    return { x: (w - cw) / 2, y: (h - ch) / 2, w: cw, h: ch };
  }
  function cropCorners(c) { return [[c.x, c.y], [c.x + c.w, c.y], [c.x, c.y + c.h], [c.x + c.w, c.y + c.h]]; }
  function cropDown(p) {
    const tol = 22 * pxScale();
    const corners = cropCorners(crop);
    const hit = corners.findIndex(([x, y]) => Math.abs(p.x - x) < tol && Math.abs(p.y - y) < tol);
    if (hit >= 0) { cropMode = 'resize'; cropAnchor = { x: corners[3 - hit][0], y: corners[3 - hit][1] }; }
    else if (p.x > crop.x && p.x < crop.x + crop.w && p.y > crop.y && p.y < crop.y + crop.h) { cropMode = 'move'; cropOffset = { x: p.x - crop.x, y: p.y - crop.y }; }
    else { cropMode = 'resize'; cropAnchor = { x: clamp(p.x, 0, base.width), y: clamp(p.y, 0, base.height) }; }
  }
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  function cropMove(p) {
    const W = base.width, H = base.height;
    if (cropMode === 'move') {
      crop.x = clamp(p.x - cropOffset.x, 0, W - crop.w); crop.y = clamp(p.y - cropOffset.y, 0, H - crop.h);
    } else if (cropMode === 'resize') {
      const px = clamp(p.x, 0, W), py = clamp(p.y, 0, H);
      let w = Math.abs(px - cropAnchor.x), h = Math.abs(py - cropAnchor.y);
      if (ratio !== 'free') {
        if (w / Math.max(h, 1) > ratio) w = h * ratio; else h = w / ratio;
        const maxW = px < cropAnchor.x ? cropAnchor.x : W - cropAnchor.x;
        const maxH = py < cropAnchor.y ? cropAnchor.y : H - cropAnchor.y;
        if (w > maxW) { w = maxW; h = w / ratio; }
        if (h > maxH) { h = maxH; w = h * ratio; }
      }
      w = Math.max(w, 8); h = Math.max(h, 8);
      crop.x = px < cropAnchor.x ? cropAnchor.x - w : cropAnchor.x;
      crop.y = py < cropAnchor.y ? cropAnchor.y - h : cropAnchor.y;
      crop.w = w; crop.h = h;
    }
  }
  function drawCropOverlay() {
    const s = pxScale(), c = crop;
    vctx.save();
    vctx.fillStyle = 'rgba(8,10,16,.55)';
    vctx.beginPath(); vctx.rect(0, 0, view.width, view.height); vctx.rect(c.x, c.y, c.w, c.h); vctx.fill('evenodd');
    vctx.strokeStyle = 'rgba(255,255,255,.45)'; vctx.lineWidth = 1 * s;
    vctx.beginPath();
    for (let i = 1; i < 3; i++) {
      vctx.moveTo(c.x + c.w * i / 3, c.y); vctx.lineTo(c.x + c.w * i / 3, c.y + c.h);
      vctx.moveTo(c.x, c.y + c.h * i / 3); vctx.lineTo(c.x + c.w, c.y + c.h * i / 3);
    }
    vctx.stroke();
    vctx.strokeStyle = '#fff'; vctx.lineWidth = 2 * s; vctx.strokeRect(c.x, c.y, c.w, c.h);
    vctx.fillStyle = '#fff';
    const hs = 14 * s;
    cropCorners(c).forEach(([x, y]) => vctx.fillRect(x - hs / 2, y - hs / 2, hs, hs));
    vctx.restore();
    $('edStatusSize').textContent = `Recorte ${Math.round(c.w)} × ${Math.round(c.h)} px`;
  }
  function transformAll(fn) {
    if (!loaded) return;
    const nb = fn(base), nd = fn(drawLayer);
    drawLayer = nd; strokeLayer = mk(nb.width, nb.height);
    setBase(nb);
    if (tool === 'crop') crop = fullCrop();
    pushHistory(); render();
  }
  function cropCanvas(src, c) {
    const x = Math.round(c.x), y = Math.round(c.y), w = Math.round(c.w), h = Math.round(c.h);
    const n = mk(w, h); n.getContext('2d').drawImage(src, x, y, w, h, 0, 0, w, h); return n;
  }
  function rotateCanvas(src, dir) {
    const n = mk(src.height, src.width), c = n.getContext('2d');
    c.translate(n.width / 2, n.height / 2); c.rotate(dir * Math.PI / 2); c.drawImage(src, -src.width / 2, -src.height / 2); return n;
  }
  function flipCanvas(src, h) {
    const n = mk(src.width, src.height), c = n.getContext('2d');
    if (h) { c.translate(n.width, 0); c.scale(-1, 1); } else { c.translate(0, n.height); c.scale(1, -1); }
    c.drawImage(src, 0, 0); return n;
  }

  // ---------- UI: herramientas, pestañas ----------
  function setTool(t) {
    tool = t;
    $$('.ed-tool', root).forEach(b => b.setAttribute('aria-pressed', b.dataset.tool === t));
    $('edStatusTool').textContent = TOOL_HINTS[t];
    view.style.cursor = t === 'text' ? 'text' : t === 'crop' ? 'crosshair' : (t === 'brush' || t === 'eraser') ? 'none' : 'crosshair';
    if (t === 'crop') { crop = fullCrop(); setTab('frame', true); }
    else { crop = null; $('edStatusSize').textContent = `${base.width} × ${base.height} px`; if (currentTab === 'frame') setTab('draw', true); }
    $('edTextGroup').hidden = t !== 'text';
    $('edFillWrap').hidden = !(t === 'rect' || t === 'ellipse');
    render();
  }
  let currentTab = 'draw';
  function setTab(name, fromTool) {
    currentTab = name;
    $$('.ed-tab', root).forEach(b => b.setAttribute('aria-selected', b.dataset.tab === name));
    $$('.ed-pane', root).forEach(p => p.hidden = p.dataset.pane !== name);
    if (fromTool) return;
    if (name === 'frame' && tool !== 'crop') setTool('crop');
    else if (name !== 'frame' && tool === 'crop') setTool('brush');
  }
  $$('.ed-tool', root).forEach(b => b.addEventListener('click', () => { setTool(b.dataset.tool); if (b.dataset.tool !== 'crop') setTab('draw', true); }));
  $$('.ed-tab', root).forEach(b => b.addEventListener('click', () => setTab(b.dataset.tab)));

  // Colores
  const swWrap = $('edSwatches');
  SWATCHES.forEach(c => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'ed-sw'; b.style.background = c; b.dataset.color = c; b.setAttribute('aria-label', 'Color ' + c);
    b.addEventListener('click', () => setColor(c));
    swWrap.append(b);
  });
  const custom = document.createElement('label');
  custom.className = 'ed-sw ed-custom-color'; custom.title = 'Elegir otro color';
  custom.innerHTML = '<input type="color" id="edCustomColor" value="#e5484d" aria-label="Elegir otro color">';
  swWrap.append(custom);
  $('edCustomColor').addEventListener('input', e => setColor(e.target.value));
  function setColor(c) {
    color = c;
    $$('.ed-sw[data-color]', root).forEach(b => b.setAttribute('aria-pressed', b.dataset.color === c));
    custom.setAttribute('aria-pressed', !SWATCHES.includes(c));
  }

  $('edSize').addEventListener('input', e => $('edSizeOut').textContent = e.target.value + ' px');
  $('edOpacity').addEventListener('input', e => $('edOpacityOut').textContent = e.target.value + ' %');
  $('edTextSize').addEventListener('input', e => $('edTextSizeOut').textContent = e.target.value + ' px');
  $('edClear').addEventListener('click', () => {
    drawLayer.getContext('2d').clearRect(0, 0, drawLayer.width, drawLayer.height); pushHistory(); render();
  });

  // Ajustes
  $$('[data-adj]', root).forEach(inp => {
    inp.addEventListener('input', () => { adj[inp.dataset.adj] = +inp.value; inp.previousElementSibling.querySelector('output').textContent = inp.value; scheduleProcess(); });
    inp.addEventListener('change', pushHistory);
    inp.addEventListener('dblclick', () => { inp.value = 0; inp.dispatchEvent(new Event('input')); pushHistory(); });
  });
  $('edResetAdj').addEventListener('click', () => {
    Object.keys(adj).forEach(k => adj[k] = 0); syncAdjustControls(); processNow(); render(); pushHistory();
  });
  function syncAdjustControls() {
    $$('[data-adj]', root).forEach(inp => { inp.value = adj[inp.dataset.adj]; inp.previousElementSibling.querySelector('output').textContent = inp.value; });
    $('edIntensity').value = intensity; $('edIntensityOut').textContent = intensity + ' %';
    $$('.ed-flt', root).forEach(b => b.setAttribute('aria-pressed', b.dataset.filter === filter));
  }

  // Filtros
  const fltWrap = $('edFilters');
  FILTERS.forEach(([id, name]) => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'ed-flt'; b.dataset.filter = id; b.setAttribute('aria-pressed', id === 'none');
    b.innerHTML = `<canvas width="96" height="96"></canvas><span>${name}</span>`;
    b.addEventListener('click', () => { filter = id; syncAdjustControls(); processNow(); render(); pushHistory(); });
    fltWrap.append(b);
  });
  function buildFilterThumbs() {
    const t = mk(96, 96), tc = t.getContext('2d', { willReadFrequently: true });
    const s = Math.min(base.width, base.height);
    tc.drawImage(base, (base.width - s) / 2, (base.height - s) / 2, s, s, 0, 0, 96, 96);
    const src = tc.getImageData(0, 0, 96, 96);
    const zero = { brightness: 0, contrast: 0, saturation: 0, warmth: 0, vignette: 0 };
    $$('.ed-flt', root).forEach(b => {
      const c = b.querySelector('canvas').getContext('2d');
      const out = c.createImageData(96, 96);
      processPixels(src, out, 96, 96, zero, b.dataset.filter, 100);
      c.putImageData(out, 0, 0);
    });
  }
  $('edIntensity').addEventListener('input', e => { intensity = +e.target.value; $('edIntensityOut').textContent = intensity + ' %'; scheduleProcess(); });
  $('edIntensity').addEventListener('change', pushHistory);

  // Encuadre
  $$('#edRatios button', root).forEach(b => b.addEventListener('click', () => {
    ratio = b.dataset.ratio === 'free' ? 'free' : +b.dataset.ratio;
    $$('#edRatios button', root).forEach(x => x.setAttribute('aria-pressed', x === b));
    crop = fullCrop(); render();
  }));
  $('edApplyCrop').addEventListener('click', () => {
    if (!crop) return;
    if (Math.round(crop.w) === base.width && Math.round(crop.h) === base.height) return;
    const c = { ...crop };
    transformAll(src => cropCanvas(src, c));
  });
  $('edResetCrop').addEventListener('click', () => { crop = fullCrop(); render(); });
  $('edRotL').addEventListener('click', () => transformAll(s => rotateCanvas(s, -1)));
  $('edRotR').addEventListener('click', () => transformAll(s => rotateCanvas(s, 1)));
  $('edFlipH').addEventListener('click', () => transformAll(s => flipCanvas(s, true)));
  $('edFlipV').addEventListener('click', () => transformAll(s => flipCanvas(s, false)));

  // Historial y comparar
  $('edUndo').addEventListener('click', undo);
  $('edRedo').addEventListener('click', redo);
  const cmp = $('edCompare');
  const cmpOn = e => { e.preventDefault(); showOriginal = true; render(); };
  const cmpOff = () => { if (showOriginal) { showOriginal = false; render(); } };
  cmp.addEventListener('pointerdown', cmpOn);
  ['pointerup', 'pointerleave', 'pointercancel'].forEach(t => cmp.addEventListener(t, cmpOff));
  cmp.addEventListener('contextmenu', e => e.preventDefault());

  // Atajos de teclado: solo con el editor visible y una foto abierta.
  document.addEventListener('keydown', e => {
    if (!activo() || !loaded) return;
    const typing = /^(TEXTAREA|INPUT|SELECT)$/.test(document.activeElement?.tagName) && document.activeElement.type !== 'range';
    const mod = e.ctrlKey || e.metaKey;
    if (e.key === 'Escape') { if (!$('edExportModal').hidden) closeExport(); else if (tool === 'crop') setTool('brush'); return; }
    if (!$('edExportModal').hidden) return;
    if (mod && e.key.toLowerCase() === 'z' && !typing) { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
    if (mod && e.key.toLowerCase() === 'y' && !typing) { e.preventDefault(); redo(); return; }
    if (typing || mod || e.altKey) return;
    const map = { b: 'brush', e: 'eraser', l: 'line', a: 'arrow', r: 'rect', o: 'ellipse', t: 'text', c: 'crop' };
    const t = map[e.key.toLowerCase()];
    if (t) { setTool(t); if (t !== 'crop') setTab('draw', true); }
    if (e.key === 'Enter' && tool === 'crop') $('edApplyCrop').click();
  });

  // ---------- Abrir imagen ----------
  function openFile(file) {
    if (!file || !file.type.startsWith('image/')) { toast('Ese archivo no es una imagen. Prueba con JPG, PNG o WebP.'); return; }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const s = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
      const w = Math.round(img.naturalWidth * s), h = Math.round(img.naturalHeight * s);
      const c = mk(w, h); c.getContext('2d').drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      loadCanvas(c, file.name || 'foto.png');
      $('edStatusTool').textContent = s < 1 ? `Foto reducida a ${w} × ${h} px para editarla con fluidez` : TOOL_HINTS[tool];
    };
    img.onerror = () => { URL.revokeObjectURL(url); toast('No se pudo leer la imagen. Prueba con otro archivo.'); };
    img.src = url;
  }
  function loadCanvas(c, name) {
    Object.keys(adj).forEach(k => adj[k] = 0); filter = 'none'; intensity = 100;
    syncAdjustControls();
    drawLayer = mk(c.width, c.height);
    strokeLayer = mk(c.width, c.height);
    fileName = name;
    $('edFileName').textContent = name;
    $('edDropCard').hidden = true;
    $('edWork').hidden = false;
    loaded = true;
    setBase(c);
    if (tool === 'crop') crop = fullCrop();
    render(); fit(); resetHistory();
  }
  $('edInput').addEventListener('change', e => { openFile(e.target.files[0]); e.target.value = ''; });
  [$('edDrop'), stage].forEach(z => {
    ['dragenter', 'dragover'].forEach(t => z.addEventListener(t, e => { e.preventDefault(); z.classList.add('dragging'); }));
    ['dragleave', 'drop'].forEach(t => z.addEventListener(t, e => { e.preventDefault(); z.classList.remove('dragging'); }));
    z.addEventListener('drop', e => openFile(e.dataTransfer.files[0]));
  });
  document.addEventListener('paste', e => {
    if (!activo()) return;
    const item = [...(e.clipboardData?.items || [])].find(i => i.type.startsWith('image/'));
    if (item) openFile(item.getAsFile());
  });

  // ---------- Guardar / compartir ----------
  let exportUrl = null, exportBlob = null, exportToken = 0;
  const EXT = { jpeg: 'jpg', png: 'png', webp: 'webp' };
  function exportImage() {
    const fmt = $('edExportFormat').value;
    const out = mk(base.width, base.height), c = out.getContext('2d');
    if (fmt === 'jpeg') { c.fillStyle = '#ffffff'; c.fillRect(0, 0, out.width, out.height); }
    c.drawImage(adjCanvas, 0, 0); c.drawImage(drawLayer, 0, 0);
    const token = ++exportToken;
    $('edExportInfo').textContent = 'Preparando…';
    out.toBlob(blob => {
      if (token !== exportToken || !blob) return;
      if (exportUrl) URL.revokeObjectURL(exportUrl);
      exportBlob = blob; exportUrl = URL.createObjectURL(blob);
      const name = baseName(fileName) + '-editada.' + EXT[fmt];
      $('edExportImg').src = exportUrl;
      $('edDownload').href = exportUrl;
      $('edDownload').download = name;
      const kb = Math.round(blob.size / 1024);
      $('edExportInfo').textContent = `${out.width} × ${out.height} · ${kb >= 1024 ? (kb / 1024).toFixed(1) + ' MB' : kb + ' KB'}`;
      const file = new File([blob], name, { type: blob.type });
      $('edShare').hidden = !(navigator.canShare && navigator.canShare({ files: [file] }));
    }, 'image/' + fmt, .92);
  }
  $('edExport').addEventListener('click', () => {
    if (!loaded) return;
    if (tool === 'crop') setTool('brush');
    exportImage(); $('edExportModal').hidden = false; $('edCloseExport').focus();
  });
  $('edExportFormat').addEventListener('change', exportImage);
  $('edShare').addEventListener('click', async () => {
    if (!exportBlob) return;
    const file = new File([exportBlob], $('edDownload').download, { type: exportBlob.type });
    try { await navigator.share({ files: [file], title: file.name }); }
    catch (err) { if (err && err.name !== 'AbortError') toast('No se pudo compartir. Usa Descargar.'); }
  });
  function closeExport() {
    $('edExportModal').hidden = true;
    $('edExportImg').removeAttribute('src');
    if (exportUrl) { URL.revokeObjectURL(exportUrl); exportUrl = null; exportBlob = null; }
  }
  $('edCloseExport').addEventListener('click', closeExport);
  $('edExportModal').addEventListener('click', e => { if (e.target.id === 'edExportModal') closeExport(); });

  setColor(color);
  setTool('brush');
  updateHistoryButtons();
})();
