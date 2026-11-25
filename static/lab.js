/* lab.js — пять вариантов перелива логотипа. режим берётся из ?m=N */
(function () {
  'use strict';

  var MODE = parseInt((location.search.match(/[?&]m=(\d+)/) || [])[1] || '1', 10);
  var TEXT = (location.search.match(/[?&]t=([^&]*)/) || [])[1] || 'shpateil.fun';
  TEXT = decodeURIComponent(TEXT).trim();

  var RAMP_FLOW = [[46,4,26],[96,8,52],[158,14,88],[214,26,124],[255,95,217],[255,196,240]];
  var RAMP_FIRE = [[26,2,14],[92,6,44],[178,14,96],[236,30,140],[255,105,222],[255,225,250]];
  var RAMP_ICE  = [[18,10,30],[52,18,86],[104,28,150],[172,52,206],[226,116,236],[255,206,250]];

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
  var t0=0, raf=0, last=0;

  function drawMask(cell) {
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

  function out() {
    ctx.setTransform(1,0,0,1,0,0);
    ctx.clearRect(0,0,cv.width,cv.height);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(buf,0,0,GW,GH,0,0,cv.width,cv.height);
    ctx.globalCompositeOperation='destination-in';
    ctx.drawImage(mask,0,0);
    ctx.globalCompositeOperation='source-over';
  }

  function put(x,y,a,c) {
    px[y*GW+x] = (((a&255)<<24)|((c[2]&255)<<16)|((c[1]&255)<<8)|(c[0]&255))>>>0;
  }

  /* 1: текущий прод. крупные ячейки, две волны, быстрый ход */
  function m1(t) {
    var cell=6; if (!W || GW!==Math.ceil(W/cell)) layout(cell);
    for (var y=0;y<GH;y++){ var ny=y/GH;
      for (var x=0;x<GW;x++){
        var n1=fbm(x*0.075+t*0.42, y*0.07-t*0.16, 13);
        var n2=vnoise(x*0.03-t*0.26, y*0.045+t*0.11, 40);
        var v=n1*0.62+n2*0.38;
        v += 0.26*Math.sin((x/GW)*6.4-t*1.15);
        v += 0.1*Math.sin((y/GH)*3.1+t*0.7);
        v = v*0.78 + (1-ny)*0.1;
        v += (BAYER[((y&3)<<2)|(x&3)]-0.5)*0.1;
        v = v<0?0:v>1?1:v;
        put(x,y,255,rampAt(RAMP_FLOW,v));
      }
    }
    bctx.putImageData(img,0,0); out();
  }

  /* 2: noita dissolve. текст периодически рассыпается в горящие пиксели и собирается */
  var m2mask=null, m2phase=0, m2dir=1;
  function m2(t) {
    var cell=4;
    if (!m2mask || cv.width!==Math.round(W*DPR)) { layout(cell);
      var mc=document.createElement('canvas'); mc.width=GW; mc.height=GH;
      var m=mc.getContext('2d',{willReadFrequently:true});
      m.fillStyle='#fff'; m.textAlign='center'; m.textBaseline='middle';
      m.font='900 '+(GH*0.86)+'px '+getComputedStyle(el).fontFamily;
      var tw=m.measureText(TEXT).width, k=Math.min(1,(GW*0.94)/tw);
      m.translate(GW/2,GH/2); m.scale(k,k); m.fillText(TEXT,0,0);
      var d=m.getImageData(0,0,GW,GH).data;
      m2mask=new Uint8Array(GW*GH);
      for (var i=0;i<GW*GH;i++) m2mask[i] = d[i*4+3] > 110 ? 1 : 0;
    }
    m2phase += 0.0045*m2dir;
    if (m2phase>=1){m2phase=1;m2dir=-1;}
    if (m2phase<=0){m2phase=0;m2dir=1;}
    for (var y=0;y<GH;y++){ var ny=y/GH;
      for (var x=0;x<GW;x++){
        var idx=y*GW+x;
        if (!m2mask[idx]) { px[idx]=0; continue; }
        var nz=fbm(x*0.13,y*0.15,7);
        var k2=(m2phase-nz)/0.3;
        if (k2>=1){ px[idx]=0; continue; }
        var a=255, ox=0, oy=0;
        if (k2>0){
          a = Math.round(255*(1-Math.max(0,(k2-0.65))/0.35));
          var ang=nz*6.283+t*0.3, dr=k2*k2*22;
          ox=Math.cos(ang)*dr; oy=Math.sin(ang)*dr-k2*k2*9;
        }
        var v = 0.42 + (1-ny)*0.12 + fbm(x*0.09+t*0.4, y*0.1-t*0.2, 21)*0.3 + (k2>0?k2*0.35:0);
        v = v<0?0:v>1?1:v;
        var tx=Math.round(x+ox/3), ty=Math.round(y+oy/3);
        if (tx<0||ty<0||tx>=GW||ty>=GH) continue;
        put(tx,ty,a,rampAt(RAMP_FIRE,v));
      }
    }
    bctx.putImageData(img,0,0); out();
  }

  /* 3: сканлайны и rgb-раскол. горизонтальные полосы съезжают, буквы раздваиваются */
  function m3(t) {
    var cell=3;
    if (!W || GW!==Math.ceil(W/cell)) layout(cell);
    for (var y=0;y<GH;y++){ var ny=y/GH;
      var band = Math.floor(t*3.2)%GH;
      var near = Math.abs(y-band) < 3 ? (1-Math.abs(y-band)/3) : 0;
      var shift = near>0 ? Math.round(near*4*Math.sin(t*14+y)) : 0;
      for (var x=0;x<GW;x++){
        var sx = x+shift; if (sx<0) sx+=GW; if (sx>=GW) sx-=GW;
        var base=fbm(sx*0.06, y*0.09+t*0.08, 5)*0.8 + 0.18;
        var v = base + (0.9-ny)*0.12 + near*0.22;
        v = v<0?0:v>1?1:v;
        var c=rampAt(RAMP_FLOW,v);
        /* раскол: левее сдвига уводим в тёплый, правее в холодный */
        if (near>0.35){
          if (shift>0){ c[0]=Math.min(255,c[0]+30); c[2]=Math.max(0,c[2]-30); }
          else { c[2]=Math.min(255,c[2]+34); c[0]=Math.max(0,c[0]-24); }
        }
        /* прореживание строк: щели между сканлайнами */
        var a = (y%3===0) ? 210 : 255;
        put(x,y,a,c);
      }
    }
    bctx.putImageData(img,0,0); out();
  }

  /* 4: мягкий световой свип. плавные волны, узкие ячейки, свечение за счёт второй копии */
  function m4(t) {
    var cell=2;
    if (!W || GW!==Math.ceil(W/cell)) layout(cell);
    for (var y=0;y<GH;y++){ var ny=y/GH;
      for (var x=0;x<GW;x++){
        var nx=x/GW;
        var sweep = 0.5+0.5*Math.sin((nx*3.4 - ny*0.8) - t*1.35);
        var sweep2 = 0.5+0.5*Math.sin((nx*7.9 + ny*1.6) - t*2.2);
        var v = sweep*0.62 + sweep2*0.18
              + fbm(x*0.045+t*0.15, y*0.05-t*0.08, 33)*0.24
              + (1-ny)*0.08;
        v = v<0?0:v>1?1:v;
        put(x,y,255,rampAt(RAMP_ICE,v));
      }
    }
    bctx.putImageData(img,0,0); out();
    /* аддитивный свет: очень прозрачная копия со сдвигом даёт ощущение лампы */
    ctx.globalCompositeOperation='lighter';
    ctx.globalAlpha=0.16;
    ctx.imageSmoothingEnabled=true;
    ctx.drawImage(buf,0,0,GW,GH, -3, -2, cv.width, cv.height);
    ctx.globalAlpha=1;
    ctx.globalCompositeOperation='destination-in';
    ctx.drawImage(mask,0,0);
    ctx.globalCompositeOperation='source-over';
  }

  /* 5: дизер-логотип. два тона, крупные пиксели, байер 8x8, без плавностей */
  var B8=[];
  (function(){
    var m=[[0,32,8,40,2,34,10,42],[48,16,56,24,50,18,58,26],
           [12,44,4,36,14,46,6,38],[60,28,52,20,62,30,54,22],
           [3,35,11,43,1,33,9,41],[51,19,59,27,49,17,57,25],
           [15,47,7,39,13,45,5,37],[63,31,55,23,61,29,53,21]];
    for (var i=0;i<8;i++) for (var j=0;j<8;j++) B8.push((m[i][j]+0.5)/64);
  })();
  function m5(t) {
    var cell=5;
    if (!W || GW!==Math.ceil(W/cell)) layout(cell);
    for (var y=0;y<GH;y++){ var ny=y/GH;
      for (var x=0;x<GW;x++){
        var nx=x/GW;
        var n = fbm(x*0.06+t*0.22, y*0.065-t*0.09, 9)*0.72
              + 0.5+0.5*Math.sin(nx*5.2-t*0.95)
              - 0.42
              + (0.5-ny)*0.1;
        n = n*0.5+0.5;
        var th = B8[((y&7)<<3)|(x&7)];
        var on = n > th;
        /* два тона: тёмный розовый и светлый, плюс редкие искры */
        var c = on
          ? (n>0.78 ? [255,196,244] : [255,95,217])
          : (n>0.3 ? [118,10,66] : [46,4,26]);
        var v = on ? (n>0.78?1:0.72) : (n>0.3?0.28:0.06);
        put(x,y,255,rampAt([[36,3,20],[86,7,48],[140,12,80],[200,24,120],[255,95,217],[255,206,246]], v));
        if (!on && n>0.42 && n<th) put(x,y,255,c);
      }
    }
    bctx.putImageData(img,0,0); out();
  }

  function loop(now) {
    raf = requestAnimationFrame(loop);
    if (!t0) t0 = now;
    if (now-last < 14) return;
    last = now;
    var t = (now-t0)*0.001;
    if (MODE===1) m1(t); else if (MODE===2) m2(t);
    else if (MODE===3) m3(t); else if (MODE===4) m4(t);
    else m5(t);
  }

  document.fonts.ready.then(function(){ requestAnimationFrame(loop); });
})();
