/* lab2.js — доработанные варианты 1, 2, 4. режим из ?m=N */
(function () {
  'use strict';

  var MODE = parseInt((location.search.match(/[?&]m=(\d+)/) || [])[1] || '1', 10);
  var TEXT = 'shpateil.fun';

  var FLOW = [[46,4,26],[96,8,52],[158,14,88],[214,26,124],[255,95,217],[255,203,242]];
  var FIRE = [[40,3,22],[96,6,46],[172,12,92],[232,28,138],[255,102,220],[255,232,252]];
  var ICE  = [[24,12,38],[62,22,96],[116,36,156],[180,66,206],[232,132,232],[255,214,250]];

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

  var el = document.getElementById('nick');
  el.textContent = TEXT;
  var cv = document.createElement('canvas');
  cv.className = 'flow-canvas';
  el.appendChild(cv);
  var ctx = cv.getContext('2d');

  var W=0,H=0,GW=0,GH=0,DPR=Math.min(devicePixelRatio||1,2);
  var buf=document.createElement('canvas'), bctx=buf.getContext('2d'), img=null, px=null;
  var mask=document.createElement('canvas'), mctx=mask.getContext('2d');
  var t0=0, raf=0, last=0, built=false;

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
    var m = mctx.measureText(TEXT);
    var asc = m.actualBoundingBoxAscent || parseFloat(cs.fontSize)*0.72;
    var desc = m.actualBoundingBoxDescent || parseFloat(cs.fontSize)*0.22;
    mctx.fillText(TEXT, Math.max(0,(W-m.width)/2), (H-(asc+desc))/2+asc);
  }

  function layout(cell) {
    var r = el.getBoundingClientRect();
    W = Math.round(r.width); H = Math.round(r.height);
    cv.width = Math.round(W*DPR); cv.height = Math.round(H*DPR);
    cv.style.width = W+'px'; cv.style.height = H+'px';
    GW = Math.max(8, Math.ceil(W/cell)); GH = Math.max(4, Math.ceil(H/cell));
    buf.width=GW; buf.height=GH;
    bctx = buf.getContext('2d');
    img = bctx.createImageData(GW,GH);
    px = new Uint32Array(img.data.buffer);
    drawMask();
  }
  function out(noMask) {
    ctx.setTransform(1,0,0,1,0,0);
    ctx.clearRect(0,0,cv.width,cv.height);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(buf,0,0,GW,GH,0,0,cv.width,cv.height);
    if (noMask) return;      /* сетка уже ограничена маской букв, второй рез не нужен */
    ctx.globalCompositeOperation='destination-in';
    ctx.drawImage(mask,0,0);
    ctx.globalCompositeOperation='source-over';
  }
  function put(x,y,a,c) {
    px[y*GW+x] = (((a&255)<<24)|((c[2]&255)<<16)|((c[1]&255)<<8)|(c[0]&255))>>>0;
  }

  /* общая «заливка переливом» — одна функция для 1 и для фазы покоя во 2 */
  function flowFill(t, amp, speed) {
    for (var y=0;y<GH;y++){ var ny=y/GH;
      for (var x=0;x<GW;x++){
        var nx=x/GW;
        var n1=fbm(x*0.072+t*speed*0.4, y*0.068-t*speed*0.15, 13);
        var n2=vnoise(x*0.028-t*speed*0.24, y*0.044+t*speed*0.1, 40);
        var v=n1*0.6+n2*0.4;
        v += amp*Math.sin(nx*6.4-t*speed*1.1);
        v += amp*0.38*Math.sin((y/GH)*3.1+t*speed*0.65);
        v = v*0.78 + (1-ny)*0.1;
        v += (BAYER[((y&3)<<2)|(x&3)]-0.5)*0.1;
        v = v<0?0:v>1?1:v;
        /* нижняя граница: ни одна буква не уходит в почти чёрный.
           контраст перелива держим на средних тонах, а не на провале в темноту */
        v = 0.34 + 0.66*v;
        put(x,y,255,rampAt(FLOW,v));
      }
    }
  }

  /* 1: базовый, доработанный.
     добавлено: бегущая искра по диагонали (как будто свет проходит по буквам)
     и очень мягкая виньетка по краям, чтобы центр читался первым. */
  function m1(t) {
    if (!built || GW!==Math.ceil(W/6)) layout(6);
    flowFill(t, 0.27, 1.0);
    /* искра */
    var sx = (t*0.55) % 1.6 - 0.3;
    var sy = 0.35 + 0.22*Math.sin(t*0.7);
    for (var y=0;y<GH;y++){
      for (var x=0;x<GW;x++){
        var dx = (x/GW - sx), dy = (y/GH - sy);
        var d = Math.sqrt(dx*dx*1.1 + dy*dy*2.2);
        if (d > 0.26) continue;
        var boost = (1 - d/0.26);
        boost = boost*boost*0.95;
        var i4 = (y*GW+x)*4;
        var cur = px[y*GW+x];
        var r = (cur & 0xff), g = (cur>>>8)&0xff, b = (cur>>>16)&0xff;
        var nr = Math.min(255, r + 150*boost);
        var ng = Math.min(255, g + 118*boost);
        var nb = Math.min(255, b + 34*boost);
        px[y*GW+x] = (0xff000000 | (nb<<16) | (ng<<8) | nr) >>> 0;
      }
    }
    bctx.putImageData(img,0,0); out();
  }

  /* 2: dissolve, доработанный под читаемость.
     цикл: 2.6с текст стоит и переливается -> 0.55с распад -> 0.75с сборка.
     во время распада яркость держится высокой, drift маленький, поэтому буквы
     не превращаются в кашу, а именно «отгорают» по краям. */
  var m2mask=null, m2cell=4;
  function m2Build() {
    layout(m2cell);
    /* маску берём ИЗ настоящей маски букв (downsample), а не перерисовывая текст заново.
       иначе своя маска не совпадает с реальной по кернингу, и destination-in срезает
       половину нарисованных пикселей — текст теряет площадь и выглядит дырявым. */
    var ref = document.createElement('canvas');
    ref.width = GW; ref.height = GH;
    var rc = ref.getContext('2d', { willReadFrequently: true });
    rc.imageSmoothingEnabled = true;
    rc.drawImage(mask, 0, 0, GW, GH);
    var d = rc.getImageData(0, 0, GW, GH).data;
    m2mask = new Uint8Array(GW*GH);
    for (var i=0;i<GW*GH;i++) m2mask[i] = d[i*4+3] > 60 ? 1 : 0;
    built = true;
  }
  function m2(t) {
    if (!built) m2Build();
    var HOLD=2.4, FALL=0.6, RISE=0.85, CYC=HOLD+FALL+RISE;
    var ph = t % CYC, alive = 1;
    /* alive не падает ниже 0.62: пятна отгорают, но буквы остаются целыми */
    if (ph < HOLD) { alive = 1; }
    else if (ph < HOLD+FALL) { var u=(ph-HOLD)/FALL; alive = 1 - 0.38*u; }
    else { var u2=(ph-HOLD-FALL)/RISE; alive = 0.62 + 0.38*u2; }

    if (alive >= 1) {                       /* покой: обычный перелив, ноль потерь читаемости */
      flowFill(t, 0.26, 1.0);
      bctx.putImageData(img,0,0); out(); return;
    }

    var heat = Math.max(0, (1-alive)/0.58);  /* 0 в покое, 1 в самой низкой точке */
    for (var y=0;y<GH;y++){ var ny=y/GH;
      for (var x=0;x<GW;x++){
        var idx=y*GW+x;
        var base = fbm(x*0.075+t*0.35, y*0.07-t*0.14, 13);
        var v = base*0.62 + (0.5+0.5*Math.sin((x/GW)*6.2-t*1.05))*0.3 + (1-ny)*0.1;
        v += (BAYER[((y&3)<<2)|(x&3)]-0.5)*0.09;
        v = v<0?0:v>1?1:v;

        if (!m2mask[idx]) { px[idx]=0; continue; }

        /* fbm сжат вокруг 0.5, поэтому растягиваем порог на весь диапазон,
           иначе при малом alive не выживает ни один пиксель и текст пропадает целиком */
        var raw = fbm(x*0.11, y*0.13, 7);
        var thr = (raw - 0.2) / 0.6;
        thr = thr<0?0:thr>1?1:thr;
        var lit = alive - thr;
        if (lit <= -0.16) { px[idx]=0; continue; }
        /* альфа: полная почти везде, гаснет только узкая кромка */
        var a = 255;
        if (lit < 0.03) {
          var t2 = (lit + 0.16) / 0.19;
          a = Math.round(255 * (t2<0?0:t2>1?1:t2));
        }
        if (a < 12) { px[idx]=0; continue; }

        /* край греется: сдвиг вверх мал, яркость вверх */
        var oy = -Math.min(0.19, Math.max(0, 0.03-lit)) * 6;
        var tx=x, ty=Math.round(y+oy/3);
        if (ty<0||ty>=GH) ty = y;
        var vv = Math.min(1, v + heat*0.26 + Math.max(0,0.03-lit)*0.9);
        /* в самой тёмной точке цикла поднимаем нижнюю границу яркости:
           без этого часть букв падает в тёмно-вишнёвый и «пропадает» на чёрном фоне */
        vv = Math.max(vv, 0.34 - heat*0.16);
        put(tx,ty,a,rampAt(FIRE,vv));
      }
    }
    bctx.putImageData(img,0,0); out();
  }

  /* 4: световой свип, доработанный.
     сетка 3px (текстура видна), свип медленный идёт по диагонали,
     свечение строго внутри букв, плюс тонкая пыль на пиках яркости. */
  function m4(t) {
    if (!built || GW!==Math.ceil(W/3)) layout(3);
    for (var y=0;y<GH;y++){ var ny=y/GH;
      for (var x=0;x<GW;x++){
        var nx=x/GW;
        var sw  = 0.5+0.5*Math.sin((nx*2.9 - ny*0.7) - t*0.95);
        var sw2 = 0.5+0.5*Math.sin((nx*6.8 + ny*1.5) - t*1.7);
        var sw3 = 0.5+0.5*Math.sin((nx*13.2 - ny*0.4) - t*2.6);
        var v = sw*0.52 + sw2*0.26 + sw3*0.1
              + fbm(x*0.05+t*0.14, y*0.055-t*0.075, 33)*0.2
              + (1-ny)*0.07;
        v += (BAYER[((y&3)<<2)|(x&3)]-0.5)*0.055;   /* дизер: убирает полосы на плавном */
        v = v<0?0:v>1?1:v;
        /* пыль: редкие очень светлые ячейки на гребне */
        var sparkle = (v>0.86 && hash2(x,y,(t*2)|0) > 0.93) ? 1 : 0;
        var vv = sparkle ? 1 : v;
        put(x,y,255,rampAt(ICE,vv));
      }
    }
    bctx.putImageData(img,0,0);
    ctx.setTransform(1,0,0,1,0,0);
    ctx.clearRect(0,0,cv.width,cv.height);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(buf,0,0,GW,GH,0,0,cv.width,cv.height);
    /* мягкое свечение: размытая копия только внутри маски, аддитивно */
    ctx.globalCompositeOperation='destination-in';
    ctx.drawImage(mask,0,0);
    ctx.globalCompositeOperation='source-over';
    ctx.save();
    ctx.globalCompositeOperation='lighter';
    ctx.globalAlpha=0.22;
    ctx.imageSmoothingEnabled=true;
    ctx.filter='blur(2px)';
    ctx.drawImage(cv,0,0);
    ctx.filter='none';
    ctx.restore();
    ctx.globalCompositeOperation='destination-in';
    ctx.drawImage(mask,0,0);
    ctx.globalCompositeOperation='source-over';
    ctx.globalAlpha=1;
  }

  function loop(now) {
    raf = requestAnimationFrame(loop);
    if (!t0) t0 = now;
    if (now-last < 14) return;
    last = now;
    var t = (now-t0)*0.001;
    if (MODE===2) m2(t); else if (MODE===4) m4(t); else m1(t);
    built = true;
  }

  function start(){ built=false; requestAnimationFrame(loop); }
  document.fonts.ready.then(start);
  var rt=0;
  addEventListener('resize', function(){ clearTimeout(rt); rt=setTimeout(function(){ built=false; },200); }, {passive:true});
})();
