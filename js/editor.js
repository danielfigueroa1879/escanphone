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
  const FX_TOOLS = ['warp', 'gloss', 'clone', 'blur'];
  const isFx = t => FX_TOOLS.includes(t);

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
  let sel = null, clip = null, piece = null, bgBusy = false;   // copiar y pegar

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
    select: 'Seleccionar · marca una zona, cópiala y pégala donde quieras',
    recolor: 'Cambiar color · toca la prenda u objeto que quieres pintar',
    warp: 'Deformar · mantén presionado para agrandar o reducir, o arrastra para empujar',
    gloss: 'Brillo de piel · pinta sobre la piel para darle brillo',
    clone: 'Tampón de clonar · elige un origen y pinta para copiar esa zona',
    blur: 'Suavizar · pinta para desenfocar o suavizar la piel',
    eyedropper: 'Cuentagotas · toca la foto para tomar ese color',
    hand: 'Mano · arrastra para mover la vista',
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
    if (view.width !== base.width || view.height !== base.height) { view.width = base.width; view.height = base.height; zoom = 1; fit(); }
    vctx.globalAlpha = 1; vctx.globalCompositeOperation = 'source-over';
    vctx.clearRect(0, 0, view.width, view.height);
    if (showOriginal) { vctx.drawImage(base, 0, 0); return; }
    vctx.drawImage(adjCanvas, 0, 0);
    vctx.drawImage(drawLayer, 0, 0);
    if (drawing && tool !== 'eraser') { vctx.globalAlpha = opacity(); vctx.drawImage(strokeLayer, 0, 0); vctx.globalAlpha = 1; }
    if (tool === 'crop' && crop) drawCropOverlay();
    if (piece) drawPiece(vctx, piece.img);
    if (piece || sel) drawSelOverlay(piece || sel);
    if (tool === 'clone' && cloneSrc) drawCloneMarker();
  }

  // La foto se muestra a "tamaño ajustado" (fitW × fitH) y encima se aplica
  // zoom y desplazamiento con transform. Las coordenadas de dibujo salen de
  // getBoundingClientRect, que ya incluye el zoom, así que todo sigue igual.
  let zoom = 1, tx = 0, ty = 0, fitW = 1, fitH = 1;
  function fit() {
    const sw = stage.clientWidth, sh = stage.clientHeight;
    if (sw <= 0 || sh <= 0) return;
    const pad = sw < 600 ? 10 : 16;
    const s = Math.min((sw - pad * 2) / view.width, (sh - pad * 2) / view.height);
    fitW = Math.max(1, Math.floor(view.width * s)); fitH = Math.max(1, Math.floor(view.height * s));
    view.style.width = fitW + 'px'; view.style.height = fitH + 'px';
    applyView();
  }
  const maxZoom = () => Math.max(4, view.width / fitW * 6);
  function applyView() {
    const sw = stage.clientWidth, sh = stage.clientHeight, w = fitW * zoom, h = fitH * zoom, m = 60;
    if (zoom <= 1) { zoom = 1; tx = (sw - w) / 2; ty = (sh - h) / 2; }
    else {
      tx = w <= sw ? (sw - w) / 2 : clamp(tx, sw - w - m, m);
      ty = h <= sh ? (sh - h) / 2 : clamp(ty, sh - h - m, m);
    }
    view.style.transform = `translate(${tx}px, ${ty}px) scale(${zoom})`;
    $('edZoomFit').textContent = Math.round(zoom * 100) + '%';
  }
  function zoomTo(z, cx, cy) {
    const sw = stage.clientWidth, sh = stage.clientHeight;
    if (cx === undefined) { cx = sw / 2; cy = sh / 2; }
    const nz = clamp(z, 1, maxZoom());
    tx = cx - (cx - tx) * nz / zoom; ty = cy - (cy - ty) * nz / zoom;
    zoom = nz; applyView(); requestRender();
  }
  $('edZoomIn').addEventListener('click', () => zoomTo(zoom * 1.5));
  $('edZoomOut').addEventListener('click', () => zoomTo(zoom / 1.5));
  $('edZoomFit').addEventListener('click', () => zoomTo(1));
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
    piece = null; sel = null; updateSelUI();
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

  // ---------- Zoom y desplazamiento ----------
  // Dos dedos: pellizcar para acercar y arrastrar para mover (cancela el
  // trazo que se había empezado con el primer dedo). PC: rueda del mouse o
  // pellizco del trackpad para acercar; barra espaciadora, botón central o la
  // herramienta Mano para mover.
  const touches = new Map();
  let gesture = null, pan = null, spaceDown = false, shiftDown = false;
  const stagePt = e => { const r = stage.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  function cancelStroke() {
    if (pointerId === null) return;
    const mutated = (drawing && tool === 'eraser') || !!fx;
    if (fx) { clearInterval(fx.timer); fx = null; }
    drawing = false; cropMode = null;
    if (selMode === 'new' || selMode === 'lasso') sel = null;
    selMode = null; pointerId = null;
    strokeLayer.getContext('2d').clearRect(0, 0, strokeLayer.width, strokeLayer.height);
    if (mutated) restore(hIndex); else render();
  }
  stage.addEventListener('pointerdown', e => {
    if (e.pointerType === 'touch') touches.set(e.pointerId, stagePt(e));
    if (touches.size === 2) {
      cancelStroke(); ring.hidden = true;
      const [a, b] = [...touches.values()];
      gesture = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2, z: zoom, tx, ty };
      e.stopPropagation();
      return;
    }
    if (gesture) { e.stopPropagation(); return; }
    if (loaded && (tool === 'hand' || spaceDown || e.button === 1)) {
      e.preventDefault(); e.stopPropagation();
      const p = stagePt(e);
      pan = { id: e.pointerId, x: p.x, y: p.y, tx, ty };
      stage.setPointerCapture(e.pointerId); stage.classList.add('panning');
    }
  }, true);
  stage.addEventListener('pointermove', e => {
    if (touches.has(e.pointerId)) touches.set(e.pointerId, stagePt(e));
    if (gesture && touches.size >= 2) {
      const [a, b] = [...touches.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y) || 1, mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      const nz = clamp(gesture.z * d / gesture.d, 1, maxZoom());
      // El punto de la foto que estaba bajo los dedos sigue bajo los dedos.
      tx = mx - (gesture.mx - gesture.tx) * nz / gesture.z;
      ty = my - (gesture.my - gesture.ty) * nz / gesture.z;
      zoom = nz; applyView(); requestRender();
      e.stopPropagation(); return;
    }
    if (pan && e.pointerId === pan.id) {
      const p = stagePt(e);
      tx = pan.tx + p.x - pan.x; ty = pan.ty + p.y - pan.y; applyView();
      e.stopPropagation();
    }
  }, true);
  function stageUp(e) {
    touches.delete(e.pointerId);
    if (gesture) { if (touches.size === 0) gesture = null; e.stopPropagation(); return; }
    if (pan && e.pointerId === pan.id) { pan = null; stage.classList.remove('panning'); e.stopPropagation(); }
  }
  stage.addEventListener('pointerup', stageUp, true);
  stage.addEventListener('pointercancel', stageUp, true);
  stage.addEventListener('wheel', e => {
    if (!loaded) return;
    e.preventDefault();
    const p = stagePt(e);
    const mouseWheel = e.deltaMode === 1 || (e.deltaX === 0 && Math.abs(e.deltaY) >= 40 && Number.isInteger(e.deltaY));
    if (e.ctrlKey || e.metaKey || mouseWheel) zoomTo(zoom * Math.exp(-e.deltaY * (e.ctrlKey ? .01 : .0015)), p.x, p.y);
    else { tx -= e.deltaX; ty -= e.deltaY; applyView(); }
  }, { passive: false });

  view.addEventListener('pointerdown', e => {
    if (!loaded || restoring || showOriginal || pointerId !== null || gesture) return;
    if (e.button !== undefined && e.button > 0) return;
    e.preventDefault();
    const p = toImg(e);
    if (tool === 'eyedropper' || (e.altKey && (tool === 'brush' || isShape(tool) || tool === 'recolor'))) { pickColor(p); return; }
    if (tool === 'clone' && (e.altKey || cloneArm || !cloneSrc)) { setCloneSrc(p); return; }
    if (tool === 'crop') { cropDown(p); pointerId = e.pointerId; view.setPointerCapture(e.pointerId); return; }
    if (tool === 'select') { selDown(p); pointerId = e.pointerId; view.setPointerCapture(e.pointerId); requestRender(); return; }
    if (tool === 'recolor') { recolorAt(p); return; }
    if (isFx(tool)) { fxDown(p); pointerId = e.pointerId; view.setPointerCapture(e.pointerId); return; }
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
    if (tool === 'clone' && cloneSrc) { hoverPt = toImg(e); requestRender(); }
    if (e.pointerId !== pointerId) return;
    const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    if (tool === 'crop') { cropMove(toImg(e)); requestRender(); return; }
    if (tool === 'select') { selMove(toImg(e)); requestRender(); return; }
    if (isFx(tool)) { evs.forEach(ev => fxMove(toImg(ev))); return; }
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
    if (tool === 'select') { selUp(); return; }
    if (isFx(tool)) { fxUp(); return; }
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
    const fxT = isFx(tool);
    if (e.pointerType !== 'mouse' || spaceDown || !(tool === 'brush' || tool === 'eraser' || fxT)) { ring.hidden = true; return; }
    const sr = stage.getBoundingClientRect(), d = fxT ? +$('edFxSize').value : +$('edSize').value;
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

  // ---------- Seleccionar, copiar y pegar ----------
  // La zona se marca como rectángulo, círculo o a mano alzada. Al copiarla se
  // guarda (foto + trazos) recortada con esa forma y fondo transparente, en la
  // tira de «Recortes guardados», que persiste en el dispositivo.
  let selMode = null, selAnchor = null, selOffset = null, selShape = 'rect';
  const roundR = r => ({ x: Math.round(r.x), y: Math.round(r.y), w: Math.max(1, Math.round(r.w)), h: Math.max(1, Math.round(r.h)) });
  function selPath(ctx, z, ox = 0, oy = 0) {
    ctx.beginPath();
    if (z.shape === 'ellipse') ctx.ellipse(z.x + z.w / 2 + ox, z.y + z.h / 2 + oy, z.w / 2, z.h / 2, 0, 0, Math.PI * 2);
    else if (z.shape === 'lasso') { z.pts.forEach((q, i) => i ? ctx.lineTo(q.x + ox, q.y + oy) : ctx.moveTo(q.x + ox, q.y + oy)); ctx.closePath(); }
    else ctx.rect(z.x + ox, z.y + oy, z.w, z.h);
  }
  // Lo pegado se guarda por su centro (cx, cy), tamaño y ángulo, para poder
  // girarlo sobre su propio centro. Los toques se pasan a coordenadas locales
  // de la pieza (sin giro) para saber si se tocó una esquina, el asa o el centro.
  const pieceLocal = p => {
    const dx = p.x - piece.cx, dy = p.y - piece.cy, c = Math.cos(-piece.rot), sn = Math.sin(-piece.rot);
    return { x: dx * c - dy * sn, y: dx * sn + dy * c };
  };
  const pieceWorld = (lx, ly) => {
    const c = Math.cos(piece.rot), sn = Math.sin(piece.rot);
    return { x: piece.cx + lx * c - ly * sn, y: piece.cy + lx * sn + ly * c };
  };
  const rotHandleDist = () => 34 * pxScale();
  function pieceHit(p) {
    const l = pieceLocal(p), tol = 22 * pxScale(), hw = piece.w / 2 * Math.max(.15, Math.abs(Math.cos(piece.spin || 0))), hh = piece.h / 2;
    if (Math.hypot(l.x, l.y + hh + rotHandleDist()) < tol) return 'rotate';
    if ([[-hw, -hh], [hw, -hh], [-hw, hh], [hw, hh]].some(([x, y]) => Math.abs(l.x - x) < tol && Math.abs(l.y - y) < tol)) return 'resize';
    if (Math.abs(l.x) < hw + tol / 2 && Math.abs(l.y) < hh + tol / 2) return 'move';
    return null;
  }
  const degOf = r => ((Math.round(r * 180 / Math.PI) % 360) + 360) % 360;
  function pieceStatus() {
    $('edStatusSize').textContent = `Pegado ${Math.round(piece.w)} × ${Math.round(piece.h)} px · ${degOf(piece.rot)}°` +
      (piece.spin ? ` · 3D ${degOf(piece.spin)}°` : '');
  }
  function selDown(p) {
    if (piece) {
      const h = pieceHit(p);
      if (h === 'rotate') { selMode = 'rotate'; return; }
      if (h === 'resize') { selMode = 'resize'; return; }
      if (h === 'move') { selMode = 'move'; selOffset = { x: p.x - piece.cx, y: p.y - piece.cy }; return; }
      commitPiece();
    }
    const q = { x: clamp(p.x, 0, base.width), y: clamp(p.y, 0, base.height) };
    if (selShape === 'lasso') { selMode = 'lasso'; sel = { shape: 'lasso', pts: [q], x: q.x, y: q.y, w: 0, h: 0 }; }
    else { selMode = 'new'; selAnchor = q; sel = { shape: selShape, x: q.x, y: q.y, w: 0, h: 0 }; }
    updateSelUI();
  }
  function selMove(p) {
    const px = clamp(p.x, 0, base.width), py = clamp(p.y, 0, base.height);
    if (selMode === 'new') {
      sel = { shape: selShape, x: Math.min(px, selAnchor.x), y: Math.min(py, selAnchor.y), w: Math.abs(px - selAnchor.x), h: Math.abs(py - selAnchor.y) };
    } else if (selMode === 'lasso' && sel) {
      const l = sel.pts[sel.pts.length - 1];
      if (Math.hypot(px - l.x, py - l.y) < 2 * pxScale()) return;
      sel.pts.push({ x: px, y: py });
      const xs = sel.pts.map(q => q.x), ys = sel.pts.map(q => q.y);
      sel.x = Math.min(...xs); sel.y = Math.min(...ys); sel.w = Math.max(...xs) - sel.x; sel.h = Math.max(...ys) - sel.y;
    } else if (selMode === 'move' && piece) {
      piece.cx = p.x - selOffset.x; piece.cy = p.y - selOffset.y;
    } else if (selMode === 'resize' && piece) {
      // Se agranda o achica desde el centro, respetando el giro.
      const l = pieceLocal(p);
      let w = Math.max(6, Math.abs(l.x) * 2 / Math.max(.15, Math.abs(Math.cos(piece.spin || 0)))), h = Math.max(6, Math.abs(l.y) * 2);
      if ($('edKeepRatio').checked) { const k = Math.max(w / piece.ow, h / piece.oh); w = piece.ow * k; h = piece.oh * k; }
      piece.w = w; piece.h = h;
    } else if (selMode === 'rotate' && piece) {
      let r = Math.atan2(p.y - piece.cy, p.x - piece.cx) + Math.PI / 2;
      // Imán a 0°, 90°, 180° y 270° (y a cada 15° con Shift en el PC).
      const step = shiftDown ? Math.PI / 12 : Math.PI / 2, snapped = Math.round(r / step) * step;
      if (shiftDown || Math.abs(r - snapped) < 4 * Math.PI / 180) r = snapped;
      piece.rot = r;
    }
    if (piece) pieceStatus();
    else if (sel) $('edStatusSize').textContent = `Zona ${Math.round(sel.w)} × ${Math.round(sel.h)} px`;
  }
  function selUp() {
    if ((selMode === 'new' || selMode === 'lasso') && sel && (sel.w < 4 || sel.h < 4 || (sel.shape === 'lasso' && sel.pts.length < 3))) sel = null;
    selMode = null; updateSelUI(); render();
  }
  function drawPiece(ctx, src) {
    ctx.save();
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    ctx.translate(piece.cx, piece.cy); ctx.rotate(piece.rot);
    ctx.scale(piece.flip ? -1 : 1, piece.flipV ? -1 : 1);
    if (Math.abs(Math.sin(piece.spin || 0)) < 1e-3 && Math.cos(piece.spin || 0) > 0) ctx.drawImage(src, -piece.w / 2, -piece.h / 2, piece.w, piece.h);
    else drawSpin3D(ctx, src, piece.w, piece.h, piece.spin);
    ctx.restore();
  }
  // Giro 3D sobre el eje vertical (en profundidad), con perspectiva. Cada
  // columna de la imagen sigue siendo vertical al girar sobre ese eje, así que
  // se dibuja por franjas: posición x y altura según su profundidad.
  const spinFocal = (w, h) => Math.max(w, h) * 2.2;
  function spinProject(u, v, w, h, a) {
    const f = spinFocal(w, h), k = f / (f + u * Math.sin(a));
    return { x: u * Math.cos(a) * k, y: v * k };
  }
  let spinTmp = null;
  function drawSpin3D(ctx, src, w, h, a) {
    // Se dibuja en un lienzo aparte para que la sombra solo toque la pieza
    // (y no el fondo que se ve por sus partes transparentes).
    const f = spinFocal(w, h), kmax = f / (f - w / 2);
    const TW = Math.ceil(w * kmax) + 4, TH = Math.ceil(h * kmax) + 4;
    if (!spinTmp || spinTmp.width < TW || spinTmp.height < TH) spinTmp = mk(Math.max(TW, spinTmp ? spinTmp.width : 0), Math.max(TH, spinTmp ? spinTmp.height : 0));
    const tc = spinTmp.getContext('2d');
    tc.setTransform(1, 0, 0, 1, 0, 0); tc.globalCompositeOperation = 'source-over';
    tc.clearRect(0, 0, TW, TH);
    tc.imageSmoothingEnabled = true; tc.imageSmoothingQuality = 'high';
    tc.translate(TW / 2, TH / 2);
    const n = Math.max(2, Math.min(src.width, 420)), sw = src.width / n, cs = Math.cos(a);
    for (let i = 0; i < n; i++) {
      const u0 = -w / 2 + w * i / n, u1 = -w / 2 + w * (i + 1) / n;
      const p0 = spinProject(u0, 0, w, h, a), p1 = spinProject(u1, 0, w, h, a);
      const k = spinProject((u0 + u1) / 2, h / 2, w, h, a).y / (h / 2);
      const x = Math.min(p0.x, p1.x), dw = Math.abs(p1.x - p0.x) + .7, dh = h * k;
      if (dw < .05) continue;
      tc.drawImage(src, i * sw, 0, sw, src.height, x, -dh / 2, dw, dh);
    }
    // Sombra suave según el ángulo: da sensación de volumen al girar.
    const shade = (1 - Math.abs(cs)) * .35;
    if (shade > .01) {
      tc.globalCompositeOperation = 'source-atop';
      tc.fillStyle = `rgba(0,0,0,${shade})`; tc.fillRect(-TW / 2, -TH / 2, TW, TH);
      tc.globalCompositeOperation = 'source-over';
    }
    ctx.drawImage(spinTmp, 0, 0, TW, TH, -TW / 2, -TH / 2, TW, TH);
  }
  function spinCorners(w, h, a) {
    return [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]].map(([u, v]) => spinProject(u, v, w, h, a));
  }
  function drawSelOverlay(z) {
    const s = pxScale();
    vctx.save();
    vctx.lineWidth = 1.5 * s;
    vctx.setLineDash([6 * s, 4 * s]);
    const hw = piece ? piece.w / 2 : 0, hh = piece ? piece.h / 2 : 0, rd = piece ? rotHandleDist() : 0;
    const fl = piece ? [piece.flip ? -1 : 1, piece.flipV ? -1 : 1] : [1, 1];
    const corners = piece ? spinCorners(piece.w, piece.h, piece.spin || 0).map(q => pieceWorld(q.x * fl[0], q.y * fl[1])) : [];
    const outline = () => {
      if (!piece) { selPath(vctx, z); return; }
      vctx.beginPath(); corners.forEach((q, i) => i ? vctx.lineTo(q.x, q.y) : vctx.moveTo(q.x, q.y)); vctx.closePath();
    };
    vctx.strokeStyle = '#000'; outline(); vctx.stroke();
    vctx.lineDashOffset = 6 * s; vctx.strokeStyle = '#fff'; outline(); vctx.stroke();
    if (piece) {
      // Asa de giro: una línea desde el borde superior hasta un círculo.
      const top = pieceWorld(0, -hh), knob = pieceWorld(0, -hh - rd);
      vctx.setLineDash([]); vctx.lineWidth = 1.5 * s; vctx.strokeStyle = '#fff';
      vctx.beginPath(); vctx.moveTo(top.x, top.y); vctx.lineTo(knob.x, knob.y); vctx.stroke();
      vctx.fillStyle = '#fff'; vctx.strokeStyle = '#000'; vctx.lineWidth = 1 * s;
      vctx.beginPath(); vctx.arc(knob.x, knob.y, 9 * s, 0, Math.PI * 2); vctx.fill(); vctx.stroke();
      vctx.beginPath(); vctx.arc(knob.x, knob.y, 4.5 * s, -Math.PI * .9, Math.PI * .5); vctx.stroke();
      const hs = 14 * s;
      corners.forEach(q => { vctx.fillRect(q.x - hs / 2, q.y - hs / 2, hs, hs); vctx.strokeRect(q.x - hs / 2, q.y - hs / 2, hs, hs); });
    }
    vctx.restore();
  }
  function copySel() {
    if (!sel) { toast('Primero marca la zona que quieres copiar.'); return; }
    commitPiece();
    const r = roundR(sel), img = mk(r.w, r.h), c = img.getContext('2d');
    c.drawImage(base, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
    c.drawImage(drawLayer, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
    if (sel.shape !== 'rect') { c.globalCompositeOperation = 'destination-in'; selPath(c, sel, -r.x, -r.y); c.fill(); }
    addClip(img, r.x, r.y);
    toast('Zona copiada y guardada en «Recortes guardados».');
  }
  function pasteClip() {
    if (!clip) return;
    if (!loaded) { toast('Primero abre una foto para pegar el recorte.'); return; }
    if (tool !== 'select') { setTool('select'); setTab('draw', true); }
    commitPiece();
    let w = clip.img.width, h = clip.img.height;
    // Si el recorte es más grande que la foto, se achica para que quepa.
    const k = Math.min(1, base.width * .9 / w, base.height * .9 / h); w *= k; h *= k;
    const off = Math.round(Math.min(base.width, base.height) * 0.05);
    const x = clamp(clip.x + off, 0, Math.max(0, base.width - w)), y = clamp(clip.y + off, 0, Math.max(0, base.height - h));
    piece = { img: clip.img, cx: x + w / 2, cy: y + h / 2, w, h, ow: w, oh: h, rot: 0, spin: 0, flip: false, flipV: false };
    syncSpinUI();
    sel = null; updateSelUI(); render();
    $('edStatusTool').textContent = 'Arrastra para mover, las esquinas para el tamaño y el círculo de arriba para girar';
    pieceStatus();
  }
  function commitPiece() {
    if (!piece) return;
    stopSpin();
    const nb = mk(base.width, base.height), c = nb.getContext('2d');
    c.drawImage(base, 0, 0);
    drawPiece(c, piece.img);
    piece = null; updateSelUI();
    setBase(nb); pushHistory(); render();
  }
  function discardPiece() { stopSpin(); piece = null; updateSelUI(); render(); }

  // ---------- Giro 3D: control, animación y video ----------
  let spinAnim = null, spinDir = -1, recording = false;
  const TURN_SECONDS = 3;   // una vuelta completa cada 3 s
  const wrapAngle = a => Math.atan2(Math.sin(a), Math.cos(a));
  function syncSpinUI() {
    if (!piece) return;
    const d = Math.round(wrapAngle(piece.spin) * 180 / Math.PI);
    $('edSpin').value = d; $('edSpinOut').textContent = d + '°';
    $('edSpinL').textContent = spinAnim && spinAnim.dir < 0 ? '■ Detener' : '⟲ Animar izquierda';
    $('edSpinR').textContent = spinAnim && spinAnim.dir > 0 ? '■ Detener' : 'Animar derecha ⟳';
  }
  function startSpin(dir) {
    if (!piece) return;
    if (spinAnim && spinAnim.dir === dir) { stopSpin(); return; }
    stopSpin(); spinDir = dir;
    spinAnim = { dir, last: performance.now(), raf: 0 };
    const tick = t => {
      if (!spinAnim) return;
      if (!piece) { stopSpin(); return; }
      const dt = Math.min(.1, (t - spinAnim.last) / 1000); spinAnim.last = t;
      piece.spin = wrapAngle(piece.spin + spinAnim.dir * dt * Math.PI * 2 / TURN_SECONDS);
      syncSpinUI(); pieceStatus(); render();
      spinAnim.raf = requestAnimationFrame(tick);
    };
    spinAnim.raf = requestAnimationFrame(tick);
    syncSpinUI();
  }
  function stopSpin() {
    if (!spinAnim) return;
    cancelAnimationFrame(spinAnim.raf); spinAnim = null; syncSpinUI();
  }
  $('edSpin').addEventListener('input', e => {
    if (!piece) return;
    stopSpin(); piece.spin = +e.target.value * Math.PI / 180;
    $('edSpinOut').textContent = e.target.value + '°'; pieceStatus(); render();
  });
  $('edSpin').addEventListener('dblclick', () => { if (piece) { piece.spin = 0; syncSpinUI(); pieceStatus(); render(); } });
  $('edSpinL').addEventListener('click', () => startSpin(-1));
  $('edSpinR').addEventListener('click', () => startSpin(1));

  // Graba 2 vueltas completas de la foto con la pieza girando, en el
  // sentido de la última animación (izquierda por defecto).
  $('edSpinVideo').addEventListener('click', async () => {
    if (!piece || recording) return;
    const btn = $('edSpinVideo');
    if (!window.MediaRecorder || !HTMLCanvasElement.prototype.captureStream) { toast('Este navegador no puede grabar video.'); return; }
    // MP4 con H.264 primero (se reproduce en iPhone y WhatsApp); si no, WebM.
    const types = ['video/mp4;codecs=avc1.42E01E', 'video/mp4;codecs=avc1', 'video/webm;codecs=vp9', 'video/webm', 'video/mp4'];
    const mime = types.find(t => MediaRecorder.isTypeSupported(t)) || '';
    stopSpin(); recording = true; btn.disabled = true;
    try {
      const k = Math.min(1, 1280 / Math.max(base.width, base.height));
      const W = Math.round(base.width * k / 2) * 2, H = Math.round(base.height * k / 2) * 2;
      const out = mk(W, H), oc = out.getContext('2d');
      const rec = new MediaRecorder(out.captureStream(30), mime ? { mimeType: mime, videoBitsPerSecond: 8e6 } : undefined);
      const chunks = [];
      rec.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data); };
      const stopped = new Promise(r => { rec.onstop = r; });
      const s0 = piece.spin, turns = 2, dur = TURN_SECONDS * turns * 1000;
      const frame = a => {
        oc.setTransform(1, 0, 0, 1, 0, 0); oc.fillStyle = '#fff'; oc.fillRect(0, 0, W, H);
        oc.setTransform(W / base.width, 0, 0, H / base.height, 0, 0);
        oc.drawImage(adjCanvas, 0, 0); oc.drawImage(drawLayer, 0, 0);
        const keep = piece.spin; piece.spin = a; drawPiece(oc, piece.img); piece.spin = keep;
      };
      frame(s0);
      rec.start(200);
      const t0 = performance.now();
      await new Promise(res => {
        const step = t => {
          const f = Math.min(1, (t - t0) / dur);
          frame(s0 + spinDir * Math.PI * 2 * turns * f);
          btn.textContent = `Grabando… ${Math.round(f * 100)} %`;
          if (f < 1 && piece) requestAnimationFrame(step); else res();
        };
        requestAnimationFrame(step);
      });
      rec.stop(); await stopped;
      const type = rec.mimeType || mime || 'video/webm';
      const blob = new Blob(chunks, { type }), ext = /mp4/.test(type) ? 'mp4' : 'webm';
      const url = URL.createObjectURL(blob), a = document.createElement('a');
      a.href = url; a.download = baseName(fileName) + '-giro-3d.' + ext;
      document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      toast(`Video guardado (${ext.toUpperCase()}, ${(blob.size / 1048576).toFixed(1)} MB).`);
    } catch (err) {
      console.error(err); toast('No se pudo grabar el video: ' + (err.message || err));
    } finally {
      recording = false; btn.disabled = false; btn.textContent = '🎬 Guardar video del giro';
    }
  });
  function updateSelUI() {
    $('edCopy').disabled = !sel;
    $('edPaste').disabled = !clip;
    $('edPieceRow').hidden = !piece;
    $('edSelHint').textContent = piece
      ? 'Mueve lo pegado, arrastra sus esquinas para cambiar el tamaño y el círculo de arriba para girarlo. Con «Giro 3D» gira en profundidad sobre su centro. Luego pulsa «Fijar aquí».'
      : sel ? 'Zona marcada. Pulsa «Copiar zona» y luego «Pegar» o toca su recorte guardado.'
      : selShape === 'lasso' ? 'Dibuja con el dedo o el mouse el contorno de lo que quieres copiar.'
      : 'Arrastra sobre la foto para marcar la zona que quieres copiar.';
  }
  $$('[data-shape]', root).forEach(b => b.addEventListener('click', () => {
    selShape = b.dataset.shape;
    $$('[data-shape]', root).forEach(x => x.setAttribute('aria-pressed', x === b));
    sel = null; updateSelUI(); render();
  }));
  $('edCopy').addEventListener('click', copySel);
  $('edPaste').addEventListener('click', pasteClip);
  $('edPieceApply').addEventListener('click', commitPiece);
  $('edPieceCancel').addEventListener('click', discardPiece);
  $('edPieceFlip').addEventListener('click', () => { if (piece) { piece.flip = !piece.flip; render(); } });
  $('edPieceFlipV').addEventListener('click', () => { if (piece) { piece.flipV = !piece.flipV; render(); } });
  $('edPieceRot').addEventListener('click', () => {
    if (!piece) return;
    piece.rot = Math.round((piece.rot + Math.PI / 2) / (Math.PI / 2)) * (Math.PI / 2);
    pieceStatus(); render();
  });

  // ---------- Recortes guardados (IndexedDB, solo en este dispositivo) ----------
  const MAX_CLIPS = 40;
  let clips = [];
  const clipDB = (() => {
    let dbp = null;
    const open = () => dbp || (dbp = new Promise((res, rej) => {
      const r = indexedDB.open('editorFotos', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('recortes', { keyPath: 'id' });
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    }));
    const run = async (mode, fn) => {
      const db = await open();
      return new Promise((res, rej) => {
        const t = db.transaction('recortes', mode), req = fn(t.objectStore('recortes'));
        t.oncomplete = () => res(req && req.result); t.onerror = () => rej(t.error);
      });
    };
    return {
      all: () => run('readonly', st => st.getAll()),
      put: v => run('readwrite', st => st.put(v)),
      del: id => run('readwrite', st => st.delete(id))
    };
  })();
  function addClip(img, x, y, save = true, id = null, t = Date.now()) {
    const item = { id: id || 'c' + t + Math.random().toString(36).slice(2, 7), img, x, y, t };
    clips.unshift(item); clip = item;
    while (clips.length > MAX_CLIPS) { const old = clips.pop(); clipDB.del(old.id).catch(() => {}); }
    if (save) img.toBlob(blob => { if (blob) clipDB.put({ id: item.id, blob, x, y, t }).catch(() => {}); }, 'image/png');
    renderClips(); updateSelUI();
  }
  function removeClip(item) {
    clips = clips.filter(c => c !== item);
    if (clip === item) clip = clips[0] || null;
    clipDB.del(item.id).catch(() => {});
    renderClips(); updateSelUI();
  }
  function renderClips() {
    const wrap = $('edClips');
    wrap.innerHTML = '';
    const add = document.createElement('button');
    add.type = 'button'; add.className = 'ed-clip-add'; add.textContent = '＋'; add.title = 'Agregar una imagen como recorte';
    add.addEventListener('click', () => $('edClipInput').click());
    wrap.append(add);
    clips.forEach(item => {
      const el = document.createElement('div');
      el.className = 'ed-clip' + (item === clip ? ' active' : '');
      const main = document.createElement('button');
      main.type = 'button'; main.className = 'ed-clip-main'; main.title = 'Pegar este recorte';
      const th = mk(1, 1), s = Math.min(1, 66 / Math.max(item.img.width, item.img.height));
      th.width = Math.max(1, Math.round(item.img.width * s)); th.height = Math.max(1, Math.round(item.img.height * s));
      th.getContext('2d').drawImage(item.img, 0, 0, th.width, th.height);
      main.append(th);
      main.addEventListener('click', () => { clip = item; renderClips(); pasteClip(); });
      const del = document.createElement('button');
      del.type = 'button'; del.className = 'ed-clip-del'; del.textContent = '✕'; del.setAttribute('aria-label', 'Eliminar recorte');
      del.addEventListener('click', () => removeClip(item));
      el.append(main, del);
      wrap.append(el);
    });
    $('edClipCount').textContent = clips.length ? clips.length : '';
  }
  $('edClipInput').addEventListener('change', e => {
    [...e.target.files].filter(f => f.type.startsWith('image/')).forEach(f => {
      createImageBitmap(f).then(bmp => {
        const s = Math.min(1, 1200 / Math.max(bmp.width, bmp.height));
        const c = mk(Math.round(bmp.width * s), Math.round(bmp.height * s));
        c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
        addClip(c, 0, 0);
      }).catch(() => toast('No se pudo leer esa imagen.'));
    });
    e.target.value = '';
  });
  (async () => {
    try {
      const rows = (await clipDB.all()) || [];
      rows.sort((a, b) => a.t - b.t);
      for (const r of rows) {
        const bmp = await createImageBitmap(r.blob), c = mk(bmp.width, bmp.height);
        c.getContext('2d').drawImage(bmp, 0, 0);
        addClip(c, r.x, r.y, false, r.id, r.t);
      }
    } catch (_) { /* sin IndexedDB: los recortes solo duran mientras la app esté abierta */ }
    renderClips(); updateSelUI();
  })();

  // ---------- Cambiar color (ropa u objetos) ----------
  // Varita mágica desde el punto tocado (compara tono más que luz, para
  // abarcar sombras y arrugas) y recoloreo que conserva el sombreado.
  function rgb2hsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
    if (mx === mn) return [0, 0, l];
    const d = mx - mn, s = l > .5 ? d / (2 - mx - mn) : d / (mx + mn);
    const h = mx === r ? ((g - b) / d + (g < b ? 6 : 0)) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return [h / 6, s, l];
  }
  function hue2rgb(p, q, t) {
    if (t < 0) t += 1; if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  }
  function hsl2rgb(h, s, l) {
    if (!s) return [l * 255, l * 255, l * 255];
    const q = l < .5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
    return [hue2rgb(p, q, h + 1 / 3) * 255, hue2rgb(p, q, h) * 255, hue2rgb(p, q, h - 1 / 3) * 255];
  }
  function recolorAt(pt) {
    const W = base.width, H = base.height, x0 = Math.floor(pt.x), y0 = Math.floor(pt.y);
    if (x0 < 0 || y0 < 0 || x0 >= W || y0 >= H) return;
    const d = baseData.data;
    if (d[(y0 * W + x0) * 4 + 3] < 10) { toast('Ahí no hay nada que pintar.'); return; }
    // Color de referencia: promedio de 5×5 alrededor del toque.
    let sr = 0, sg = 0, sb = 0, n = 0;
    for (let y = Math.max(0, y0 - 2); y <= Math.min(H - 1, y0 + 2); y++)
      for (let x = Math.max(0, x0 - 2); x <= Math.min(W - 1, x0 + 2); x++) { const i = (y * W + x) * 4; sr += d[i]; sg += d[i + 1]; sb += d[i + 2]; n++; }
    sr /= n; sg /= n; sb /= n;
    const sY = .299 * sr + .587 * sg + .114 * sb, sCb = sb - sY, sCr = sr - sY;
    const T = +$('edTol').value * 1.3;
    const weight = new Float32Array(W * H);
    const seen = new Uint8Array(W * H);
    const stack = new Int32Array(W * H);
    let top = 0, count = 0, sumL = 0;
    stack[top++] = y0 * W + x0; seen[y0 * W + x0] = 1;
    while (top) {
      const k = stack[--top], i = k * 4;
      if (d[i + 3] < 10) continue;
      const r = d[i], g = d[i + 1], b = d[i + 2], Y = .299 * r + .587 * g + .114 * b;
      const dc = Math.hypot((b - Y) - sCb, (r - Y) - sCr, (Y - sY) * .35);
      if (dc > T) continue;
      weight[k] = dc <= T * .7 ? 1 : (T - dc) / (T * .3);
      count++; sumL += (Math.max(r, g, b) + Math.min(r, g, b)) / 510;
      const x = k % W, y = (k - x) / W;
      if (x > 0 && !seen[k - 1]) { seen[k - 1] = 1; stack[top++] = k - 1; }
      if (x < W - 1 && !seen[k + 1]) { seen[k + 1] = 1; stack[top++] = k + 1; }
      if (y > 0 && !seen[k - W]) { seen[k - W] = 1; stack[top++] = k - W; }
      if (y < H - 1 && !seen[k + W]) { seen[k + W] = 1; stack[top++] = k + W; }
    }
    if (count < 4) return;
    const n2 = parseInt(color.slice(1), 16);
    const [th, ts, tl0] = rgb2hsl(n2 >> 16, (n2 >> 8) & 255, n2 & 255);
    const tl = clamp(tl0, .08, .92), mL = clamp(sumL / count, .02, .98);
    const nb = mk(W, H), nctx = nb.getContext('2d');
    const out = new ImageData(new Uint8ClampedArray(d), W, H), o = out.data;
    for (let k = 0; k < W * H; k++) {
      const w = weight[k];
      if (!w) continue;
      const i = k * 4, [, , l] = rgb2hsl(d[i], d[i + 1], d[i + 2]);
      const nl = tl >= mL ? 1 - (1 - l) * (1 - tl) / (1 - mL) : l * tl / mL;
      const [r, g, b] = hsl2rgb(th, ts, clamp(nl, 0, 1));
      o[i] = d[i] + (r - d[i]) * w; o[i + 1] = d[i + 1] + (g - d[i + 1]) * w; o[i + 2] = d[i + 2] + (b - d[i + 2]) * w;
    }
    nctx.putImageData(out, 0, 0);
    setBase(nb); pushHistory(); render();
  }
  $('edTol').addEventListener('input', e => $('edTolOut').textContent = e.target.value);

  // ---------- Quitar fondo (reutiliza la IA de la herramienta «Quitar fondo») ----------
  $('edRemoveBg').addEventListener('click', async () => {
    if (!loaded || bgBusy) return;
    if (typeof window.quitarFondoBlob !== 'function') { toast('El removedor de fondo no está disponible.'); return; }
    commitPiece();
    const src = base, status = $('edBgStatus'), btn = $('edRemoveBg');
    bgBusy = true; btn.disabled = true; status.textContent = 'Cargando modelo de IA…';
    try {
      const blob = await new Promise(res => src.toBlob(res, 'image/png'));
      const out = await window.quitarFondoBlob(blob, (key, cur, tot) => {
        const pct = tot ? Math.round(cur / tot * 100) : null;
        status.textContent = (/fetch/i.test(key || '') ? 'Descargando modelo… ' : 'Quitando el fondo… ') + (pct != null ? pct + ' %' : '');
      });
      if (base !== src) { status.textContent = 'La foto cambió mientras se procesaba. Vuelve a intentarlo.'; return; }
      const bmp = await createImageBitmap(out);
      const nb = mk(src.width, src.height);
      nb.getContext('2d').drawImage(bmp, 0, 0, src.width, src.height);
      setBase(nb); pushHistory(); render();
      $('edExportFormat').value = 'png';
      status.textContent = '¡Listo! Guárdala en PNG para mantener el fondo transparente.';
    } catch (err) {
      console.error(err);
      status.textContent = 'Error: ' + (err.message || err);
    } finally {
      bgBusy = false; btn.disabled = false;
    }
  });

  // ---------- Deformar y Brillo de piel ----------
  // Ambas trabajan directo sobre los píxeles de la foto. Al empezar el trazo
  // se crea una copia nueva de la foto (el historial conserva la anterior).
  let fx = null, warpMode = 'bloat';
  const FX_HINTS = {
    bloat: 'Mantén presionado sobre una zona para agrandarla (p. ej. gemelos o sóleo). Cuanto más tiempo, más crece.',
    pinch: 'Mantén presionado sobre una zona para reducirla (p. ej. marcar la cintura).',
    push: 'Arrastra para empujar la silueta en esa dirección y moldear el contorno.',
    gloss: 'Pinta sobre la piel de piernas y pies para darle un brillo intenso, tipo aceite. Repite el trazo para más brillo.',
    clone: 'Toca «Elegir origen» y luego la zona que quieres copiar (en PC: Alt+clic). Después pinta donde quieras que aparezca. Sirve para borrar objetos o defectos.',
    blur: 'Pinta para suavizar: alisa la piel, quita grano o desenfoca el fondo. Repite el trazo para más efecto.'
  };
  let cloneSrc = null, cloneOff = null, cloneArm = false, hoverPt = null;
  function setCloneSrc(p) {
    cloneSrc = p; cloneOff = null; cloneArm = false;
    $('edCloneSrc').textContent = '📍 Elegir origen';
    toast('Origen fijado. Ahora pinta donde quieras copiarlo.');
    render();
  }
  $('edCloneSrc').addEventListener('click', () => {
    cloneArm = !cloneArm;
    $('edCloneSrc').textContent = cloneArm ? 'Toca la foto para elegir el origen…' : '📍 Elegir origen';
  });
  function drawCloneMarker() {
    const s = pxScale(), at = fx && cloneOff ? { x: fx.last.x + cloneOff.x, y: fx.last.y + cloneOff.y }
      : cloneOff && hoverPt ? { x: hoverPt.x + cloneOff.x, y: hoverPt.y + cloneOff.y } : cloneSrc;
    const r = fxRadius();
    vctx.save();
    vctx.lineWidth = 1.5 * s;
    [['#000', 0], ['#fff', 1.5 * s]].forEach(([c, o]) => {
      vctx.strokeStyle = c; vctx.beginPath(); vctx.arc(at.x, at.y, Math.max(r - o, 2), 0, Math.PI * 2);
      vctx.moveTo(at.x - 8 * s, at.y); vctx.lineTo(at.x + 8 * s, at.y); vctx.moveTo(at.x, at.y - 8 * s); vctx.lineTo(at.x, at.y + 8 * s);
      vctx.stroke();
    });
    vctx.restore();
  }
  function fxDown(p) {
    const W = base.width, H = base.height;
    const nb = mk(W, H), ctx = nb.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(base, 0, 0);
    base = nb; baseData = ctx.getImageData(0, 0, W, H);
    fx = { ctx, last: p, orig: null, mask: null, timer: null };
    if (tool !== 'warp') { fx.orig = new Uint8ClampedArray(baseData.data); fx.mask = new Float32Array(W * H); }
    if (tool === 'clone' && !cloneOff) cloneOff = { x: cloneSrc.x - p.x, y: cloneSrc.y - p.y };
    fxDab(p, p);
    if (tool === 'warp' && warpMode !== 'push') fx.timer = setInterval(() => fxDab(fx.last, fx.last), 50);
  }
  function fxMove(p) {
    if (!fx) return;
    const R = fxRadius(), a = fx.last, dist = Math.hypot(p.x - a.x, p.y - a.y);
    if (tool === 'warp' && warpMode !== 'push') { fx.last = p; if (dist > R / 4) fxDab(p, p); return; }
    const step = Math.max(1, R / 4), n = Math.ceil(dist / step);
    for (let i = 1; i <= n; i++) {
      const q = { x: a.x + (p.x - a.x) * i / n, y: a.y + (p.y - a.y) * i / n };
      fxDab(fx.last, q); fx.last = q;
    }
  }
  function fxUp() {
    if (!fx) return;
    clearInterval(fx.timer); fx = null;
    buildFilterThumbs(); pushHistory(); render();
  }
  const fxRadius = () => +$('edFxSize').value / 2 * pxScale();
  function fxDab(from, c) {
    const W = base.width, H = base.height, R = fxRadius(), k = +$('edFxStrength').value / 100;
    const x0 = Math.max(0, Math.floor(c.x - R)), y0 = Math.max(0, Math.floor(c.y - R));
    const x1 = Math.min(W, Math.ceil(c.x + R)), y1 = Math.min(H, Math.ceil(c.y + R));
    const bw = x1 - x0, bh = y1 - y0;
    if (bw <= 0 || bh <= 0) return;
    const d = baseData.data, R2 = R * R;
    if (tool === 'clone') {
      // Copia desde el origen (foto al empezar el trazo) con borde suave.
      const ox = Math.round(cloneOff.x), oy = Math.round(cloneOff.y), o = fx.orig;
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
        const sx = x + ox, sy = y + oy;
        if (sx < 0 || sy < 0 || sx >= W || sy >= H) continue;
        const r = Math.sqrt((x - c.x) * (x - c.x) + (y - c.y) * (y - c.y));
        if (r >= R) continue;
        const j = y * W + x, f = Math.min(1, (1 - r / R) * 2.5) * k;
        if (f <= fx.mask[j]) continue;
        fx.mask[j] = f;
        const i = j * 4, si = (sy * W + sx) * 4;
        for (let ch = 0; ch < 4; ch++) d[i + ch] = o[i + ch] + (o[si + ch] - o[i + ch]) * f;
      }
    } else if (tool === 'blur') {
      // Desenfoque de caja (imagen integral) sobre la foto al empezar el trazo.
      const rad = Math.max(1, Math.round(R * (.04 + .14 * k))), o = fx.orig;
      const ax0 = Math.max(0, x0 - rad), ay0 = Math.max(0, y0 - rad), ax1 = Math.min(W, x1 + rad), ay1 = Math.min(H, y1 + rad);
      const aw = ax1 - ax0, ah = ay1 - ay0, sum = new Float64Array((aw + 1) * (ah + 1) * 4);
      for (let y = 0; y < ah; y++) {
        const rs = [0, 0, 0, 0];
        for (let x = 0; x < aw; x++) {
          const i = ((ay0 + y) * W + ax0 + x) * 4, si = ((y + 1) * (aw + 1) + x + 1) * 4, up = (y * (aw + 1) + x + 1) * 4;
          for (let ch = 0; ch < 4; ch++) { rs[ch] += o[i + ch]; sum[si + ch] = sum[up + ch] + rs[ch]; }
        }
      }
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
        const r2 = (x - c.x) * (x - c.x) + (y - c.y) * (y - c.y);
        if (r2 >= R2) continue;
        const j = y * W + x, f = (1 - r2 / R2) ** 1.5 * (.5 + .5 * k);
        if (f <= fx.mask[j]) continue;
        fx.mask[j] = f;
        const bx0 = Math.max(ax0, x - rad) - ax0, by0 = Math.max(ay0, y - rad) - ay0;
        const bx1 = Math.min(ax1, x + rad + 1) - ax0, by1 = Math.min(ay1, y + rad + 1) - ay0;
        const n = (bx1 - bx0) * (by1 - by0), i = j * 4;
        const A = (by0 * (aw + 1) + bx0) * 4, B = (by0 * (aw + 1) + bx1) * 4, C = (by1 * (aw + 1) + bx0) * 4, D = (by1 * (aw + 1) + bx1) * 4;
        for (let ch = 0; ch < 4; ch++) {
          const avg = (sum[D + ch] - sum[B + ch] - sum[C + ch] + sum[A + ch]) / n;
          d[i + ch] = o[i + ch] + (avg - o[i + ch]) * f;
        }
      }
    } else if (tool === 'gloss') {
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
        const r2 = (x - c.x) * (x - c.x) + (y - c.y) * (y - c.y);
        if (r2 >= R2) continue;
        const j = y * W + x, f = (1 - r2 / R2) ** 2;
        if (f <= fx.mask[j]) continue;
        fx.mask[j] = f;
        // Brillo especular: las zonas claras suben mucho más que las oscuras,
        // así se marca el volumen y la piel se ve húmeda / con aceite.
        const i = j * 4, o = fx.orig, L = (.299 * o[i] + .587 * o[i + 1] + .114 * o[i + 2]) / 255;
        // Solo zonas con color (piel); respeta fondos grises, blancos o negros.
        const mx = Math.max(o[i], o[i + 1], o[i + 2]), mn = Math.min(o[i], o[i + 1], o[i + 2]);
        const skin = clamp(((mx - mn) / Math.max(mx, 1) - .1) / .15, 0, 1);
        const g = k * f * skin * (.18 + 1.25 * L * L * L);
        for (let ch = 0; ch < 3; ch++) d[i + ch] = o[i + ch] + (255 - o[i + ch]) * g;
      }
    } else {
      // Copia de la zona antes del toque, para leer de ella mientras se escribe.
      const tmp = new Uint8ClampedArray(bw * bh * 4);
      for (let y = 0; y < bh; y++) tmp.set(d.subarray(((y0 + y) * W + x0) * 4, ((y0 + y) * W + x1) * 4), y * bw * 4);
      const dx = c.x - from.x, dy = c.y - from.y;
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
        const r2 = (x - c.x) * (x - c.x) + (y - c.y) * (y - c.y);
        if (r2 >= R2) continue;
        const f = (1 - r2 / R2) ** 2;
        let sx, sy;
        if (warpMode === 'push') { sx = x - dx * f * k * 1.4; sy = y - dy * f * k * 1.4; }
        else {
          const a = (warpMode === 'bloat' ? -1 : 1) * .12 * k * f;
          sx = c.x + (x - c.x) * (1 + a); sy = c.y + (y - c.y) * (1 + a);
        }
        // Muestreo bilineal dentro de la copia.
        sx = clamp(sx - x0, 0, bw - 1.001); sy = clamp(sy - y0, 0, bh - 1.001);
        const ix = sx | 0, iy = sy | 0, fx1 = sx - ix, fy1 = sy - iy;
        const i00 = (iy * bw + ix) * 4, i10 = i00 + 4, i01 = i00 + bw * 4, i11 = i01 + 4;
        const i = (y * W + x) * 4;
        for (let ch = 0; ch < 4; ch++) {
          const top = tmp[i00 + ch] + (tmp[i10 + ch] - tmp[i00 + ch]) * fx1;
          const bot = tmp[i01 + ch] + (tmp[i11 + ch] - tmp[i01 + ch]) * fx1;
          d[i + ch] = top + (bot - top) * fy1;
        }
      }
    }
    fx.ctx.putImageData(baseData, 0, 0, x0, y0, bw, bh);
    scheduleProcess();
  }
  $$('[data-warp]', root).forEach(b => b.addEventListener('click', () => {
    warpMode = b.dataset.warp;
    $$('[data-warp]', root).forEach(x => x.setAttribute('aria-pressed', x === b));
    $('edFxHint').textContent = FX_HINTS[warpMode];
  }));
  $('edFxSize').addEventListener('input', e => $('edFxSizeOut').textContent = e.target.value + ' px');
  // Cada herramienta recuerda su propia intensidad (el tampón parte al 100 %).
  const fxStrength = { warp: 50, gloss: 50, clone: 100, blur: 60 };
  $('edFxStrength').addEventListener('input', e => {
    $('edFxStrengthOut').textContent = e.target.value + ' %';
    if (isFx(tool)) fxStrength[tool] = +e.target.value;
  });

  // ---------- Cuentagotas ----------
  let prevTool = 'brush';
  const isShape = t => ['line', 'arrow', 'rect', 'ellipse', 'text'].includes(t);
  function pickColor(p) {
    const x = clamp(Math.floor(p.x) - 1, 0, view.width - 3), y = clamp(Math.floor(p.y) - 1, 0, view.height - 3);
    const tmp = mk(3, 3), tc = tmp.getContext('2d');
    tc.drawImage(adjCanvas, x, y, 3, 3, 0, 0, 3, 3); tc.drawImage(drawLayer, x, y, 3, 3, 0, 0, 3, 3);
    const d = tc.getImageData(0, 0, 3, 3).data;
    let r = 0, g = 0, b = 0;
    for (let i = 0; i < 36; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; }
    const hex = '#' + [r, g, b].map(v => Math.round(v / 9).toString(16).padStart(2, '0')).join('');
    setColor(hex); $('edCustomColor').value = hex;
    toast('Color tomado: ' + hex);
    if (tool === 'eyedropper') setTool(prevTool);
  }

  // ---------- UI: herramientas, pestañas ----------
  const cursorFor = t => t === 'text' ? 'text' : t === 'recolor' ? 'copy' : t === 'hand' ? 'grab'
    : (t === 'brush' || t === 'eraser' || isFx(t)) ? 'none' : 'crosshair';
  function setTool(t) {
    if (tool === 'select' && t !== 'select') { commitPiece(); sel = null; }
    if (t === 'eyedropper' && tool !== 'eyedropper') prevTool = tool;
    tool = t;
    $$('.ed-tool', root).forEach(b => b.setAttribute('aria-pressed', b.dataset.tool === t));
    $('edStatusTool').textContent = TOOL_HINTS[t];
    view.style.cursor = cursorFor(t);
    if (t === 'crop') { crop = fullCrop(); setTab('frame', true); }
    else { crop = null; $('edStatusSize').textContent = `${base.width} × ${base.height} px`; if (currentTab === 'frame') setTab('draw', true); }
    $('edTextGroup').hidden = t !== 'text';
    $('edSelGroup').hidden = t !== 'select';
    $('edRecolorGroup').hidden = t !== 'recolor';
    const fxTool = isFx(t), noPaint = t === 'select' || t === 'hand' || t === 'eyedropper';
    $('edFxGroup').hidden = !fxTool;
    $('edWarpModes').hidden = t !== 'warp';
    $('edCloneSrc').hidden = t !== 'clone';
    cloneArm = false; $('edCloneSrc').textContent = '📍 Elegir origen';
    if (fxTool) {
      $('edFxHint').textContent = FX_HINTS[t === 'warp' ? warpMode : t];
      $('edFxStrength').value = fxStrength[t]; $('edFxStrengthOut').textContent = fxStrength[t] + ' %';
    }
    $('edColorGroup').hidden = t === 'eraser' || fxTool || (noPaint && t !== 'eyedropper');
    $('edSizeGroup').hidden = $('edOpacityGroup').hidden = $('edClear').hidden = noPaint || t === 'recolor' || fxTool;
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
    if (e.key === 'Escape') {
      if (!$('edExportModal').hidden) closeExport();
      else if (piece) discardPiece();
      else if (sel) { sel = null; updateSelUI(); render(); }
      else if (tool === 'crop') setTool('brush');
      return;
    }
    if (!$('edExportModal').hidden) return;
    if (mod && e.key.toLowerCase() === 'z' && !typing) { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
    if (mod && e.key.toLowerCase() === 'y' && !typing) { e.preventDefault(); redo(); return; }
    if (mod && e.key.toLowerCase() === 'c' && !typing && tool === 'select' && sel) { e.preventDefault(); copySel(); return; }
    if (mod && e.key.toLowerCase() === 'v' && !typing && clip) { e.preventDefault(); pasteClip(); return; }
    if (e.key === 'Enter' && piece) { commitPiece(); return; }
    if (mod && !typing && (e.key === '+' || e.key === '=')) { e.preventDefault(); zoomTo(zoom * 1.5); return; }
    if (mod && !typing && e.key === '-') { e.preventDefault(); zoomTo(zoom / 1.5); return; }
    if (mod && !typing && e.key === '0') { e.preventDefault(); zoomTo(1); return; }
    if (e.key === ' ' && !typing) { e.preventDefault(); if (!spaceDown) { spaceDown = true; ring.hidden = true; view.style.cursor = 'grab'; } return; }
    if ((e.key === '[' || e.key === ']') && !typing) {
      const sl = isFx(tool) ? $('edFxSize') : tool === 'text' ? $('edTextSize') : $('edSize');
      const v = +sl.value, step = Math.max(1, Math.round(v * .15));
      sl.value = e.key === ']' ? v + step : v - step; sl.dispatchEvent(new Event('input'));
      return;
    }
    if (typing || mod || e.altKey) return;
    const map = { b: 'brush', e: 'eraser', l: 'line', a: 'arrow', r: 'rect', o: 'ellipse', t: 'text', s: 'select', k: 'recolor', d: 'warp', g: 'gloss', j: 'clone', u: 'blur', i: 'eyedropper', h: 'hand', c: 'crop' };
    const t = map[e.key.toLowerCase()];
    if (t) { setTool(t); if (t !== 'crop') setTab('draw', true); }
    if (e.key === 'Enter' && tool === 'crop') $('edApplyCrop').click();
  });

  ['keydown', 'keyup'].forEach(t => document.addEventListener(t, e => { shiftDown = e.shiftKey; }));
  document.addEventListener('keyup', e => {
    if (e.key === ' ' && spaceDown) { spaceDown = false; view.style.cursor = cursorFor(tool); }
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
  // Para otras herramientas (p. ej. el Creador de personajes).
  window.editorAbrirCanvas = (c, name) => loadCanvas(c, name || 'imagen.png');
  function loadCanvas(c, name) {
    piece = null; sel = null; updateSelUI();
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
    commitPiece();
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
