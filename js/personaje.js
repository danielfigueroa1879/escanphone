/* ============================================================================
   Creador de personajes — mujer fitness ilustrada, 100% en el navegador.
   Todo se dibuja con canvas (sin IA ni servidores): silueta con curvas
   suaves, volumen con sombras difusas, brillo especular de piel, definición
   muscular de piernas, venas en los pies, uñas metálicas y calzado.
   El lienzo mide 1000 × 2000; la figura mira de frente con los pies girados
   hacia afuera para que el calzado se vea de perfil.
   ========================================================================== */
(function () {
  'use strict';

  const $ = id => document.getElementById(id);
  const root = $('appPersonaje');
  if (!root) return;
  const $$ = s => [...root.querySelectorAll(s)];
  const mk = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
  const toast = m => { if (typeof window.showToast === 'function') window.showToast(m); };
  const W = 1000, H = 2000;

  const opts = {
    cintura: 70, cadera: 55, muslos: 60, gemelos: 70, definicion: 60,
    piel: '#d79b74', brillo: 75, venas: 55,
    cabello: '#2b1d16', peinado: 'coleta',
    top: '#15161b', short: '#15161b', acento: '#e5484d',
    unas: 'metal', calzado: 'stiletto', fondo: 'gym', vista: 'cuerpo'
  };

  // ---------------- utilidades de color y trazado ----------------
  const hex2rgb = h => { const n = parseInt(h.slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255]; };
  const rgb = (c, a = 1) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
  const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  const shade = (c, k) => k < 0 ? mix(c, [0, 0, 0], -k) : mix(c, [255, 255, 255], k);

  // Curva suave (Catmull-Rom → Bézier) que pasa por todos los puntos.
  function smooth(path, pts, closed = true) {
    const n = pts.length;
    path.moveTo(pts[0][0], pts[0][1]);
    const last = closed ? n : n - 1;
    for (let i = 0; i < last; i++) {
      const p0 = closed ? pts[(i - 1 + n) % n] : pts[Math.max(0, i - 1)];
      const p1 = pts[i], p2 = pts[(i + 1) % n];
      const p3 = closed ? pts[(i + 2) % n] : pts[Math.min(n - 1, i + 2)];
      path.bezierCurveTo(p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6,
        p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6, p2[0], p2[1]);
    }
    if (closed) path.closePath();
    return path;
  }
  const shape = pts => smooth(new Path2D(), pts, true);
  const line = pts => smooth(new Path2D(), pts, false);

  // Capa difusa: se dibuja a baja resolución y se amplía (desenfoque barato
  // que funciona en todos los navegadores), recortada a una forma.
  let tmp = null;
  function soft(ctx, clip, draw, f = 6) {
    const tw = Math.ceil(W / f), th = Math.ceil(H / f);
    if (!tmp || tmp.width !== tw || tmp.height !== th) tmp = mk(tw, th);
    const t = tmp.getContext('2d');
    t.setTransform(1, 0, 0, 1, 0, 0); t.clearRect(0, 0, tw, th);
    t.setTransform(1 / f, 0, 0, 1 / f, 0, 0);
    t.lineCap = 'round'; t.lineJoin = 'round';
    draw(t);
    ctx.save();
    if (clip) ctx.clip(clip);
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(tmp, 0, 0, tw, th, 0, 0, tw * f, th * f);
    ctx.restore();
  }
  function strokeIn(ctx, clip, path, color, width) {
    ctx.save(); if (clip) ctx.clip(clip);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.strokeStyle = color; ctx.lineWidth = width; ctx.stroke(path);
    ctx.restore();
  }

  // Lado izquierdo (del espectador) y su espejo para el derecho.
  const sideX = s => x => s > 0 ? x : W - x;
  const mapPts = (pts, X) => pts.map(([x, y]) => [X(x), y]);

  // ---------------- geometría según los controles ----------------
  function geo() {
    const o = opts;
    const waist = 112 - o.cintura * .3;                 // media cintura
    const hip = 158 + o.cadera * .36;                   // media cadera
    const thigh = 8 + o.muslos * .26;                   // volumen de muslo
    const calf = o.gemelos / 100;
    const gOut = 4 + calf * 34, gIn = 4 + calf * 24;    // gemelo externo / interno
    const sol = 2 + calf * 16;                          // sóleo
    return { waist, hip, thigh, calf, gOut, gIn, sol };
  }

  // Pierna completa + pie como una sola silueta (lado izquierdo).
  function legPts(g, X) {
    const heel = opts.calzado === 'stiletto';
    const outer = [
      [500 - g.hip, 900], [500 - g.hip - g.thigh * .45, 1000], [500 - g.hip + 16 - g.thigh * .3, 1120],
      [372 - g.thigh * .12, 1255], [374, 1338], [370 - g.gOut * .55, 1405], [368 - g.gOut, 1462],
      [376 - g.sol, 1580], [394, 1680], [401, 1740]
    ];
    const foot = heel ? [
      [398, 1776], [372, 1812], [336, 1842], [300, 1862], [266, 1874], [251, 1890],
      [286, 1889], [328, 1876], [376, 1854], [420, 1834], [446, 1826], [458, 1806], [455, 1772]
    ] : [
      [398, 1778], [366, 1818], [326, 1846], [300, 1858], [292, 1856], [280, 1862], [270, 1860], [256, 1868],
      [240, 1874], [230, 1888], [240, 1900], [320, 1903], [400, 1903], [446, 1900], [462, 1880], [462, 1820], [455, 1776]
    ];
    const inner = [
      [449, 1742], [447, 1684], [450 + g.sol * .5, 1600], [462 + g.gIn, 1492], [462 + g.gIn * .5, 1420],
      [467, 1340], [476 + g.thigh * .25, 1268], [482, 1150], [493, 1030], [499, 990]
    ];
    return mapPts([...outer, ...foot, ...inner], X);
  }
  function armPts(X) {
    return mapPts([
      [352, 390], [326, 420], [316, 520], [314, 640], [313, 700], [309, 800], [316, 950], [313, 1010],
      [318, 1062], [334, 1080], [352, 1066], [352, 1004], [345, 952], [343, 820], [347, 700], [355, 560],
      [366, 470], [372, 425]
    ], X);
  }
  function torsoPts(g) {
    const R = [[524, 286], [528, 346], [600, 378], [648, 398], [640, 470], [626, 562],
      [500 + g.waist + 8, 670], [500 + g.waist, 730], [500 + g.hip * .88, 820], [500 + g.hip, 905], [500 + g.hip - 6, 980]];
    const L = R.map(([x, y]) => [W - x, y]).reverse();
    return [...R, [500, 1000], ...L];
  }
  const headPts = [[500, 116], [558, 134], [578, 196], [571, 254], [546, 294], [500, 314], [454, 294], [429, 254], [422, 196], [442, 134]];

  // ---------------- pintura de piel ----------------
  function paintSkin(ctx, path, edge = 46) {
    const sk = hex2rgb(opts.piel);
    const wet = opts.brillo / 100;
    ctx.save(); ctx.clip(path);
    const gr = ctx.createLinearGradient(0, 0, 0, H);
    gr.addColorStop(0, rgb(shade(sk, .04))); gr.addColorStop(1, rgb(shade(sk, -.06 - wet * .06)));
    ctx.fillStyle = gr; ctx.fillRect(0, 0, W, H);
    ctx.restore();
    // Bordes más oscuros = volumen redondeado.
    soft(ctx, path, t => { t.strokeStyle = rgb(shade(sk, -.36 - wet * .1), .7); t.lineWidth = edge * .75; t.stroke(path); });
  }

  function definition(ctx, clip, g, X) {
    const a = opts.definicion / 100;
    if (a <= 0) return;
    const sk = hex2rgb(opts.piel);
    const dark = rgb(shade(sk, -.55), .55 * a), light = rgb(shade(sk, .35), .45 * a);
    const P = pts => line(mapPts(pts, X));
    soft(ctx, clip, t => {
      t.lineWidth = 15; t.strokeStyle = dark;
      // Gemelo en forma de gota: borde inferior de las dos cabezas y la separación.
      t.stroke(P([[376 - g.gOut * .3, 1430], [392, 1520], [418, 1556]]));
      t.stroke(P([[466 + g.gIn * .6, 1470], [458, 1540], [430, 1566]]));
      t.lineWidth = 9; t.stroke(P([[420, 1392], [424, 1470], [426, 1540]]));
      // Sóleo asomando bajo el gemelo (lado externo e interno).
      t.lineWidth = 11; t.stroke(P([[384 - g.sol * .6, 1572], [390, 1640], [398, 1690]]));
      t.stroke(P([[452 + g.sol * .3, 1585], [452, 1640]]));
      // Muslo: vasto interno (gota sobre la rodilla), separación externa y recto femoral.
      t.lineWidth = 13; t.stroke(P([[456, 1236], [470, 1290], [452, 1322]]));
      t.lineWidth = 9; t.stroke(P([[352 - g.thigh * .2, 1080], [368, 1180], [380, 1290]]));
      t.stroke(P([[418, 1060], [420, 1170], [416, 1280]]));
      // Rodilla.
      t.stroke(P([[394, 1350], [416, 1372], [442, 1352]]));
      // Brillo sobre los volúmenes (gemelo, sóleo, cuádriceps).
      t.strokeStyle = light; t.lineWidth = 16;
      t.stroke(P([[382 - g.gOut * .7, 1420], [376 - g.gOut * .8, 1470], [382, 1510]]));
      t.stroke(P([[468 + g.gIn * .7, 1430], [472 + g.gIn * .6, 1480]]));
      t.lineWidth = 12; t.stroke(P([[386 - g.sol * .5, 1600], [394, 1650]]));
      t.lineWidth = 18; t.stroke(P([[398, 1060], [396, 1160], [402, 1250]]));
      t.stroke(P([[456, 1250], [462, 1290]]));
    });
  }

  // Brillo especular extremo (aspecto húmedo / aceite).
  function gloss(ctx, clip, strokes) {
    const a = opts.brillo / 100;
    if (a <= 0) return;
    soft(ctx, clip, t => {
      t.strokeStyle = `rgba(255,248,240,${.42 * a})`;
      strokes.forEach(([p, w]) => { t.lineWidth = w * 2.2; t.stroke(p); });
    });
    ctx.save(); ctx.clip(clip);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.strokeStyle = `rgba(255,255,255,${.78 * a})`;
    ctx.shadowColor = 'rgba(255,255,255,.8)'; ctx.shadowBlur = 6 * a;
    strokes.forEach(([p, w]) => { ctx.lineWidth = Math.max(1.2, w * .22); ctx.stroke(p); });
    ctx.restore();
  }
  function legGloss(g, X) {
    const P = pts => line(mapPts(pts, X));
    return [
      [P([[394, 1030], [390, 1130], [396, 1235]]), 18],
      [P([[404, 1324], [412, 1340]]), 7],
      [P([[422, 1392], [420, 1500], [423, 1620], [425, 1715]]), 11],
      [P([[372 - g.gOut * .85, 1425], [366 - g.gOut * .95, 1470], [374 - g.gOut * .4, 1525]]), 13],
      [P([[470 + g.gIn * .75, 1455], [472 + g.gIn * .7, 1500]]), 9],
      [P([[383 - g.sol * .6, 1600], [392, 1660]]), 8],
      [P([[402, 1788], [376, 1814], [340, 1840]]), 8]
    ];
  }

  // Venas naturales color piel en el empeine (y tobillo interno).
  function veins(ctx, clip, X) {
    const a = opts.venas / 100;
    if (a <= 0) return;
    const sk = hex2rgb(opts.piel);
    const vcol = mix(shade(sk, -.25), [70, 92, 140], .4);
    const bare = opts.calzado !== 'stiletto';
    const vs = [
      [[408, 1770], [394, 1792], [376, 1814], [352, 1834], ...(bare ? [[318, 1852]] : [])],
      [[394, 1793], [404, 1812], [392, 1832], [372, 1848], ...(bare ? [[340, 1858]] : [])],
      [[376, 1815], [362, 1826], [356, 1846]],
      [[449, 1735], [452, 1690], [455, 1640], [456, 1600]]
    ].map(p => line(mapPts(p, X)));
    ctx.save(); ctx.clip(clip); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    vs.forEach((p, i) => {
      const w = i === 3 ? 2.6 : 3.4, k = i === 3 ? .55 : 1;
      ctx.save(); ctx.translate(1, 2.2); ctx.strokeStyle = rgb(shade(sk, -.5), .28 * a * k); ctx.lineWidth = w + 2; ctx.stroke(p); ctx.restore();
      ctx.strokeStyle = rgb(vcol, .75 * a * k); ctx.lineWidth = w; ctx.stroke(p);
      ctx.save(); ctx.translate(-.8, -1.3); ctx.strokeStyle = rgb(shade(sk, .45), .55 * a * k); ctx.lineWidth = w * .45; ctx.stroke(p); ctx.restore();
    });
    ctx.restore();
  }

  // ---------------- uñas metálicas ----------------
  const NAILS = { metal: '#eef1f5', plata: '#c9ced6', rojo: '#c8102e', natural: '#f1c9b8', negro: '#16161a' };
  function nail(ctx, x, y, rx, ry, rot = 0) {
    const base = hex2rgb(NAILS[opts.unas] || NAILS.metal);
    const metallic = opts.unas === 'metal' || opts.unas === 'plata';
    ctx.save(); ctx.translate(x, y); ctx.rotate(rot);
    const gr = ctx.createLinearGradient(-rx, -ry, rx, ry);
    gr.addColorStop(0, rgb(shade(base, .6))); gr.addColorStop(.35, rgb(base));
    gr.addColorStop(.55, rgb(shade(base, metallic ? -.35 : -.12))); gr.addColorStop(.8, rgb(shade(base, .7))); gr.addColorStop(1, rgb(shade(base, -.2)));
    ctx.beginPath(); ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
    ctx.fillStyle = gr; ctx.fill();
    ctx.lineWidth = 1; ctx.strokeStyle = rgb(shade(base, -.45), .7); ctx.stroke();
    ctx.beginPath(); ctx.ellipse(-rx * .3, -ry * .35, rx * .28, ry * .2, -.4, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,.95)'; ctx.fill();
    ctx.restore();
  }

  // ---------------- calzado: stiletto negro con suela roja ----------------
  // La pala lleva un corte que deja ver la base de los dedos; la punta queda
  // cerrada. Coordenadas del pie izquierdo (apunta hacia la izquierda).
  function stiletto(ctx, X) {
    const sk = hex2rgb(opts.piel);
    const P = pts => shape(mapPts(pts, X));
    // Tacón aguja.
    const heel = P([[446, 1822], [460, 1817], [455, 1838], [449, 1902], [445, 1902], [445, 1850]]);
    ctx.fillStyle = '#08080a'; ctx.fill(heel);
    ctx.fillStyle = '#c8102e'; ctx.fillRect(Math.min(X(442), X(450)), 1899, 8, 3);
    // Suela roja (se ve bajo el arco y en el canto).
    const sole = P([[452, 1828], [420, 1840], [376, 1860], [328, 1882], [286, 1895], [248, 1898], [249, 1890], [286, 1887], [328, 1874], [376, 1852], [420, 1832], [450, 1822]]);
    const sg = ctx.createLinearGradient(0, 1820, 0, 1900);
    sg.addColorStop(0, '#e01b2f'); sg.addColorStop(1, '#8e0a19');
    ctx.fillStyle = sg; ctx.fill(sole);
    // Cuerpo del zapato (lateral + talón + puntera) con el corte en la pala.
    const body = P([
      [458, 1784], [462, 1806], [456, 1826], [420, 1836], [376, 1856], [328, 1878], [286, 1891], [248, 1893],
      [252, 1882], [266, 1872], [288, 1863], [298, 1866],
      [306, 1880], [322, 1884], [340, 1878],                        // borde del corte (base de los dedos a la vista)
      [354, 1858], [384, 1838], [420, 1818], [446, 1800]
    ]);
    const bg = ctx.createLinearGradient(0, 1780, 0, 1900);
    bg.addColorStop(0, '#2a2a30'); bg.addColorStop(.5, '#0b0b0e'); bg.addColorStop(1, '#000');
    ctx.fillStyle = bg; ctx.fill(body);
    // Base de los dedos dentro del corte: pliegues suaves.
    const cuts = [[[303, 1866], [309, 1880]], [[314, 1863], [319, 1881]], [[325, 1861], [329, 1880]], [[336, 1860], [338, 1874]]];
    ctx.save(); ctx.lineCap = 'round';
    cuts.forEach(c => { ctx.strokeStyle = rgb(shade(sk, -.5), .85); ctx.lineWidth = 2.6; ctx.stroke(line(mapPts(c, X))); });
    // Brillo sobre las bases de los dedos.
    ctx.strokeStyle = rgb(shade(sk, .5), .7 * opts.brillo / 100); ctx.lineWidth = 2;
    ctx.stroke(line(mapPts([[306, 1868], [320, 1864], [334, 1862]], X)));
    ctx.restore();
    // Charol: reflejos fuertes.
    ctx.save(); ctx.clip(body); ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(255,255,255,.85)'; ctx.lineWidth = 3.5;
    ctx.stroke(line(mapPts([[258, 1880], [276, 1872], [296, 1866]], X)));
    ctx.lineWidth = 2.5; ctx.stroke(line(mapPts([[360, 1858], [400, 1840], [440, 1822]], X)));
    ctx.strokeStyle = 'rgba(255,255,255,.55)'; ctx.lineWidth = 3;
    ctx.stroke(line(mapPts([[456, 1790], [459, 1808]], X)));
    ctx.restore();
    ctx.strokeStyle = 'rgba(255,255,255,.4)'; ctx.lineWidth = 1.2; ctx.stroke(heel);
  }
  function toenails(ctx, X) {
    const s = X(1) > X(0) ? 1 : -1, sk = hex2rgb(opts.piel);
    // Separación entre los dedos.
    ctx.save(); ctx.lineCap = 'round'; ctx.strokeStyle = rgb(shade(sk, -.45), .75); ctx.lineWidth = 2;
    [[[262, 1868], [266, 1886]], [[276, 1862], [280, 1882]], [[289, 1858], [292, 1876]]].forEach(c => ctx.stroke(line(mapPts(c, X))));
    ctx.restore();
    nail(ctx, X(240), 1882, 8, 6, -.45 * s);
    nail(ctx, X(266), 1866, 5.5, 4.2, -.25 * s);
    nail(ctx, X(280), 1861, 4.6, 3.6, -.25 * s);
    nail(ctx, X(292), 1858, 3.8, 3, -.2 * s);
  }

  // ---------------- cabeza y cabello ----------------
  function hairBack(ctx) {
    const hc = hex2rgb(opts.cabello);
    let p;
    if (opts.peinado === 'coleta') {
      p = shape([[548, 128], [600, 150], [626, 230], [640, 330], [662, 430], [664, 520], [640, 560], [628, 470], [604, 360], [574, 250], [552, 180]]);
    } else {
      p = shape([[500, 98], [590, 128], [618, 230], [622, 360], [632, 470], [606, 548], [560, 520], [540, 400], [460, 400], [440, 520], [394, 548], [368, 470], [378, 360], [382, 230], [410, 128]]);
    }
    ctx.fillStyle = rgb(hc); ctx.fill(p);
    soft(ctx, p, t => { t.strokeStyle = rgb(shade(hc, .35), .7); t.lineWidth = 22; t.stroke(line([[590, 200], [612, 330], [630, 450]])); if (opts.peinado !== 'coleta') t.stroke(line([[410, 200], [388, 330], [372, 450]])); });
    return p;
  }
  function hairFront(ctx) {
    const hc = hex2rgb(opts.cabello);
    const p = shape([[500, 100], [566, 116], [594, 180], [586, 248], [574, 232], [566, 186], [540, 152], [500, 142], [460, 152], [434, 186], [426, 232], [414, 248], [406, 180], [434, 116]]);
    ctx.fillStyle = rgb(hc); ctx.fill(p);
    soft(ctx, p, t => { t.strokeStyle = rgb(shade(hc, .4), .8); t.lineWidth = 18; t.stroke(line([[456, 126], [500, 116], [546, 128]])); });
    if (opts.peinado === 'coleta') {
      ctx.fillStyle = rgb(shade(hc, -.3)); ctx.beginPath(); ctx.ellipse(566, 140, 12, 9, .6, 0, Math.PI * 2); ctx.fill();
    }
  }
  function face(ctx) {
    const sk = hex2rgb(opts.piel), hc = hex2rgb(opts.cabello);
    ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    [[1, 0], [-1, 0]].forEach(([s]) => {
      const X = x => s > 0 ? x : W - x;
      // Ceja
      ctx.strokeStyle = rgb(shade(hc, .1)); ctx.lineWidth = 4.5;
      ctx.stroke(line([[X(456), 188], [X(472), 181], [X(490), 185]]));
      // Ojo almendrado
      const eye = shape([[X(458), 208], [X(472), 199], [X(489), 204], [X(474), 213]]);
      ctx.fillStyle = '#fbf7f4'; ctx.fill(eye);
      ctx.save(); ctx.clip(eye);
      ctx.fillStyle = '#4a2e1e'; ctx.beginPath(); ctx.arc(X(474), 206, 7, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#120a06'; ctx.beginPath(); ctx.arc(X(474), 206, 3.4, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(X(476), 203.5, 1.8, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
      ctx.strokeStyle = '#1a0f0a'; ctx.lineWidth = 3;
      ctx.stroke(line([[X(456), 209], [X(470), 199], [X(490), 203], [X(494), 200]]));
      ctx.strokeStyle = rgb(shade(sk, -.35), .6); ctx.lineWidth = 1.2;
      ctx.stroke(line([[X(462), 212], [X(474), 214], [X(486), 208]]));
    });
    // Nariz
    ctx.strokeStyle = rgb(shade(sk, -.35), .55); ctx.lineWidth = 2.2;
    ctx.stroke(line([[506, 218], [509, 238], [500, 246], [492, 243]]));
    // Labios
    const up = shape([[476, 266], [490, 259], [500, 262], [510, 259], [524, 266], [500, 268]]);
    const lo = shape([[477, 267], [500, 269], [523, 267], [512, 278], [500, 280], [488, 278]]);
    ctx.fillStyle = '#b5555e'; ctx.fill(up); ctx.fillStyle = '#c96b72'; ctx.fill(lo);
    ctx.fillStyle = 'rgba(255,255,255,.55)'; ctx.beginPath(); ctx.ellipse(505, 273, 6, 2, 0, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    // Rubor
    soft(ctx, null, t => { t.fillStyle = 'rgba(214,110,110,.35)'; [[466, 238], [534, 238]].forEach(([x, y]) => { t.beginPath(); t.ellipse(x, y, 20, 12, 0, 0, Math.PI * 2); t.fill(); }); });
  }

  // ---------------- ropa ----------------
  function sportsTop(ctx) {
    const c = hex2rgb(opts.top);
    const body = shape([[374, 470], [452, 444], [500, 476], [548, 444], [626, 470], [625, 560], [500, 578], [375, 560]]);
    ctx.fillStyle = rgb(c); ctx.fill(body);
    soft(ctx, body, t => { t.strokeStyle = rgb(shade(c, -.6), .9); t.lineWidth = 34; t.stroke(body); t.strokeStyle = rgb(shade(c, .35), .5); t.lineWidth = 18; t.stroke(line([[430, 500], [500, 515], [570, 500]])); });
    ctx.save(); ctx.lineCap = 'round';
    ctx.strokeStyle = rgb(c); ctx.lineWidth = 15;
    ctx.stroke(line([[472, 362], [462, 404], [452, 448]])); ctx.stroke(line([[528, 362], [538, 404], [548, 448]]));
    ctx.strokeStyle = opts.acento; ctx.lineWidth = 5;
    ctx.stroke(line([[384, 552], [500, 568], [616, 552]]));
    ctx.restore();
  }
  function shorts(ctx, g) {
    const c = hex2rgb(opts.short);
    const hw = g.waist + (g.hip * .88 - g.waist) * (22 / 90);
    const R = [[500 + hw + 3, 750], [500 + g.hip * .88 + 4, 820], [500 + g.hip + 4, 905], [500 + g.hip + g.thigh * .3 + 4, 968],
      [500 + g.hip + g.thigh * .3 - 4, 980], [560, 1012], [512, 1034]];
    const L = R.map(([x, y]) => [W - x, y]).reverse();
    const p = shape([...R, [500, 1016], ...L]);
    ctx.fillStyle = rgb(c); ctx.fill(p);
    soft(ctx, p, t => { t.strokeStyle = rgb(shade(c, -.6), .9); t.lineWidth = 40; t.stroke(p); t.strokeStyle = rgb(shade(c, .3), .45); t.lineWidth = 24; t.stroke(line([[400, 860], [410, 960]])); t.stroke(line([[600, 860], [590, 960]])); });
    ctx.save(); ctx.clip(p);
    ctx.fillStyle = rgb(shade(c, -.25)); ctx.fillRect(0, 748, W, 20);
    ctx.fillStyle = opts.acento; ctx.fillRect(0, 766, W, 3);
    ctx.strokeStyle = rgb(shade(c, -.5)); ctx.lineWidth = 2; ctx.stroke(line([[500, 770], [500, 1016]]));
    ctx.restore();
  }
  function abs(ctx, clip) {
    const a = opts.definicion / 100, sk = hex2rgb(opts.piel);
    soft(ctx, clip, t => {
      t.strokeStyle = rgb(shade(sk, -.5), .45 * a); t.lineWidth = 9;
      t.stroke(line([[500, 590], [500, 660], [500, 740]]));
      [[612], [650], [690]].forEach(([y]) => t.stroke(line([[468, y], [484, y + 4], [500, y]])) || t.stroke(line([[500, y], [516, y + 4], [532, y]])));
      t.lineWidth = 12; t.stroke(line([[430, 620], [446, 690], [460, 745]])); t.stroke(line([[570, 620], [554, 690], [540, 745]]));
      t.strokeStyle = rgb(shade(sk, .35), .4 * a); t.lineWidth = 14;
      t.stroke(line([[484, 600], [484, 720]])); t.stroke(line([[516, 600], [516, 720]]));
    });
  }

  // ---------------- fondo ----------------
  function background(ctx) {
    if (opts.fondo === 'transparente') return;
    if (opts.fondo === 'estudio') {
      const g = ctx.createRadialGradient(500, 800, 100, 500, 900, 1300);
      g.addColorStop(0, '#f4f4f6'); g.addColorStop(1, '#b9bcc4');
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H); return;
    }
    const wall = ctx.createLinearGradient(0, 0, 0, 1860);
    wall.addColorStop(0, '#1b1f28'); wall.addColorStop(1, '#2c323e');
    ctx.fillStyle = wall; ctx.fillRect(0, 0, W, 1860);
    ctx.fillStyle = 'rgba(255,255,255,.05)';
    for (let x = 60; x < W; x += 180) ctx.fillRect(x, 0, 70, 1860);
    soft(ctx, null, t => { t.fillStyle = 'rgba(255,214,170,.09)'; t.beginPath(); t.ellipse(500, 820, 560, 900, 0, 0, Math.PI * 2); t.fill(); }, 12);
    const floor = ctx.createLinearGradient(0, 1860, 0, H);
    floor.addColorStop(0, '#3a3f49'); floor.addColorStop(1, '#14161b');
    ctx.fillStyle = floor; ctx.fillRect(0, 1860, W, H - 1860);
  }

  // ---------------- composición ----------------
  function draw(ctx) {
    const g = geo();
    ctx.clearRect(0, 0, W, H);
    background(ctx);
    // Sombra en el piso.
    soft(ctx, null, t => { t.fillStyle = 'rgba(0,0,0,.45)'; t.beginPath(); t.ellipse(500, 1902, 300, 22, 0, 0, Math.PI * 2); t.fill(); }, 8);
    hairBack(ctx);

    const torso = shape(torsoPts(g));
    const legs = [1, -1].map(s => ({ X: sideX(s), p: shape(legPts(g, sideX(s))) }));
    const arms = [1, -1].map(s => ({ X: sideX(s), p: shape(armPts(sideX(s))) }));
    const head = shape(headPts);

    legs.forEach(({ p, X }) => {
      paintSkin(ctx, p, 50);
      definition(ctx, p, g, X);
      veins(ctx, p, X);
      gloss(ctx, p, legGloss(g, X));
    });
    paintSkin(ctx, torso, 56);
    abs(ctx, torso);
    gloss(ctx, torso, [
      [line([[440, 372], [470, 384]]), 8], [line([[560, 372], [530, 384]]), 8],
      [line([[490, 600], [490, 720]]), 9], [line([[436, 630], [452, 720]]), 10], [line([[564, 630], [548, 720]]), 10],
      [line([[372, 840], [356, 900]]), 12], [line([[628, 840], [644, 900]]), 12]
    ]);
    shorts(ctx, g);
    sportsTop(ctx);
    if (opts.calzado === 'stiletto') legs.forEach(({ X }) => stiletto(ctx, X));
    else legs.forEach(({ X }) => toenails(ctx, X));

    arms.forEach(({ p, X }) => {
      paintSkin(ctx, p, 36);
      soft(ctx, p, t => { t.strokeStyle = rgb(shade(hex2rgb(opts.piel), -.5), .3 * opts.definicion / 100); t.lineWidth = 9; t.stroke(line(mapPts([[330, 430], [338, 520]], X))); });
      gloss(ctx, p, [[line(mapPts([[330, 450], [326, 580], [326, 690]], X)), 10], [line(mapPts([[323, 780], [324, 920]], X)), 8]]);
      // Dedos y uñas.
      ctx.save(); ctx.clip(p); ctx.strokeStyle = rgb(shade(hex2rgb(opts.piel), -.4), .6); ctx.lineWidth = 1.6;
      [[328, 1030, 330, 1070], [340, 1028, 341, 1076], [349, 1026, 350, 1064]].forEach(([a, b, c, d]) => ctx.stroke(line(mapPts([[a, b], [c, d]], X))));
      ctx.restore();
      const s = X(1) > X(0) ? 1 : -1;
      nail(ctx, X(325), 1068, 4.2, 6, .1 * s); nail(ctx, X(336), 1074, 4.2, 6.2, 0); nail(ctx, X(347), 1066, 4, 5.8, -.1 * s);
    });

    paintSkin(ctx, head, 40);
    gloss(ctx, head, [[line([[540, 168], [556, 220]]), 7], [line([[506, 214], [507, 234]]), 4]]);
    face(ctx);
    hairFront(ctx);
  }

  // ---------------- interfaz ----------------
  const full = mk(W, H);
  const view = $('pjCanvas');
  let queued = false;
  function render() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      draw(full.getContext('2d'));
      const crop = opts.vista === 'piernas' ? [0, 940, W, 1060] : [0, 0, W, H];
      view.width = crop[2]; view.height = crop[3];
      const vc = view.getContext('2d');
      vc.clearRect(0, 0, view.width, view.height);
      vc.drawImage(full, crop[0], crop[1], crop[2], crop[3], 0, 0, crop[2], crop[3]);
    });
  }
  function output() {
    const c = mk(view.width, view.height);
    c.getContext('2d').drawImage(view, 0, 0);
    return c;
  }

  $$('[data-pj]').forEach(inp => {
    const k = inp.dataset.pj, out = inp.parentElement.querySelector('output');
    inp.value = opts[k]; if (out) out.textContent = inp.value + ' %';
    inp.addEventListener('input', () => { opts[k] = +inp.value; if (out) out.textContent = inp.value + ' %'; render(); });
  });
  $$('[data-pjopt]').forEach(group => {
    const k = group.dataset.pjopt;
    group.querySelectorAll('button').forEach(b => {
      b.setAttribute('aria-pressed', b.dataset.v === opts[k]);
      b.addEventListener('click', () => {
        opts[k] = b.dataset.v;
        group.querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', x === b));
        render();
      });
    });
  });
  $$('[data-pjcolor]').forEach(group => {
    const k = group.dataset.pjcolor;
    group.querySelectorAll('[data-v]').forEach(b => {
      b.style.background = b.dataset.v;
      b.setAttribute('aria-pressed', b.dataset.v === opts[k]);
      b.addEventListener('click', () => {
        opts[k] = b.dataset.v;
        group.querySelectorAll('[data-v]').forEach(x => x.setAttribute('aria-pressed', x === b));
        render();
      });
    });
  });

  $('pjDownload').addEventListener('click', () => {
    output().toBlob(blob => {
      if (!blob) return;
      const url = URL.createObjectURL(blob), a = document.createElement('a');
      a.href = url; a.download = 'personaje-fitness.png';
      document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 8000);
    }, 'image/png');
  });
  $('pjToEditor').addEventListener('click', () => {
    if (typeof window.editorAbrirCanvas !== 'function') { toast('El editor no está disponible.'); return; }
    const c = output();
    window.abrirHerramienta('appEditor');
    window.editorAbrirCanvas(c, 'personaje-fitness.png');
  });

  render();
})();
