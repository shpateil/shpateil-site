/* flow-title.js — розовый перелив внутри букв заголовка.
   настоящий текст остаётся в DOM (поиск, скринридеры), canvas рисуется поверх и повторяет геометрию 1:1.
   один rAF, пауза вне вьюпорта и в скрытой вкладке, стоп-кадр при prefers-reduced-motion. */
(function () {
  'use strict';

  var REDUCE = matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* палитра: широкий диапазон, чтобы перелив реально читался глазом.
     нижняя точка почти гаснет в фоне, верхняя выходит в светлый розовый. */
  var RAMP = [
    [46, 4, 26],
    [96, 8, 52],
    [158, 14, 88],
    [214, 26, 124],
    [255, 95, 217],
    [255, 196, 240]
  ];

  function rampAt(t) {
    var x = (t < 0 ? 0 : t > 0.9999 ? 0.9999 : t) * (RAMP.length - 1);
    var i = x | 0, f = x - i, a = RAMP[i], b = RAMP[i + 1];
    return [
      (a[0] + (b[0] - a[0]) * f) | 0,
      (a[1] + (b[1] - a[1]) * f) | 0,
      (a[2] + (b[2] - a[2]) * f) | 0
    ];
  }

  function smooth(x) { return x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x); }

  function hash2(x, y, s) {
    var h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(s | 0, 1442695041)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }

  function vnoise(x, y, s) {
    var xi = Math.floor(x), yi = Math.floor(y);
    var fx = smooth(x - xi), fy = smooth(y - yi);
    var a = hash2(xi, yi, s), b = hash2(xi, yi + 1, s);
    var c = hash2(xi + 1, yi, s), d = hash2(xi + 1, yi + 1, s);
    var top = a + (c - a) * fx, bot = b + (d - b) * fx;
    return top + (bot - top) * fy;
  }

  function fbm(x, y, s) {
    return vnoise(x, y, s) * 0.56 + vnoise(x * 2.07, y * 2.07, s + 3) * 0.27 + vnoise(x * 4.3, y * 4.3, s + 6) * 0.17;
  }

  var BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map(function (v) { return (v + 0.5) / 16; });

  function weak() {
    return (navigator.deviceMemory || 4) <= 4 || (navigator.hardwareConcurrency || 4) <= 4;
  }

  window.flowTitle = function (el, opts) {
    var o = opts || {};
    var seed = o.seed || 13;
    var text = (o.text || el.textContent || '').trim().replace(/\s+/g, ' ');
    if (!text) return null;

    var canvas = document.createElement('canvas');
    canvas.className = 'flow-canvas';
    canvas.setAttribute('aria-hidden', 'true');
    el.appendChild(canvas);

    var ctx = canvas.getContext('2d');
    var DPR = Math.min(window.devicePixelRatio || 1, 2);

    var W = 0, H = 0, GW = 0, GH = 0;
    var buf = document.createElement('canvas');
    var bctx = buf.getContext('2d');
    var img = null, px = null;
    var mask = document.createElement('canvas');
    var mctx = mask.getContext('2d');

    var raf = 0, visible = true, paused = false, t0 = 0, last = 0;

    /* геометрия текста: та же гарнитура, кегль, трекинг и оси что у h1 */
    function drawMask() {
      var cs = getComputedStyle(el);
      mask.width = canvas.width;
      mask.height = canvas.height;
      mctx.setTransform(1, 0, 0, 1, 0, 0);
      mctx.clearRect(0, 0, mask.width, mask.height);
      mctx.scale(DPR, DPR);

      mctx.fillStyle = '#fff';
      mctx.textAlign = 'left';
      mctx.textBaseline = 'alphabetic';
      if ('letterSpacing' in mctx) mctx.letterSpacing = (parseFloat(cs.letterSpacing) || 0) + 'px';
      mctx.font = cs.fontWeight + ' ' + parseFloat(cs.fontSize) + 'px ' + cs.fontFamily;
      if ('fontVariationSettings' in mctx) mctx.fontVariationSettings = cs.fontVariationSettings || 'normal';

      var m = mctx.measureText(text);
      var asc = m.actualBoundingBoxAscent || parseFloat(cs.fontSize) * 0.72;
      var desc = m.actualBoundingBoxDescent || parseFloat(cs.fontSize) * 0.22;
      var x = Math.max(0, (W - m.width) / 2);
      var y = (H - (asc + desc)) / 2 + asc;
      mctx.fillText(text, x, y);
    }

    function layout() {
      var r = el.getBoundingClientRect();
      if (!r.width || !r.height) return false;
      W = Math.round(r.width); H = Math.round(r.height);
      canvas.width = Math.round(W * DPR);
      canvas.height = Math.round(H * DPR);
      canvas.style.width = W + 'px';
      canvas.style.height = H + 'px';

      /* крупная пиксельная сетка: текстура должна быть видна глазом, а не сливаться
         в ровную заливку. 5-6 px на ячейку это то, что читается как «пиксели». */
      var cell = W < 420 ? 4 : 6;
      GW = Math.max(8, Math.ceil(W / cell));
      GH = Math.max(4, Math.ceil(H / cell));

      buf.width = GW; buf.height = GH;
      bctx = buf.getContext('2d');
      img = bctx.createImageData(GW, GH);
      px = new Uint32Array(img.data.buffer);
      drawMask();
      return true;
    }

    function frame(now) {
      raf = 0;
      if (!t0) t0 = now;
      if (now - last < 14) { raf = requestAnimationFrame(frame); return; }
      last = now;
      var t = (now - t0) * 0.001;

      for (var y = 0; y < GH; y++) {
        var ny = y / GH;
        for (var x = 0; x < GW; x++) {
          /* два слоя шума расходятся в разные стороны: свет ползёт по буквам */
          var n1 = fbm(x * 0.075 + t * 0.42, y * 0.07 - t * 0.16, seed);
          var n2 = vnoise(x * 0.03 - t * 0.26, y * 0.045 + t * 0.11, seed + 27);
          var v = n1 * 0.62 + n2 * 0.38;
          /* быстрая волна поперёк букв: именно она читается как перелив */
          v += 0.26 * Math.sin((x / GW) * 6.4 - t * 1.15);
          v += 0.1 * Math.sin((y / GH) * 3.1 + t * 0.7);
          v = v * 0.78 + (1 - ny) * 0.1;
          /* дизеринг сильнее: без него на крупной сетке видно полосы */
          v += (BAYER[((y & 3) << 2) | (x & 3)] - 0.5) * 0.1;
          v = v < 0 ? 0 : v > 1 ? 1 : v;
          var c = rampAt(v);
          px[y * GW + x] = (0xff000000 | (c[2] << 16) | (c[1] << 8) | c[0]) >>> 0;
        }
      }
      bctx.putImageData(img, 0, 0);

      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(buf, 0, 0, GW, GH, 0, 0, canvas.width, canvas.height);
      /* альфа-маска букв: остаётся только текст, кромки резкие */
      ctx.globalCompositeOperation = 'destination-in';
      ctx.drawImage(mask, 0, 0);
      ctx.globalCompositeOperation = 'source-over';

      if (!paused && visible) raf = requestAnimationFrame(frame);
    }

    function start() { if (paused) return; if (!raf) raf = requestAnimationFrame(frame); }
    function stop() { paused = true; if (raf) { cancelAnimationFrame(raf); raf = 0; } }

    function build() {
      var ready = (document.fonts && document.fonts.ready) || Promise.resolve();
      Promise.resolve(ready).then(function () {
        if (!layout()) return;
        if (REDUCE) { paused = true; frame(performance.now()); return; }
        paused = false;
        start();
      });
    }

    var rt = 0;
    addEventListener('resize', function () {
      clearTimeout(rt);
      rt = setTimeout(function () {
        var was = paused;
        paused = true;
        layout();
        paused = was;
        if (paused) frame(performance.now()); else start();
      }, 150);
    }, { passive: true });

    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (es) {
        visible = es[0].isIntersecting;
        if (visible) start(); else stop();
      }, { threshold: 0.02 }).observe(el);
    }
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) stop(); else if (!REDUCE) start();
    });

    build();
    return { rebuild: build, stop: stop, start: start };
  };
})();
