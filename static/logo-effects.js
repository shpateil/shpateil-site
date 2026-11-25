/* logo-effects.js — два эффекта для ника.
   режим: window.logoEffect(el, 'scan' | 'sand')
   'scan' — вариант 3, который зашёл: полоса сканлайна едет сверху вниз,
            буквы на ней раздваиваются по rgb, между строками щели.
   'sand' — вариант 2, переделан с нуля: волна проходит по буквам как по песку,
            крупинки у края волны проседают вниз и греются, глиф остаётся целым.

   общие правила для обоих: один rAF, пауза вне вьюпорта и в скрытой вкладке,
   стоп-кадр при prefers-reduced-motion, маска берётся из настоящей отрисовки текста. */
(function () {
  'use strict';

  var REDUCE = matchMedia('(prefers-reduced-motion: reduce)').matches;
  var DPR = Math.min(window.devicePixelRatio || 1, 2);

  /* розовая палитра: тёмная точка не уходит в чёрный, иначе текст пропадает на фоне */
  var PINK = [[58,6,32],[104,10,58],[160,16,92],[214,28,124],[255,95,217],[255,206,242]];
  var HOT  = [[92,8,48],[150,12,80],[214,26,122],[255,86,190],[255,150,224],[255,238,250]];

  function rampAt(ramp, t) {
    var x = (t < 0 ? 0 : t > 0.9999 ? 0.9999 : t) * (ramp.length - 1);
    var i = x | 0, f = x - i, a = ramp[i], b = ramp[i + 1];
    return [(a[0]+(b[0]-a[0])*f)|0, (a[1]+(b[1]-a[1])*f)|0, (a[2]+(b[2]-a[2])*f)|0];
  }
  function smooth(x){ return x<=0?0:x>=1?1:x*x*(3-2*x); }
  function hash2(x,y,s){
    var h=(Math.imul(x|0,374761393)+Math.imul(y|0,668265263)+Math.imul(s|0,1442695041))|0;
    h=Math.imul(h^(h>>>13),1274126177); h^=h>>>16; return (h>>>0)/4294967296;
  }
  function vnoise(x,y,s){
    var xi=Math.floor(x), yi=Math.floor(y), fx=smooth(x-xi), fy=smooth(y-yi);
    var a=hash2(xi,yi,s), b=hash2(xi,yi+1,s), c=hash2(xi+1,yi,s), d=hash2(xi+1,yi+1,s);
    var top=a+(c-a)*fx, bot=b+(d-b)*fx; return top+(bot-top)*fy;
  }
  function fbm(x,y,s){ return vnoise(x,y,s)*0.56+vnoise(x*2.07,y*2.07,s+3)*0.27+vnoise(x*4.3,y*4.3,s+6)*0.17; }
  var BAYER=[0,8,2,10,12,4,14,6,3,11,1,9,15,7,13,5].map(function(v){return (v+0.5)/16;});

  window.logoEffect = function (el, mode) {
    var text = (el.getAttribute('data-text') || el.textContent || '').trim();
    if (!text) return null;

    var cv = document.createElement('canvas');
    cv.className = 'logo-canvas';
    cv.setAttribute('aria-hidden', 'true');
    el.appendChild(cv);

    var ctx = cv.getContext('2d');
    var buf = document.createElement('canvas');
    var bctx = buf.getContext('2d');
    var img = null, px = null;
    var mask = document.createElement('canvas');
    var mctx = mask.getContext('2d');

    var W=0,H=0,GW=0,GH=0,CELL=3;
    var raf=0, visible=true, paused=false, t0=0, last=0, ready=false;

    /* маска: рисуем тот же текст теми же параметрами, что и сам h1,
       затем один раз читаем альфу — в кадре getImageData не вызывается */
    function drawMask() {
      var cs = getComputedStyle(el);
      mask.width = cv.width; mask.height = cv.height;
      mctx.setTransform(1,0,0,1,0,0);
      mctx.clearRect(0,0,mask.width,mask.height);
      mctx.scale(DPR,DPR);
      mctx.fillStyle='#fff'; mctx.textAlign='left'; mctx.textBaseline='alphabetic';
      if ('letterSpacing' in mctx) mctx.letterSpacing = (parseFloat(cs.letterSpacing)||0)+'px';
      mctx.font = cs.fontWeight+' '+parseFloat(cs.fontSize)+'px '+cs.fontFamily;
      if ('fontVariationSettings' in mctx) mctx.fontVariationSettings = cs.fontVariationSettings||'normal';
      var m = mctx.measureText(text);
      var asc = m.actualBoundingBoxAscent || parseFloat(cs.fontSize)*0.72;
      var desc = m.actualBoundingBoxDescent || parseFloat(cs.fontSize)*0.22;
      mctx.fillText(text, Math.max(0,(W-m.width)/2), (H-(asc+desc))/2+asc);
    }

    function layout(cell) {
      var r = el.getBoundingClientRect();
      if (!r.width || !r.height) return false;
      CELL = cell;
      W = Math.round(r.width); H = Math.round(r.height);
      cv.width = Math.round(W*DPR); cv.height = Math.round(H*DPR);
      cv.style.width = W+'px'; cv.style.height = H+'px';
      GW = Math.max(8, Math.ceil(W/CELL)); GH = Math.max(4, Math.ceil(H/CELL));
      buf.width=GW; buf.height=GH;
      bctx = buf.getContext('2d');
      img = bctx.createImageData(GW,GH);
      px = new Uint32Array(img.data.buffer);
      drawMask();
      return true;
    }

    function put(x,y,a,c) {
      px[y*GW+x] = (((a&255)<<24)|((c[2]&255)<<16)|((c[1]&255)<<8)|(c[0]&255))>>>0;
    }

    function compose() {
      bctx.putImageData(img,0,0);
      ctx.setTransform(1,0,0,1,0,0);
      ctx.clearRect(0,0,cv.width,cv.height);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(buf,0,0,GW,GH,0,0,cv.width,cv.height);
      /* альфа-маска: обрезаем по настоящим буквам, кромка резкая */
      ctx.globalCompositeOperation='destination-in';
      ctx.drawImage(mask,0,0);
      ctx.globalCompositeOperation='source-over';
    }

    /* ---------- вариант 3: сканлайн + rgb ---------- */
    function drawScan(t) {
      /* ширина полосы в ячейках и её скорость: полоса проходит экран примерно за 3с */
      var bandPos = (t * (GH / 3.0)) % GH;
      var bandW = Math.max(2.5, GH * 0.11);
      for (var y=0;y<GH;y++){
        var ny = y/GH;
        var dist = Math.abs(y - bandPos);
        if (dist > GH*0.6) dist = GH - dist;          /* полоса идёт по кругу */
        var near = dist < bandW ? (1 - dist/bandW) : 0;
        near = near*near;                              /* мягкие края, резкая середина */
        var shift = near > 0 ? Math.round(near * 5 * Math.sin(t*13 + y*0.7)) : 0;

        for (var x=0;x<GW;x++){
          var sx = x + shift;
          if (sx < 0) sx += GW; if (sx >= GW) sx -= GW;

          var base = fbm(sx*0.055, y*0.085 + t*0.07, 5)*0.78 + 0.2;
          var v = base + (0.9 - ny)*0.1 + near*0.24;
          v = v<0?0:v>1?1:v;

          var c = rampAt(PINK, v);
          /* раскол по каналам: слева теплее, справа холоднее. только на самой полосе */
          if (near > 0.3) {
            var k = near*0.85;
            if (shift >= 0) { c[0] = Math.min(255, c[0] + 46*k); c[1] = Math.max(0, c[1] - 10*k); c[2] = Math.max(0, c[2] - 34*k); }
            else            { c[2] = Math.min(255, c[2] + 52*k); c[0] = Math.max(0, c[0] - 30*k); }
          }
          /* щели между сканлайнами: каждая третья строка притушена */
          var a = (y % 3 === 0) ? 200 : 255;
          if (near > 0.55) a = 255;                    /* на полосе щели пропадают */
          put(x,y,a,c);
        }
      }
      compose();
    }

    /* ---------- вариант 2 (новый): песчаная волна ---------- */
    /* глиф не разрушается: крупинки у фронта волны проседают вниз на 1-2 ячейки
       и греются, за фронтом возвращаются на место. читаемость сохраняется всегда */
    var sandCells = null;
    function buildSand() {
      var ref = document.createElement('canvas');
      ref.width = GW; ref.height = GH;
      var rc = ref.getContext('2d', { willReadFrequently: true });
      rc.imageSmoothingEnabled = true;
      rc.drawImage(mask, 0, 0, GW, GH);
      var d = rc.getImageData(0,0,GW,GH).data;
      sandCells = [];
      for (var y=0;y<GH;y++) for (var x=0;x<GW;x++) {
        var i = y*GW+x;
        if (d[i*4+3] > 55) sandCells.push({ x:x, y:y, r: hash2(x,y,91), g: hash2(x,y,37) });
      }
    }

    function drawSand(t) {
      if (!sandCells) buildSand();
      /* фон: тёмно-розовый с зерном, чтобы буквы не были плоской заливкой.
         уровень намеренно низкий: текст должен читаться как розовый по чёрному,
         а не как светлое пятно */
      for (var y=0;y<GH;y++){
        for (var x=0;x<GW;x++){
          var v = fbm(x*0.05, y*0.06 + t*0.05, 17)*0.4 + 0.3 + (BAYER[((y&3)<<2)|(x&3)]-0.5)*0.08;
          v = v<0?0:v>1?1:v;
          put(x,y,255,rampAt(PINK, 0.18 + 0.42*v));
        }
      }

      /* фронт волны идёт слева направо, потом обратно */
      var period = 3.4;
      var ph = (t % period) / period;             /* 0..1 */
      var travel = ph < 0.5 ? ph*2 : (1-ph)*2;    /* туда и обратно */
      var front = travel * (GW + 14) - 7;

      for (var i=0;i<sandCells.length;i++){
        var c = sandCells[i];
        var d2 = Math.abs(c.x - front);
        var reach = GW*0.16;
        if (d2 > reach) {                        /* вне волны: крупинка стоит ровно */
          var vv = 0.4 + fbm(c.x*0.06+t*0.06, c.y*0.07-t*0.04, 23)*0.34 + (0.06 - c.y/GH*0.05);
          vv = vv<0?0:vv>1?1:vv;
          put(c.x, c.y, 255, rampAt(PINK, 0.2+0.5*vv));
          continue;
        }
        /* у фронта: просадка вниз + нагрев. максимум сдвига 1.6 ячейки */
        var k = 1 - d2/reach;                    /* 1 в центре фронта */
        k = k*k;
        var wob = 0.65 + 0.35*Math.sin(c.y*0.9 + t*7 + c.r*6.283);
        var drop = k * wob * 1.6;
        var ty = Math.round(c.y + drop);
        if (ty >= GH) ty = GH-1;
        var heat = Math.min(1, 0.45 + k*0.55 + (c.g > 0.86 ? 0.25 : 0));
        var v2 = 0.55 + fbm(c.x*0.07+t*0.1, c.y*0.08, 29)*0.32 + k*0.3;
        v2 = v2<0?0:v2>1?1:v2;
        var a2 = 255;
        /* при сильной просадке крупинка чуть притухает, будто осыпается */
        if (drop > 1.1) a2 = 216;
        put(c.x, ty, a2, rampAt(HOT, heat*0.5 + v2*0.5));
      }
      compose();
    }

    function frame(now) {
      raf = 0;
      if (!t0) t0 = now;
      if (now - last < 15) { raf = requestAnimationFrame(frame); return; }
      last = now;
      var t = (now - t0) * 0.001;
      if (mode === 'sand') drawSand(t); else drawScan(t);
      if (!paused && visible) raf = requestAnimationFrame(frame);
    }

    function start(){ if (paused) return; if (!raf) raf = requestAnimationFrame(frame); }
    function stop(){ paused = true; if (raf) { cancelAnimationFrame(raf); raf = 0; } }

    function build() {
      var fonts = (document.fonts && document.fonts.ready) || Promise.resolve();
      Promise.resolve(fonts).then(function(){
        if (!layout(mode === 'sand' ? 3 : 3)) return;
        sandCells = null;
        ready = true;
        if (REDUCE) { paused = true; mode === 'sand' ? drawSand(0.6) : drawScan(1.1); return; }
        paused = false;
        start();
      });
    }

    var rt = 0;
    addEventListener('resize', function(){
      clearTimeout(rt);
      rt = setTimeout(function(){
        var was = paused; paused = true;
        layout(CELL); sandCells = null;
        paused = was;
        if (paused) { mode==='sand' ? drawSand(0.6) : drawScan(1.1); } else start();
      }, 160);
    }, { passive: true });

    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function(es){
        visible = es[0].isIntersecting;
        if (visible) start(); else stop();
      }, { threshold: 0.02 }).observe(el);
    }
    document.addEventListener('visibilitychange', function(){
      if (document.hidden) stop(); else if (!REDUCE) start();
    });

    build();
    return { start: start, stop: stop, rebuild: build };
  };
})();
