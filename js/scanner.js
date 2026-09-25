let tipo = 'dos';
  let tam = 'oficio';
  let fmt = 'jpg';           // 'jpg' | 'png' | 'pdf'
  let frontBlob = null;
  let backBlob = null;
  let uniBlob = null;
  let ultimoResultado = null; // { blob, ext, mime, filename }
  let installBannerReady = false;

  let stream = null;
  let facingMode = 'environment';
  let camTarget = null;
  let fileTarget = null;

  function showToast(msg) {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(showToast._h);
    showToast._h = setTimeout(() => t.classList.remove('show'), 2200);
  }

  function setTipo(btn, t) {
    tipo = t;
    document.querySelectorAll('[data-tipo]').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    renderSlots();
    updateBtn();
    setTimeout(() => irPaso(2), 200);
  }

  function setTam(btn, t) {
    tam = t;
    document.querySelectorAll('[data-tam]').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    setTimeout(() => irPaso(3), 200);
  }

  function setFmt(btn, f) {
    fmt = f;
    document.querySelectorAll('[data-fmt]').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    setTimeout(() => irPaso(4), 200);
  }

  // ===== Navegación por pasos =====
  let pasoActual = 0;
  const TOTAL_PASOS = 5;

  function irPaso(n) {
    pasoActual = n;
    document.querySelectorAll('.step').forEach(s => {
      s.classList.toggle('active', Number(s.dataset.step) === n);
    });
    // Barra de progreso: visible desde el paso 1
    const prog = document.getElementById('progress');
    if (n === 0) prog.style.display = 'none';
    else {
      prog.style.display = 'flex';
      prog.querySelectorAll('.progress-dot').forEach(d => {
        const dn = Number(d.dataset.dot);
        d.classList.remove('done', 'current');
        if (dn < n) d.classList.add('done');
        else if (dn === n) d.classList.add('current');
      });
    }
    // El banner de instalación solo tiene sentido en la portada
    document.getElementById('installBanner').style.display = (n === 0 && installBannerReady) ? 'flex' : 'none';
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  window.irPaso = irPaso;

  // Iconos SVG inline: cámara (relleno) + flecha arriba simple para subida.
  const ICON_CAM = `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M9.4 3.6L8 5H4a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-4l-1.4-1.4a2 2 0 0 0-1.4-.6H10.8a2 2 0 0 0-1.4.6zM12 8.5a4.5 4.5 0 1 1 0 9 4.5 4.5 0 0 1 0-9zm0 2a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z"/></svg>`;
  const ICON_UP  = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4v16"/><path d="M5 11l7-7 7 7"/></svg>`;

  function slotCTA(target) {
    return `<button class="slot-cta" type="button" onclick="abrirCamara('${target}')">${ICON_CAM}<span>Tomar foto</span></button>`;
  }

  function uploadRow(mode) {
    // Fila de subida al pie de la tarjeta blanca — SEPARADA del slot negro.
    if (mode === 'una') {
      return `
        <div class="slot-upload-row">
          <div class="upload-label">o subir desde el dispositivo</div>
          <div class="upload-chips">
            <button class="upload-chip" type="button" onclick="abrirArchivo('uni')">${ICON_UP}<span>Elegir archivo</span></button>
          </div>
        </div>`;
    }
    return `
      <div class="slot-upload-row">
        <div class="upload-label">o subir desde el dispositivo</div>
        <div class="upload-chips">
          <button class="upload-chip" type="button" onclick="abrirArchivo('front')">${ICON_UP}<span>Frontal</span></button>
          <button class="upload-chip" type="button" onclick="abrirArchivo('back')">${ICON_UP}<span>Trasera</span></button>
        </div>
      </div>`;
  }

  function renderSlots() {
    const cont = document.getElementById('slotsCont');
    if (tipo === 'una') {
      cont.className = 'slots one';
      cont.innerHTML = `
        <div class="slot" id="slot-uni">
          <div class="slot-label">Documento</div>
          <div class="slot-placeholder" id="ph-uni">📄</div>
          <img id="preview-uni" class="slot-preview" style="display:none;" alt="Documento">
          ${slotCTA('uni')}
        </div>
        ${uploadRow('una')}`;
      uniBlob = null;
      frontBlob = null;
      backBlob = null;
    } else {
      cont.className = 'slots two';
      cont.innerHTML = `
        <div class="slot" id="slot-front">
          <div class="slot-label">Parte Frontal</div>
          <div class="slot-placeholder" id="ph-front">🪪</div>
          <img id="preview-front" class="slot-preview" style="display:none;" alt="Frontal">
          ${slotCTA('front')}
        </div>
        <div class="slot" id="slot-back">
          <div class="slot-label">Parte Trasera</div>
          <div class="slot-placeholder" id="ph-back">📝</div>
          <img id="preview-back" class="slot-preview" style="display:none;" alt="Trasera">
          ${slotCTA('back')}
        </div>
        ${uploadRow('dos')}`;
      uniBlob = null;
    }
  }

  function updateBtn() {
    const btn = document.getElementById('btnGenerar');
    if (tipo === 'una') btn.disabled = !uniBlob;
    else btn.disabled = !(frontBlob && backBlob);
  }

  function assignBlob(target, blob) {
    if (target === 'front') frontBlob = blob;
    else if (target === 'back') backBlob = blob;
    else if (target === 'uni') uniBlob = blob;
    updateBtn();
  }

  function showPreview(target, src) {
    const img = document.getElementById('preview-' + target);
    const ph = document.getElementById('ph-' + target);
    const slot = document.getElementById('slot-' + target);
    if (img) { img.src = src; img.style.display = 'block'; }
    if (ph) ph.style.display = 'none';
    if (slot) slot.classList.add('has-image');
  }

  function abrirArchivo(target) {
    fileTarget = target;
    const inp = document.getElementById('fileInput');
    inp.value = '';
    inp.click();
  }

  function fileSelected(input) {
    if (!input.files.length) return;
    const file = input.files[0];
    // Abre el editor de recorte antes de asignar la imagen al slot.
    abrirRecorte(fileTarget, file, 'file');
  }

  // ============= Ajuste de esquinas (galería y cámara) =============
  // Sistema de 4 esquinas independientes que forman un cuadrilátero libre.
  // Al confirmar se aplica warp de perspectiva (2 triángulos con transformación afín)
  // para enderezar el documento aunque la foto quede torcida o inclinada.
  let cropTarget = null;
  let cropSourceBlob = null;
  let cropQuad = null;      // { tl, tr, br, bl } → cada uno {x, y} en coords del contenedor
  let cropDrag = null;      // { handle, startX, startY, orig, containerRect }
  let cropEnhance = 'natural'; // 'natural' | 'document'
  let cropSource = 'file';  // 'file' | 'camera'
  let cropInitBox = null;   // {x, y, w, h} normalizado [0..1] respecto a la imagen capturada,
                            // para arrancar el cuadrilátero sobre el marco verde de la cámara

  function abrirRecorte(target, blob, source) {
    cropTarget = target;
    cropSourceBlob = blob;
    cropSource = source || 'file';
    cropEnhance = 'natural';
    if (cropSource !== 'camera') cropInitBox = null;
    document.querySelectorAll('#filterBar .filter-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.f === 'natural');
    });
    document.getElementById('cropInstr').textContent = cropSource === 'camera'
      ? 'Ajusta las esquinas verdes al borde del documento capturado'
      : 'Ajusta las esquinas verdes al borde del documento';
    document.getElementById('filterBar').style.display = 'flex';
    document.getElementById('cropSvg').style.display = 'none';
    document.getElementById('cropHandles').style.display = 'none';
    document.getElementById('cropModal').classList.add('show');
    const img = document.getElementById('cropImage');
    const prev = img.src;
    img.onload = () => {
      requestAnimationFrame(initCropQuad);
      if (prev && prev.startsWith('blob:')) URL.revokeObjectURL(prev);
    };
    img.src = URL.createObjectURL(blob);
  }
  window.abrirRecorte = abrirRecorte;

  function getImageDisplayRect() {
    const container = document.getElementById('cropContainer');
    const img = document.getElementById('cropImage');
    const cw = container.clientWidth;
    const ch = container.clientHeight;
    const nw = img.naturalWidth;
    const nh = img.naturalHeight;
    if (!nw || !nh || !cw || !ch) return { x: 0, y: 0, w: cw, h: ch, scale: 1 };
    const scale = Math.min(cw / nw, ch / nh);
    const w = nw * scale;
    const h = nh * scale;
    return { x: (cw - w) / 2, y: (ch - h) / 2, w, h, scale };
  }

  function initCropQuad() {
    const disp = getImageDisplayRect();
    if (!disp.w || !disp.h) return;
    let x, y, w, h;
    if (cropInitBox && cropInitBox.w > 0 && cropInitBox.h > 0) {
      // La cámara nos dejó la posición del marco verde (tarjeta o documento)
      // en coords normalizadas. Convertimos a coords del contenedor para que
      // el cuadrilátero arranque encima del recorte que el usuario ya encuadró.
      const nx = clamp(cropInitBox.x, 0, 1);
      const ny = clamp(cropInitBox.y, 0, 1);
      const nw = clamp(cropInitBox.w, 0.05, 1);
      const nh = clamp(cropInitBox.h, 0.05, 1);
      x = disp.x + nx * disp.w;
      y = disp.y + ny * disp.h;
      w = nw * disp.w;
      h = nh * disp.h;
      if (x + w > disp.x + disp.w) w = disp.x + disp.w - x;
      if (y + h > disp.y + disp.h) h = disp.y + disp.h - y;
    } else {
      const margin = 0.06;
      x = disp.x + disp.w * margin;
      y = disp.y + disp.h * margin;
      w = disp.w * (1 - margin * 2);
      h = disp.h * (1 - margin * 2);
    }
    cropQuad = {
      tl: { x, y },
      tr: { x: x + w, y },
      br: { x: x + w, y: y + h },
      bl: { x, y: y + h }
    };
    document.getElementById('cropSvg').style.display = 'block';
    document.getElementById('cropHandles').style.display = 'block';
    drawCropQuad();
  }

  function drawCropQuad() {
    if (!cropQuad) return;
    const pts = [cropQuad.tl, cropQuad.tr, cropQuad.br, cropQuad.bl];
    const ptsStr = pts.map(p => `${p.x},${p.y}`).join(' ');
    document.getElementById('cropPoly').setAttribute('points', ptsStr);
    document.getElementById('cropOutline').setAttribute('points', ptsStr);
    document.querySelectorAll('#cropHandles .crop-handle').forEach(h => {
      const p = cropQuad[h.dataset.h];
      h.style.left = p.x + 'px';
      h.style.top = p.y + 'px';
    });
  }

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  // ===== Lupa de precisión =====
  // Muestra un acercamiento circular de la zona bajo el dedo mientras se
  // arrastra una esquina, para poder apuntar exactamente al borde del documento.
  const MAG_SIZE = 132;   // debe coincidir con el .crop-magnifier del CSS
  const MAG_ZOOM = 2.4;

  function showMagnifier(px, py) {
    const mag = document.getElementById('cropMagnifier');
    if (!mag) return;
    const img = document.getElementById('cropImage');
    const container = document.getElementById('cropContainer');
    const disp = getImageDisplayRect();
    if (!disp.w || !disp.h || !img.src) return;
    // Fondo = la propia imagen mostrada, ampliada MAG_ZOOM veces.
    mag.style.backgroundImage = `url("${img.src}")`;
    mag.style.backgroundSize = `${disp.w * MAG_ZOOM}px ${disp.h * MAG_ZOOM}px`;
    // Centrar el punto (px,py) en el centro de la lupa.
    const bgX = MAG_SIZE / 2 - (px - disp.x) * MAG_ZOOM;
    const bgY = MAG_SIZE / 2 - (py - disp.y) * MAG_ZOOM;
    mag.style.backgroundPosition = `${bgX}px ${bgY}px`;
    // Colocar la lupa arriba del dedo; si no cabe, debajo. Siempre dentro del área.
    let left = px - MAG_SIZE / 2;
    let top = py - MAG_SIZE - 28;
    if (top < 8) top = py + 28;
    const maxLeft = Math.max(8, container.clientWidth - MAG_SIZE - 8);
    const maxTop = Math.max(8, container.clientHeight - MAG_SIZE - 8);
    left = clamp(left, 8, maxLeft);
    top = clamp(top, 8, maxTop);
    mag.style.left = left + 'px';
    mag.style.top = top + 'px';
    mag.classList.add('show');
  }

  function hideMagnifier() {
    const mag = document.getElementById('cropMagnifier');
    if (mag) mag.classList.remove('show');
  }

  function onCropPointerDown(e) {
    if (!cropQuad) return;
    const handle = e.target && e.target.dataset ? e.target.dataset.h : null;
    if (!handle) return;
    const container = document.getElementById('cropContainer');
    const rect = container.getBoundingClientRect();
    cropDrag = {
      handle,
      startX: e.clientX - rect.left,
      startY: e.clientY - rect.top,
      orig: { ...cropQuad[handle] },
      containerRect: rect
    };
    e.preventDefault();
    if (container.setPointerCapture && e.pointerId != null) {
      try { container.setPointerCapture(e.pointerId); } catch (_) {}
    }
    // Mostrar la lupa centrada en la esquina que se está tomando.
    showMagnifier(cropQuad[handle].x, cropQuad[handle].y);
  }

  function onCropPointerMove(e) {
    if (!cropDrag) return;
    const rect = cropDrag.containerRect;
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    const dx = px - cropDrag.startX;
    const dy = py - cropDrag.startY;
    const disp = getImageDisplayRect();
    const nx = clamp(cropDrag.orig.x + dx, disp.x, disp.x + disp.w);
    const ny = clamp(cropDrag.orig.y + dy, disp.y, disp.y + disp.h);
    cropQuad[cropDrag.handle] = { x: nx, y: ny };
    drawCropQuad();
    showMagnifier(nx, ny);
  }

  function onCropPointerUp() {
    cropDrag = null;
    hideMagnifier();
  }

  function reiniciarRecorte() {
    initCropQuad();
  }
  window.reiniciarRecorte = reiniciarRecorte;

  function cancelarRecorte() {
    const inp = document.getElementById('fileInput');
    if (inp) inp.value = '';
    cerrarRecorteInterno();
  }
  window.cancelarRecorte = cancelarRecorte;

  function cerrarRecorteInterno() {
    document.getElementById('cropModal').classList.remove('show');
    const img = document.getElementById('cropImage');
    if (img.src && img.src.startsWith('blob:')) URL.revokeObjectURL(img.src);
    img.removeAttribute('src');
    document.getElementById('cropSvg').style.display = 'none';
    document.getElementById('cropHandles').style.display = 'none';
    document.getElementById('filterBar').style.display = 'none';
    hideMagnifier();
    cropSourceBlob = null;
    cropTarget = null;
    cropQuad = null;
    cropDrag = null;
    cropInitBox = null;
  }

  function setFilter(f) {
    cropEnhance = f;
    document.querySelectorAll('#filterBar .filter-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.f === f);
    });
  }
  window.setFilter = setFilter;

  // Dibuja un triángulo con textura del <img> aplicando la transformación afín
  // que mapea (u0,v0)→(x0,y0), (u1,v1)→(x1,y1), (u2,v2)→(x2,y2). Usada dos
  // veces para simular perspectiva sobre el cuadrilátero.
  function drawTexturedTriangle(ctx, img, x0, y0, x1, y1, x2, y2, u0, v0, u1, v1, u2, v2) {
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.closePath();
    ctx.clip();
    const denom = u0 * (v2 - v1) - u1 * v2 + u2 * v1 + (u1 - u2) * v0;
    if (denom === 0) { ctx.restore(); return; }
    const a = -(v0 * (x2 - x1) - v1 * x2 + v2 * x1 + (v1 - v2) * x0) / denom;
    const b =  (v1 * y2 + v0 * (y1 - y2) - v2 * y1 + (v2 - v1) * y0) / denom;
    const c =  (u0 * (x2 - x1) - u1 * x2 + u2 * x1 + (u1 - u2) * x0) / denom;
    const d = -(u1 * y2 + u0 * (y1 - y2) - u2 * y1 + (u2 - u1) * y0) / denom;
    const e =  (u0 * (v2 * x1 - v1 * x2) + v0 * (u1 * x2 - u2 * x1) + (u2 * v1 - u1 * v2) * x0) / denom;
    const f =  (u0 * (v2 * y1 - v1 * y2) + v0 * (u1 * y2 - u2 * y1) + (u2 * v1 - u1 * v2) * y0) / denom;
    ctx.transform(a, b, c, d, e, f);
    ctx.drawImage(img, 0, 0);
    ctx.restore();
  }

  // Filtro "documento" A COLOR con BALANCE DE BLANCOS: neutraliza el tono del
  // papel (p. ej. boletas térmicas cálidas que salían amarillas) llevando el
  // fondo a blanco NEUTRO, realza el contraste y conserva el color real de
  // sellos, firmas, logos y texto (azul/rojo, etc.).
  function applyDocumentFilter(canvas) {
    const ctx = canvas.getContext('2d');
    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const d = imgData.data;

    // 1) Estimar el color del fondo POR CANAL (R, G, B) con histogramas
    //    independientes. Tomar el percentil alto de cada canal ≈ el color del
    //    papel iluminado en ese canal. Corregir cada canal por separado es lo
    //    que elimina el tinte (balance de blancos).
    const hr = new Uint32Array(256);
    const hg = new Uint32Array(256);
    const hb = new Uint32Array(256);
    for (let i = 0; i < d.length; i += 4) {
      hr[d[i]]++; hg[d[i+1]]++; hb[d[i+2]]++;
    }
    const total = d.length / 4;
    const target = total * 0.82;
    function percentil(h) {
      let acc = 0;
      for (let v = 0; v < 256; v++) {
        acc += h[v];
        if (acc >= target) return v;
      }
      return 255;
    }
    // Piso para no sobre-exponer fotos muy oscuras.
    const bgR = Math.max(90, percentil(hr));
    const bgG = Math.max(90, percentil(hg));
    const bgB = Math.max(90, percentil(hb));

    // 2) Ganancia POR CANAL → el fondo de cada canal se lleva a ~245, dejando
    //    el papel blanco neutro. Contraste suave y saturación ligera (el papel
    //    ya quedó neutro, así que no se reintroduce ninguna dominante).
    const TARGET = 245;
    const gR = TARGET / bgR;
    const gG = TARGET / bgG;
    const gB = TARGET / bgB;
    const contrast = 1.15;
    const sat = 1.06;

    // 3) Realce SOLO del texto (LUT): los tonos claros del papel (>= WHITE) NO
    //    se tocan, así la hoja se mantiene blanca; sólo se oscurecen los tonos
    //    de la tinta. Dentro de la banda [0, WHITE] se aplica una gamma que
    //    marca la letra (mayor GAMMA = tinta más oscura), dejando fijos el
    //    negro (0) y el propio punto de papel (WHITE).
    const WHITE = 225;
    const GAMMA = 1.7;
    const lut = new Uint8Array(256);
    for (let v = 0; v < 256; v++) {
      lut[v] = v >= WHITE ? v : Math.round(WHITE * Math.pow(v / WHITE, GAMMA));
    }

    for (let i = 0; i < d.length; i += 4) {
      let r = d[i]   * gR;
      let g = d[i+1] * gG;
      let b = d[i+2] * gB;
      // Contraste alrededor del punto medio.
      r = (r - 128) * contrast + 128;
      g = (g - 128) * contrast + 128;
      b = (b - 128) * contrast + 128;
      // Saturación: separamos color de la luminancia y lo reforzamos un poco.
      const l = 0.299 * r + 0.587 * g + 0.114 * b;
      r = l + (r - l) * sat;
      g = l + (g - l) * sat;
      b = l + (b - l) * sat;
      // Clamp a entero [0,255] y pasada por la LUT de realce de texto.
      r = r < 0 ? 0 : r > 255 ? 255 : r;
      g = g < 0 ? 0 : g > 255 ? 255 : g;
      b = b < 0 ? 0 : b > 255 ? 255 : b;
      d[i]   = lut[r | 0];
      d[i+1] = lut[g | 0];
      d[i+2] = lut[b | 0];
    }
    ctx.putImageData(imgData, 0, 0);
  }

  async function confirmarRecorte() {
    if (!cropSourceBlob || !cropQuad) return;
    const target = cropTarget;
    const disp = getImageDisplayRect();
    if (!disp.scale) return;
    // Coordenadas del cuadrilátero en el espacio de píxeles del original.
    const toImg = p => ({
      x: (p.x - disp.x) / disp.scale,
      y: (p.y - disp.y) / disp.scale
    });
    const q = {
      tl: toImg(cropQuad.tl),
      tr: toImg(cropQuad.tr),
      br: toImg(cropQuad.br),
      bl: toImg(cropQuad.bl)
    };
    const src = await loadImage(cropSourceBlob);

    // Aspecto del canvas de salida = aspecto real del cuadrilátero recortado.
    // Se calcula como el promedio de los lados opuestos, para que un documento
    // largo salga largo y uno cuadrado salga cuadrado — sin deformar el corte
    // hecho por el usuario, sea foto de cámara o imagen subida.
    const topW = Math.hypot(q.tr.x - q.tl.x, q.tr.y - q.tl.y);
    const botW = Math.hypot(q.br.x - q.bl.x, q.br.y - q.bl.y);
    const lefH = Math.hypot(q.bl.x - q.tl.x, q.bl.y - q.tl.y);
    const rigH = Math.hypot(q.br.x - q.tr.x, q.br.y - q.tr.y);
    let targetW = Math.max(200, Math.round((topW + botW) / 2));
    let targetH = Math.max(200, Math.round((lefH + rigH) / 2));
    // Techo alto para conservar el máximo detalle del documento recortado
    // sin generar canvas desmesurados.
    const MAX_SIDE = 3200;
    if (targetW > MAX_SIDE || targetH > MAX_SIDE) {
      const k = MAX_SIDE / Math.max(targetW, targetH);
      targetW = Math.round(targetW * k);
      targetH = Math.round(targetH * k);
    }

    const canvas = document.createElement('canvas');
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    // Warp por dos triángulos: tl-tr-br  y  tl-br-bl.
    drawTexturedTriangle(ctx, src,
      0, 0, targetW, 0, targetW, targetH,
      q.tl.x, q.tl.y, q.tr.x, q.tr.y, q.br.x, q.br.y);
    drawTexturedTriangle(ctx, src,
      0, 0, targetW, targetH, 0, targetH,
      q.tl.x, q.tl.y, q.br.x, q.br.y, q.bl.x, q.bl.y);

    if (cropEnhance === 'document') applyDocumentFilter(canvas);

    // PNG sin pérdida: este recorte todavía se vuelve a dibujar sobre la hoja
    // final, así que evitamos una compresión JPEG intermedia (doble pérdida).
    const blob = await new Promise(r => canvas.toBlob(r, 'image/png'));
    if (!blob) { showToast('Error al recortar'); return; }
    const url = URL.createObjectURL(blob);
    assignBlob(target, blob);
    showPreview(target, url);
    const inp = document.getElementById('fileInput');
    if (inp) inp.value = '';
    cerrarRecorteInterno();
    showToast(cropEnhance === 'document' ? 'Imagen ajustada · modo documento' : 'Imagen ajustada');
  }
  window.confirmarRecorte = confirmarRecorte;

  (function attachCropHandlers() {
    const container = document.getElementById('cropContainer');
    if (!container) return;
    container.addEventListener('pointerdown', onCropPointerDown);
    container.addEventListener('pointermove', onCropPointerMove);
    container.addEventListener('pointerup', onCropPointerUp);
    container.addEventListener('pointercancel', onCropPointerUp);
    window.addEventListener('resize', () => {
      if (document.getElementById('cropModal').classList.contains('show') && cropQuad) {
        initCropQuad();
      }
    });
  })();

  async function abrirCamara(target) {
    camTarget = target;
    const cutout = document.getElementById('camCutout');
    const instr = document.getElementById('camInstr');
    if (tipo === 'dos') {
      cutout.className = 'cam-cutout cr80';
      cutout.style.aspectRatio = '';
      instr.textContent = target === 'front' ? 'Encuadra el FRENTE de la tarjeta' : 'Encuadra el REVERSO de la tarjeta';
    } else {
      // El marco toma la MISMA proporción de la hoja elegida, así la captura
      // llena el papel sin espacios en blanco.
      const [sheetW, sheetH] = sheetSize();
      cutout.className = 'cam-cutout portrait';
      cutout.style.aspectRatio = (sheetW / sheetH).toFixed(4);
      instr.textContent = 'Encuadra el documento en vertical';
    }
    document.getElementById('camModal').classList.add('show');
    await iniciarStream();
  }

  async function iniciarStream() {
    if (stream) stream.getTracks().forEach(t => t.stop());
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        // Pedimos la máxima resolución que soporte la cámara (hasta 4K) para
        // capturar el documento con el mayor detalle posible. El dispositivo
        // ajusta a lo que realmente puede entregar.
        video: {
          facingMode: { ideal: facingMode },
          width: { ideal: 3840 },
          height: { ideal: 2160 }
        },
        audio: false
      });
      document.getElementById('camVideo').srcObject = stream;
      // Esperar a que el track exponga capabilities antes de consultar torch.
      setTimeout(updateTorchButton, 300);
    } catch (e) {
      console.error('Cámara:', e);
      showToast('No se pudo acceder a la cámara');
      cerrarCamara();
    }
  }

  async function cerrarCamara() {
    if (stream) {
      const track = stream.getVideoTracks()[0];
      if (track && torchOn) {
        try { await track.applyConstraints({ advanced: [{ torch: false }] }); } catch (_) {}
      }
      stream.getTracks().forEach(t => t.stop());
      stream = null;
    }
    torchOn = false;
    const btn = document.getElementById('btnTorch');
    if (btn) { btn.style.display = 'none'; btn.classList.remove('torch-on'); }
    document.getElementById('camModal').classList.remove('show');
    document.getElementById('camVideo').srcObject = null;
  }

  async function cambiarCamara() {
    facingMode = facingMode === 'environment' ? 'user' : 'environment';
    await iniciarStream();
  }

  function capturar() {
    const video = document.getElementById('camVideo');
    if (!video || !stream) return;
    const vw = video.videoWidth, vh = video.videoHeight;
    if (!vw || !vh) { showToast('Cámara no lista'); return; }
    // Captura el frame completo (sin recortar al marco) para que el usuario
    // pueda ajustar las 4 esquinas del documento en el paso siguiente aunque
    // el papel se haya salido un poco del cuadro verde.
    // Antes de capturar, medimos dónde queda el marco verde dentro del
    // sensor. El video se muestra con object-fit: cover (recorta los bordes),
    // así que hay que revertir esa transformación para obtener coords reales.
    let box = null;
    const cutout = document.getElementById('camCutout');
    const cw = video.clientWidth, ch = video.clientHeight;
    if (cutout && cw && ch) {
      const scale = Math.max(cw / vw, ch / vh);
      const dispW = vw * scale, dispH = vh * scale;
      const offX = (cw - dispW) / 2, offY = (ch - dispH) / 2;
      const vr = video.getBoundingClientRect();
      const cr = cutout.getBoundingClientRect();
      const relX = cr.left - vr.left;
      const relY = cr.top - vr.top;
      const sx = (relX - offX) / scale;
      const sy = (relY - offY) / scale;
      const sw = cr.width / scale;
      const sh = cr.height / scale;
      const nx = Math.max(0, Math.min(1, sx / vw));
      const ny = Math.max(0, Math.min(1, sy / vh));
      const nw = Math.max(0.05, Math.min(1 - nx, sw / vw));
      const nh = Math.max(0.05, Math.min(1 - ny, sh / vh));
      box = { x: nx, y: ny, w: nw, h: nh };
    }
    const canvas = document.createElement('canvas');
    canvas.width = vw;
    canvas.height = vh;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(video, 0, 0, vw, vh);
    // PNG sin pérdida: el frame aún pasará por el recorte/warp, así evitamos
    // una compresión JPEG intermedia que degradaría el detalle.
    canvas.toBlob(blob => {
      if (!blob) { showToast('Error al capturar'); return; }
      const t = camTarget;
      cerrarCamara();
      cropInitBox = box;
      abrirRecorte(t, blob, 'camera');
    }, 'image/png');
  }

  // ============= Linterna (flash trasero) =============
  let torchOn = false;

  async function toggleTorch() {
    if (!stream) return;
    const track = stream.getVideoTracks()[0];
    if (!track) return;
    const caps = (track.getCapabilities && track.getCapabilities()) || {};
    if (!caps.torch) { showToast('Linterna no disponible'); return; }
    torchOn = !torchOn;
    try {
      await track.applyConstraints({ advanced: [{ torch: torchOn }] });
      document.getElementById('btnTorch').classList.toggle('torch-on', torchOn);
    } catch (e) {
      torchOn = !torchOn;
      showToast('No se pudo cambiar la linterna');
    }
  }
  window.toggleTorch = toggleTorch;

  function updateTorchButton() {
    const btn = document.getElementById('btnTorch');
    if (!btn) return;
    if (!stream) { btn.style.display = 'none'; return; }
    const track = stream.getVideoTracks()[0];
    const caps = (track && track.getCapabilities) ? track.getCapabilities() : {};
    btn.style.display = caps.torch ? 'flex' : 'none';
    btn.classList.remove('torch-on');
    torchOn = false;
  }

  // ============= Generación de la hoja =============

  function sheetSize() {
    // 1700 px de ancho ≈ 200 DPI sobre 8.5", buena nitidez para pantalla e
    // impresión sin generar archivos excesivamente pesados.
    const w = 1700;
    if (tam === 'oficio') return [w, Math.round(w * 13 / 8.5)];   // 1700 × 2600
    return [w, Math.round(w * 11 / 8.5)];                          // 1700 × 2200 (carta)
  }

  function loadImage(blob) {
    return new Promise((res, rej) => {
      const img = new Image();
      img.onload = () => res(img);
      img.onerror = () => rej(new Error('No se pudo cargar la imagen.'));
      img.src = URL.createObjectURL(blob);
    });
  }

  // Dibuja la hoja completa sobre un canvas y lo devuelve (sin exportar).
  async function dibujarHoja() {
    const [sheetW, sheetH] = sheetSize();
    const canvas = document.createElement('canvas');
    canvas.width = sheetW;
    canvas.height = sheetH;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, sheetW, sheetH);

    if (tipo === 'dos') {
      // Dos tarjetas apiladas a TAMAÑO REAL de carnet (CR80: 85.6 × 54 mm).
      // Cada imagen se ENCAJA dentro de esa caja preservando su aspecto,
      // así nunca queda deformada y sale al tamaño físico correcto al imprimir.
      const [imgF, imgB] = await Promise.all([loadImage(frontBlob), loadImage(backBlob)]);
      const pxPerMm = sheetW / 216;                      // el ancho de la hoja siempre es 216 mm
      const cardMaxW = Math.round(100 * pxPerMm);        // un poco más grande que CR80
      const cardMaxH = Math.round(63  * pxPerMm);

      const scaleF = Math.min(cardMaxW / imgF.naturalWidth, cardMaxH / imgF.naturalHeight);
      const cardFW = Math.round(imgF.naturalWidth  * scaleF);
      const cardFH = Math.round(imgF.naturalHeight * scaleF);

      const scaleB = Math.min(cardMaxW / imgB.naturalWidth, cardMaxH / imgB.naturalHeight);
      const cardBW = Math.round(imgB.naturalWidth  * scaleB);
      const cardBH = Math.round(imgB.naturalHeight * scaleB);

      const gap = Math.round(14 * pxPerMm);              // ~14 mm entre tarjetas
      const pairH = cardFH + cardBH + gap;

      // Centrado horizontal (cada tarjeta con su propio ancho real) y un
      // poco más arriba del centro vertical (~10% de la hoja hacia arriba).
      const centerY = Math.round((sheetH - pairH) / 2);
      const shiftUp = Math.round(sheetH * 0.10);
      const topY   = Math.max(60, centerY - shiftUp);

      ctx.drawImage(imgF, Math.round((sheetW - cardFW) / 2), topY,                    cardFW, cardFH);
      ctx.drawImage(imgB, Math.round((sheetW - cardBW) / 2), topY + cardFH + gap,     cardBW, cardBH);
    } else {
      // Una cara: la imagen se ENCAJA en la hoja (modo "contain") preservando
      // su proporción tal como quedó el recorte. Si el documento es largo,
      // sobra blanco a los lados; si es cuadrado, sobra arriba/abajo — pero
      // NUNCA se recorta ni se deforma la forma elegida por el usuario.
      const img = await loadImage(uniBlob);
      const scale = Math.min(sheetW / img.naturalWidth, sheetH / img.naturalHeight);
      const w = img.naturalWidth * scale;
      const h = img.naturalHeight * scale;
      const x = (sheetW - w) / 2;
      const y = (sheetH - h) / 2;
      ctx.drawImage(img, x, y, w, h);
    }
    return canvas;
  }

  // Carga jsPDF una sola vez (desde CDN) — solo cuando el usuario elige PDF.
  let jsPDFPromise = null;
  function cargarJsPDF() {
    if (jsPDFPromise) return jsPDFPromise;
    jsPDFPromise = new Promise((res, rej) => {
      if (window.jspdf && window.jspdf.jsPDF) return res(window.jspdf.jsPDF);
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js';
      s.onload = () => (window.jspdf && window.jspdf.jsPDF) ? res(window.jspdf.jsPDF) : rej(new Error('jsPDF no disponible'));
      s.onerror = () => rej(new Error('No se pudo cargar la librería PDF'));
      document.head.appendChild(s);
    });
    return jsPDFPromise;
  }

  // Exporta el canvas en el formato elegido: {blob, ext, mime, previewUrl}
  async function exportar(canvas) {
    if (fmt === 'png') {
      const blob = await new Promise(r => canvas.toBlob(r, 'image/png'));
      return { blob, ext: 'png', mime: 'image/png', previewUrl: URL.createObjectURL(blob) };
    }
    if (fmt === 'pdf') {
      const JsPDF = await cargarJsPDF();
      // Hoja oficio: 216 × 330 mm | carta: 216 × 279 mm.
      const [mmW, mmH] = tam === 'oficio' ? [216, 330] : [216, 279];
      const doc = new JsPDF({
        orientation: 'portrait',
        unit: 'mm',
        format: [mmW, mmH],
        compress: true
      });
      const dataUrl = canvas.toDataURL('image/jpeg', 0.95);
      doc.addImage(dataUrl, 'JPEG', 0, 0, mmW, mmH, undefined, 'SLOW');
      const blob = doc.output('blob');
      return { blob, ext: 'pdf', mime: 'application/pdf', previewUrl: URL.createObjectURL(blob) };
    }
    // JPG por defecto
    const blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', 0.95));
    return { blob, ext: 'jpg', mime: 'image/jpeg', previewUrl: URL.createObjectURL(blob) };
  }

  async function generar() {
    const btn = document.getElementById('btnGenerar');
    const original = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Generando…';
    try {
      const canvas = await dibujarHoja();
      const { blob, ext, mime, previewUrl } = await exportar(canvas);

      const nomDefault = tipo === 'dos' ? `documento_ambas_caras_${tam}` : `documento_${tam}`;
      // Si el usuario ya escribió un nombre, respetarlo; si no, sugerir uno por defecto.
      const nombreInput = document.getElementById('nombreArchivo');
      const nombreUsuario = (nombreInput.value || '').trim();
      const baseName = nombreUsuario || nomDefault;
      nombreInput.value = baseName;
      const filename = `${baseName}.${ext}`;

      ultimoResultado = { blob, ext, mime, filename, url: previewUrl, baseName };

      // Guardado automático en historial (no bloquea la UI).
      generarThumb(canvas).then(thumbBlob => {
        guardarEnHistorial(blob, thumbBlob, { filename, ext, mime, tipo, tam, fmt });
      });

      // Para PDF mostramos el canvas como preview (los <img> no muestran PDFs).
      const previewImg = fmt === 'pdf' ? canvas.toDataURL('image/jpeg', 0.85) : previewUrl;
      document.getElementById('resultImg').src = previewImg;

      const a = document.getElementById('downloadLink');
      a.href = previewUrl;
      a.download = filename;
      a.textContent = `⬇ Guardar ${ext.toUpperCase()}`;
      document.getElementById('nombreExt').textContent = '.' + ext;

      irPaso(5);
      showToast('Hoja generada');
    } catch (e) {
      console.error(e);
      showToast('Error: ' + e.message);
    }
    btn.disabled = false;
    btn.textContent = original;
    updateBtn();
  }
  // Alias que ejecuta el mismo flujo (mantiene compatibilidad con el HTML).
  const generarYAvanzar = generar;
  window.generarYAvanzar = generarYAvanzar;

  // Sanea el nombre escrito por el usuario (quita caracteres no válidos para
  // nombres de archivo y colapsa espacios/guiones bajos).
  function sanearNombre(txt) {
    return (txt || '')
      .trim()
      .replace(/[\\/:*?"<>|]/g, '')  // caracteres prohibidos en FAT/NTFS/ext4
      .replace(/\s+/g, '_')
      .slice(0, 80);
  }

  // Se llama cada vez que el usuario escribe en el input del nombre.
  function actualizarNombre() {
    if (!ultimoResultado) return;
    const raw = document.getElementById('nombreArchivo').value;
    const base = sanearNombre(raw) || `documento_${tam}`;
    const filename = `${base}.${ultimoResultado.ext}`;
    ultimoResultado.baseName = base;
    ultimoResultado.filename = filename;
    const a = document.getElementById('downloadLink');
    a.download = filename;
  }
  window.actualizarNombre = actualizarNombre;

  // ===== Compartir por WhatsApp / Correo =====
  // Fuerza la descarga del archivo (para que el usuario lo pueda adjuntar
  // luego en la app que se abre). Necesario cuando el navegador no soporta
  // navigator.share con archivos (típico en desktop y navegadores viejos).
  function descargarArchivo() {
    if (!ultimoResultado) return;
    const a = document.createElement('a');
    a.href = ultimoResultado.url;
    a.download = ultimoResultado.filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  async function compartirArchivo(texto, titulo) {
    if (!ultimoResultado) return false;
    if (!navigator.share) return false;
    try {
      const file = new File([ultimoResultado.blob], ultimoResultado.filename, { type: ultimoResultado.mime });
      // Algunos navegadores soportan share() pero no share({files}). Testeamos:
      if (navigator.canShare && !navigator.canShare({ files: [file] })) return false;
      await navigator.share({ files: [file], title: titulo, text: texto });
      return true;
    } catch (e) {
      // El usuario canceló el picker o el navegador falló → tratamos como no soportado.
      if (e.name === 'AbortError') return true;   // usuario canceló, no hace fallback
      return false;
    }
  }

  async function enviarWhatsApp() {
    if (!ultimoResultado) { showToast('Genera la hoja primero'); return; }
    const texto = 'Documento escaneado 📄';
    const ok = await compartirArchivo(texto, 'Documento escaneado');
    if (ok) return;
    // Fallback: descargamos el archivo y abrimos WhatsApp Web para que el usuario lo adjunte.
    descargarArchivo();
    showToast('Archivo descargado — adjúntalo en el chat de WhatsApp');
    window.open('https://web.whatsapp.com/', '_blank', 'noopener');
  }

  async function enviarCorreo() {
    if (!ultimoResultado) { showToast('Genera la hoja primero'); return; }
    const texto = 'Adjunto el documento escaneado.';
    const ok = await compartirArchivo(texto, 'Documento escaneado');
    if (ok) return;
    // Fallback: descargamos + abrimos el cliente de correo con asunto y cuerpo listos.
    descargarArchivo();
    showToast('Archivo descargado — adjúntalo al correo');
    const subject = encodeURIComponent('Documento escaneado');
    const body = encodeURIComponent('Adjunto el documento escaneado (' + ultimoResultado.filename + ').');
    window.location.href = `mailto:?subject=${subject}&body=${body}`;
  }
  window.enviarWhatsApp = enviarWhatsApp;
  window.enviarCorreo = enviarCorreo;

  function reiniciar() {
    frontBlob = null; backBlob = null; uniBlob = null;
    ultimoResultado = null;
    // Deseleccionar todas las opciones para que el usuario empiece limpio.
    document.querySelectorAll('[data-tipo], [data-tam], [data-fmt]').forEach(b => b.classList.remove('active'));
    tipo = 'dos'; tam = 'oficio'; fmt = 'jpg';
    const nameInput = document.getElementById('nombreArchivo');
    if (nameInput) nameInput.value = '';
    renderSlots();
    updateBtn();
    irPaso(0);
  }

  // ============= Historial (IndexedDB) =============
  const HIST_DB_NAME = 'scanerHistorial';
  const HIST_STORE = 'docs';
  const HIST_MAX = 50;
  let _histDbPromise = null;

  function openHistDB() {
    if (_histDbPromise) return _histDbPromise;
    _histDbPromise = new Promise((res, rej) => {
      const req = indexedDB.open(HIST_DB_NAME, 1);
      req.onupgradeneeded = e => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(HIST_STORE)) {
          const store = db.createObjectStore(HIST_STORE, { keyPath: 'id', autoIncrement: true });
          store.createIndex('fecha', 'fecha');
        }
      };
      req.onsuccess = e => res(e.target.result);
      req.onerror = e => rej(e.target.error);
    });
    return _histDbPromise;
  }

  async function guardarEnHistorial(blob, thumbBlob, meta) {
    try {
      const db = await openHistDB();
      await new Promise((res, rej) => {
        const tx = db.transaction(HIST_STORE, 'readwrite');
        tx.objectStore(HIST_STORE).add({ ...meta, blob, thumbBlob, fecha: Date.now() });
        tx.oncomplete = res;
        tx.onerror = () => rej(tx.error);
      });
      // Rotación: si superamos el máximo, borrar los más antiguos.
      const items = await listarHistorial();
      if (items.length > HIST_MAX) {
        const toDelete = items.slice(HIST_MAX);
        const tx2 = db.transaction(HIST_STORE, 'readwrite');
        const s = tx2.objectStore(HIST_STORE);
        toDelete.forEach(it => s.delete(it.id));
      }
      actualizarBadgeHistorial();
    } catch (e) {
      console.warn('No se pudo guardar en historial:', e);
    }
  }

  async function listarHistorial() {
    try {
      const db = await openHistDB();
      return new Promise(res => {
        const tx = db.transaction(HIST_STORE, 'readonly');
        const req = tx.objectStore(HIST_STORE).getAll();
        req.onsuccess = () => {
          const items = req.result || [];
          items.sort((a, b) => b.fecha - a.fecha);
          res(items);
        };
        req.onerror = () => res([]);
      });
    } catch (_) { return []; }
  }

  async function borrarDelHistorial(id) {
    try {
      const db = await openHistDB();
      await new Promise((res, rej) => {
        const tx = db.transaction(HIST_STORE, 'readwrite');
        tx.objectStore(HIST_STORE).delete(id);
        tx.oncomplete = res;
        tx.onerror = () => rej(tx.error);
      });
    } catch (e) { console.warn('Error al borrar:', e); }
  }

  async function actualizarBadgeHistorial() {
    const items = await listarHistorial();
    const cnt = document.getElementById('histCount');
    if (cnt) cnt.textContent = items.length;
    // Libera object URLs previos del listado de recientes.
    document.querySelectorAll('#recentList .recent-thumb').forEach(img => {
      if (img.src && img.src.startsWith('blob:')) URL.revokeObjectURL(img.src);
    });
    const section = document.getElementById('recentSection');
    const list = document.getElementById('recentList');
    if (!section || !list) return;
    if (!items.length) {
      section.style.display = 'none';
      list.innerHTML = '';
      return;
    }
    section.style.display = 'block';
    // Solo los 3 más recientes en la portada.
    const recientes = items.slice(0, 3);
    list.innerHTML = '';
    recientes.forEach(item => {
      const div = document.createElement('div');
      div.className = 'recent-item';
      // Click en el item completo → previsualiza el documento.
      // El botón "Ver los N →" del encabezado sigue abriendo el historial.
      div.onclick = () => abrirPreview(item);
      const thumbUrl = URL.createObjectURL(item.thumbBlob || item.blob);
      const when = tiempoRelativo(item.fecha);
      const ext = (item.ext || 'jpg').toUpperCase();
      const size = formatBytes(item.blob.size);
      div.innerHTML = `
        <img class="recent-thumb" src="${thumbUrl}" alt="Miniatura">
        <div class="recent-info">
          <div class="recent-name">${escapeHtml(item.filename)}</div>
          <div class="recent-meta">
            <span class="recent-badge">${ext}</span>
            <span>${when} · ${size}</span>
          </div>
        </div>
        <div class="recent-arrow">›</div>`;
      list.appendChild(div);
    });
  }

  // Miniatura ~300 px de ancho para que la lista cargue rápido.
  async function generarThumb(canvas) {
    const maxW = 300;
    const scale = Math.min(1, maxW / canvas.width);
    const c = document.createElement('canvas');
    c.width = Math.round(canvas.width * scale);
    c.height = Math.round(canvas.height * scale);
    const ctx = c.getContext('2d');
    ctx.drawImage(canvas, 0, 0, c.width, c.height);
    return new Promise(r => c.toBlob(r, 'image/jpeg', 0.75));
  }

  function formatBytes(b) {
    if (b < 1024) return b + ' B';
    if (b < 1024 * 1024) return (b / 1024).toFixed(0) + ' KB';
    return (b / 1024 / 1024).toFixed(1) + ' MB';
  }

  function tiempoRelativo(ts) {
    const s = Math.round((Date.now() - ts) / 1000);
    if (s < 60) return 'Ahora mismo';
    if (s < 3600) return `Hace ${Math.round(s/60)} min`;
    if (s < 86400) return `Hace ${Math.round(s/3600)} h`;
    const d = Math.round(s / 86400);
    if (d < 30) return `Hace ${d} día${d > 1 ? 's' : ''}`;
    return new Date(ts).toLocaleDateString();
  }

  async function abrirHistorial() {
    document.getElementById('histModal').classList.add('show');
    await renderHistorial();
  }
  window.abrirHistorial = abrirHistorial;

  function cerrarHistorial() {
    document.getElementById('histModal').classList.remove('show');
    // Liberar object URLs generados en el render.
    document.querySelectorAll('#histBody .hist-thumb').forEach(img => {
      if (img.src && img.src.startsWith('blob:')) URL.revokeObjectURL(img.src);
    });
    document.getElementById('histBody').innerHTML = '';
  }
  window.cerrarHistorial = cerrarHistorial;

  // ===== Previsualización a pantalla completa =====
  function abrirPreview(item) {
    if (!item || !item.blob) return;
    const modal = document.getElementById('docPreview');
    const content = document.getElementById('docPreviewContent');
    const caption = document.getElementById('docPreviewCaption');
    // Libera cualquier URL previa antes de crear una nueva.
    if (content.dataset.blobUrl) URL.revokeObjectURL(content.dataset.blobUrl);
    if (content.dataset.thumbUrl) URL.revokeObjectURL(content.dataset.thumbUrl);
    const mime = item.mime || '';
    const esPdf = mime.includes('pdf') || (item.ext || '').toLowerCase() === 'pdf';
    if (esPdf) {
      // En muchos móviles (sobre todo iOS Safari) un <iframe> con blob de PDF
      // no renderiza — se ve un fondo blanco/negro sin contenido. Mostramos la
      // miniatura ampliada y ofrecemos un botón para abrir el PDF real.
      const thumbBlob = item.thumbBlob || item.blob;
      const thumbUrl = URL.createObjectURL(thumbBlob);
      content.dataset.thumbUrl = thumbUrl;
      content.innerHTML = `
        <div class="doc-preview-pdf">
          <img src="${thumbUrl}" alt="${escapeHtml(item.filename || 'Documento')}">
          <button type="button" class="doc-preview-open" id="docPreviewOpenBtn">📄 Abrir PDF</button>
        </div>`;
      const btn = document.getElementById('docPreviewOpenBtn');
      if (btn) btn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        const pdfUrl = URL.createObjectURL(item.blob);
        // Abrir en pestaña/visor nativo del sistema.
        const w = window.open(pdfUrl, '_blank');
        if (!w) {
          // Bloqueado por el navegador → fuerza descarga.
          descargarBlob(item.blob, item.filename);
        }
        setTimeout(() => URL.revokeObjectURL(pdfUrl), 60_000);
      });
    } else {
      const url = URL.createObjectURL(item.blob);
      content.dataset.blobUrl = url;
      content.innerHTML = `<img src="${url}" alt="${escapeHtml(item.filename || 'Documento')}">`;
    }
    caption.textContent = item.filename || '';
    modal.classList.add('show');
    document.body.style.overflow = 'hidden';
  }
  window.abrirPreview = abrirPreview;

  function cerrarPreview(e) {
    // Solo cierra si se clickea el fondo o el botón ✕, no el contenido.
    if (e && e.target) {
      const t = e.target;
      const esFondo = t.id === 'docPreview';
      const esCerrar = t.classList && t.classList.contains('doc-preview-close');
      if (!esFondo && !esCerrar) return;
    }
    const modal = document.getElementById('docPreview');
    const content = document.getElementById('docPreviewContent');
    if (content.dataset.blobUrl) {
      URL.revokeObjectURL(content.dataset.blobUrl);
      delete content.dataset.blobUrl;
    }
    if (content.dataset.thumbUrl) {
      URL.revokeObjectURL(content.dataset.thumbUrl);
      delete content.dataset.thumbUrl;
    }
    content.innerHTML = '';
    modal.classList.remove('show');
    document.body.style.overflow = '';
  }
  window.cerrarPreview = cerrarPreview;

  // Cierra con la tecla Escape.
  document.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Escape') return;
    const modal = document.getElementById('docPreview');
    if (modal && modal.classList.contains('show')) cerrarPreview();
  });

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[c]);
  }

  async function renderHistorial() {
    const body = document.getElementById('histBody');
    const toolbar = document.getElementById('histToolbar');
    const items = await listarHistorial();
    if (!items.length) {
      if (toolbar) toolbar.classList.remove('show');
      body.innerHTML = `
        <div class="hist-empty">
          <div class="hist-empty-icon">📁</div>
          <div>No hay documentos guardados aún.</div>
          <small>Los documentos que generes aparecerán aquí automáticamente.</small>
        </div>`;
      return;
    }
    if (toolbar) toolbar.classList.add('show');
    body.innerHTML = '';
    items.forEach(item => {
      const div = document.createElement('div');
      div.className = 'hist-item';
      const thumbUrl = URL.createObjectURL(item.thumbBlob || item.blob);
      const size = formatBytes(item.blob.size);
      const when = tiempoRelativo(item.fecha);
      const ext = (item.ext || 'jpg').toUpperCase();
      div.innerHTML = `
        <img class="hist-thumb" src="${thumbUrl}" alt="Miniatura">
        <div class="hist-info">
          <div class="hist-name">${escapeHtml(item.filename)}</div>
          <div class="hist-date">${when} · ${ext} · ${size}</div>
          <div class="hist-actions">
            <button class="hist-btn" data-act="download">⬇ Guardar</button>
            <button class="hist-btn" data-act="wa">💬 WhatsApp</button>
            <button class="hist-btn" data-act="mail">✉ Correo</button>
            <button class="hist-btn danger" data-act="del">🗑</button>
          </div>
        </div>`;
      div.querySelectorAll('.hist-btn').forEach(b => {
        b.addEventListener('click', () => accionHistorial(item, b.dataset.act));
      });
      // Click en la miniatura → previsualiza a pantalla completa.
      const thumb = div.querySelector('.hist-thumb');
      if (thumb) thumb.addEventListener('click', () => abrirPreview(item));
      body.appendChild(div);
    });
  }

  async function compartirBlob(blob, filename, mime, texto, titulo) {
    if (!navigator.share) return false;
    try {
      const file = new File([blob], filename, { type: mime });
      if (navigator.canShare && !navigator.canShare({ files: [file] })) return false;
      await navigator.share({ files: [file], title: titulo, text: texto });
      return true;
    } catch (e) {
      if (e.name === 'AbortError') return true;
      return false;
    }
  }

  function descargarBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  async function accionHistorial(item, act) {
    if (act === 'download') {
      descargarBlob(item.blob, item.filename);
      showToast('Descargando…');
      return;
    }
    if (act === 'del') {
      if (!confirm(`¿Borrar "${item.filename}"?`)) return;
      await borrarDelHistorial(item.id);
      await renderHistorial();
      await actualizarBadgeHistorial();
      showToast('Documento borrado');
      return;
    }
    if (act === 'wa' || act === 'mail') {
      const texto = act === 'wa' ? 'Documento escaneado 📄' : 'Adjunto el documento escaneado.';
      const ok = await compartirBlob(item.blob, item.filename, item.mime, texto, 'Documento escaneado');
      if (ok) return;
      descargarBlob(item.blob, item.filename);
      if (act === 'wa') {
        showToast('Archivo descargado — adjúntalo en WhatsApp');
        window.open('https://web.whatsapp.com/', '_blank', 'noopener');
      } else {
        showToast('Archivo descargado — adjúntalo al correo');
        const subject = encodeURIComponent('Documento escaneado');
        const body = encodeURIComponent('Adjunto el documento (' + item.filename + ').');
        window.location.href = `mailto:?subject=${subject}&body=${body}`;
      }
    }
  }

  // Carga JSZip solo cuando el usuario exporta el historial completo.
  let jsZipPromise = null;
  function cargarJsZip() {
    if (jsZipPromise) return jsZipPromise;
    jsZipPromise = new Promise((res, rej) => {
      if (window.JSZip) return res(window.JSZip);
      const s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
      s.onload = () => window.JSZip ? res(window.JSZip) : rej(new Error('JSZip no disponible'));
      s.onerror = () => rej(new Error('No se pudo cargar la librería ZIP'));
      document.head.appendChild(s);
    });
    return jsZipPromise;
  }

  async function exportarTodo() {
    const items = await listarHistorial();
    if (!items.length) { showToast('No hay documentos para exportar'); return; }
    try {
      showToast('Preparando archivo…');
      const JSZip = await cargarJsZip();
      const zip = new JSZip();
      // Evita colisiones si dos documentos comparten nombre.
      const used = new Set();
      items.forEach(item => {
        let name = item.filename;
        let n = 1;
        while (used.has(name)) {
          const dot = item.filename.lastIndexOf('.');
          const base = dot > 0 ? item.filename.slice(0, dot) : item.filename;
          const ext  = dot > 0 ? item.filename.slice(dot) : '';
          name = `${base}_${n}${ext}`;
          n++;
        }
        used.add(name);
        zip.file(name, item.blob);
      });
      const blob = await zip.generateAsync({ type: 'blob' });
      const filename = `escaner_historial_${new Date().toISOString().slice(0, 10)}.zip`;
      const ok = await compartirBlob(blob, filename, 'application/zip', 'Historial de documentos', 'Historial');
      if (!ok) descargarBlob(blob, filename);
      showToast(`${items.length} documento${items.length > 1 ? 's' : ''} exportado${items.length > 1 ? 's' : ''}`);
    } catch (e) {
      console.error(e);
      showToast('Error al exportar: ' + e.message);
    }
  }
  window.exportarTodo = exportarTodo;

  async function vaciarHistorial() {
    const items = await listarHistorial();
    if (!items.length) { showToast('El historial ya está vacío'); return; }
    if (!confirm(`¿Borrar los ${items.length} documento${items.length > 1 ? 's' : ''} guardado${items.length > 1 ? 's' : ''}? Esta acción no se puede deshacer.`)) return;
    try {
      const db = await openHistDB();
      await new Promise((res, rej) => {
        const tx = db.transaction(HIST_STORE, 'readwrite');
        tx.objectStore(HIST_STORE).clear();
        tx.oncomplete = res;
        tx.onerror = () => rej(tx.error);
      });
      await renderHistorial();
      await actualizarBadgeHistorial();
      showToast('Historial vaciado');
    } catch (e) {
      console.error(e);
      showToast('Error al vaciar: ' + e.message);
    }
  }
  window.vaciarHistorial = vaciarHistorial;

  // Render inicial
  renderSlots();
  actualizarBadgeHistorial();

  // ============= PWA: instalación =============

  // 1. Registrar el service worker + detección automática de actualizaciones.
  //    Al subir una versión nueva (cambiando CACHE en sw.js) todos los
  //    dispositivos ven el banner "Nueva versión disponible" al abrir la app.
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', async () => {
      try {
        const reg = await navigator.serviceWorker.register('sw.js');

        // Fuerza una comprobación de update en cada apertura de la app.
        reg.update().catch(() => {});

        // Vuelve a comprobar cuando la pestaña recupera foco (usuario abre la PWA).
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') reg.update().catch(() => {});
        });

        function mostrarAvisoActualizacion(worker) {
          const banner = document.getElementById('updateBanner');
          banner.classList.add('show');
          document.getElementById('btnActualizar').onclick = () => {
            banner.classList.remove('show');
            if (worker) worker.postMessage({ type: 'SKIP_WAITING' });
          };
        }

        // Si ya había un SW esperando cuando se cargó la página, avisar.
        if (reg.waiting && navigator.serviceWorker.controller) {
          mostrarAvisoActualizacion(reg.waiting);
        }

        // Cuando el navegador detecta un sw.js nuevo, seguir su instalación.
        reg.addEventListener('updatefound', () => {
          const nw = reg.installing;
          if (!nw) return;
          nw.addEventListener('statechange', () => {
            if (nw.state === 'installed' && navigator.serviceWorker.controller) {
              mostrarAvisoActualizacion(nw);
            }
          });
        });

        // Cuando el nuevo SW toma control, recargar una sola vez.
        let refreshing = false;
        navigator.serviceWorker.addEventListener('controllerchange', () => {
          if (refreshing) return;
          refreshing = true;
          window.location.reload();
        });
      } catch (err) {
        console.warn('SW no registrado:', err.message);
      }
    });
  }

  // 2. Chrome/Edge/Android — captura el evento y muestra nuestro banner
  let deferredInstall = null;
  const banner = document.getElementById('installBanner');
  const btnInstall = document.getElementById('btnInstall');

  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    deferredInstall = e;
    if (sessionStorage.getItem('installDismissed') !== '1' &&
        !window.matchMedia('(display-mode: standalone)').matches) {
      installBannerReady = true;
      banner.classList.add('show');
    }
  });

  btnInstall.addEventListener('click', async () => {
    if (!deferredInstall) return;
    banner.classList.remove('show');
    deferredInstall.prompt();
    const { outcome } = await deferredInstall.userChoice;
    deferredInstall = null;
    if (outcome === 'accepted') showToast('¡App instalada!');
  });

  window.ocultarInstall = () => {
    banner.classList.remove('show');
    sessionStorage.setItem('installDismissed', '1');
  };

  // 3. iOS (Safari) — no dispara beforeinstallprompt, mostramos instrucciones
  const esIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
  const yaInstalada = window.navigator.standalone === true ||
                      window.matchMedia('(display-mode: standalone)').matches;
  if (esIOS && !yaInstalada && sessionStorage.getItem('iosHintDismissed') !== '1') {
    document.getElementById('iosHint').classList.add('show');
  }
  window.ocultarIOS = () => {
    document.getElementById('iosHint').classList.remove('show');
    sessionStorage.setItem('iosHintDismissed', '1');
  };

  window.addEventListener('appinstalled', () => {
    banner.classList.remove('show');
    document.getElementById('iosHint').classList.remove('show');
    showToast('App instalada');
  });
