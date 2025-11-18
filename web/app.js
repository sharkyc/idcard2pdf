async function postForm(url, formData){
  const res = await fetch(url, { method: 'POST', body: formData });
  return res.json();
}

async function postJson(url, data){
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
  return res.json();
}

function setupPane(prefix){
  const fileInput = document.getElementById(prefix+'File');
  const dropArea = document.getElementById(prefix+'Drop');
  const canvas = document.getElementById(prefix+'Canvas');
  const ctx = canvas.getContext('2d');
  const zoomText = document.getElementById(prefix+'ZoomText');
  const zoomIn = document.getElementById(prefix+'ZoomIn');
  const zoomOut = document.getElementById(prefix+'ZoomOut');
  const rotateInput = document.getElementById(prefix+'Rotate');
  const applyBtn = document.getElementById(prefix+'Apply');
  const resultImg = document.getElementById(prefix+'Result');
  let img = null;
  let zoom = 1;
  let quad = null;
  let dragging = -1;
  let panning = false;
  let panStart = {x:0,y:0};
  let offset = {x:0,y:0};
  let lastMouse = {x:0,y:0};
  const pointers = new Map();
  let pinch = false;
  let pinchStartDist = 0;
  let pinchStartZoom = 1;
  let pinchCenter = {x:0,y:0};
  function getCanvasXY(e){
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const x = (e.clientX - rect.left) * scaleX;
    const y = (e.clientY - rect.top) * scaleY;
    return {x, y};
  }

  function draw(){
    if(!img) return;
    ctx.clearRect(0,0,canvas.width,canvas.height);
    const iw = img.width, ih = img.height;
    const dw = iw*zoom, dh = ih*zoom;
    const dx = (canvas.width - dw)/2 + offset.x, dy = (canvas.height - dh)/2 + offset.y;
    ctx.drawImage(img, dx, dy, dw, dh);
    if(quad){
      ctx.strokeStyle = '#00a2ff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      for(let i=0;i<4;i++){
        const p = quad[i];
        const cx = dx + p[0]*zoom;
        const cy = dy + p[1]*zoom;
        if(i===0) ctx.moveTo(cx,cy); else ctx.lineTo(cx,cy);
      }
      ctx.closePath();
      ctx.stroke();
      for(let i=0;i<4;i++){
        const p = quad[i];
        const cx = dx + p[0]*zoom;
        const cy = dy + p[1]*zoom;
        ctx.fillStyle = '#ff5757';
        ctx.beginPath();
        ctx.arc(cx, cy, 8, 0, Math.PI*2);
        ctx.fill();
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    }
  }
  function hitTest(mx,my){
    if(!quad) return -1;
    const iw = img.width, ih = img.height;
    const dw = iw*zoom, dh = ih*zoom;
    const dx = (canvas.width - dw)/2 + offset.x, dy = (canvas.height - dh)/2 + offset.y;
    let best = -1, bestD = 36;
    for(let i=0;i<4;i++){
      const cx = dx + quad[i][0]*zoom;
      const cy = dy + quad[i][1]*zoom;
      const d = Math.hypot(cx-mx, cy-my);
      if(d < bestD){ bestD = d; best = i; }
    }
    return best;
  }

  function updateZoomText(){ zoomText.textContent = Math.round(zoom*100) + '%'; }
  zoomIn.addEventListener('click', ()=>{ zoom = Math.min(5, zoom*1.2); updateZoomText(); draw(); });
  zoomOut.addEventListener('click', ()=>{ zoom = Math.max(0.2, zoom/1.2); updateZoomText(); draw(); });
  canvas.addEventListener('wheel', e=>{
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    const {x, y} = getCanvasXY(e);
    const iw = img?.width || 1, ih = img?.height || 1;
    const dw0 = iw*zoom, dh0 = ih*zoom;
    const dx0 = (canvas.width - dw0)/2 + offset.x, dy0 = (canvas.height - dh0)/2 + offset.y;
    const imgX0 = (x - dx0) / zoom;
    const imgY0 = (y - dy0) / zoom;
    zoom = Math.max(0.2, Math.min(5, zoom*delta));
    const dw1 = iw*zoom, dh1 = ih*zoom;
    const dx1 = (canvas.width - dw1)/2 + offset.x, dy1 = (canvas.height - dh1)/2 + offset.y;
    const afterX = dx1 + imgX0 * zoom;
    const afterY = dy1 + imgY0 * zoom;
    offset.x += x - afterX;
    offset.y += y - afterY;
    updateZoomText(); draw();
  });

  canvas.addEventListener('pointerdown', e=>{
    if(!img) return;
    const {x, y} = getCanvasXY(e);
    pointers.set(e.pointerId, {x, y});
    if(pointers.size === 2){
      const it = Array.from(pointers.values());
      const cx = (it[0].x + it[1].x) / 2;
      const cy = (it[0].y + it[1].y) / 2;
      pinchCenter = {x: cx, y: cy};
      const dxp = it[0].x - it[1].x;
      const dyp = it[0].y - it[1].y;
      pinchStartDist = Math.hypot(dxp, dyp);
      pinchStartZoom = zoom;
      pinch = true;
      dragging = -1;
      panning = false;
    }
    lastMouse = {x,y};
    const best = hitTest(x,y);
    if(best >= 0){
      dragging = best;
      canvas.style.cursor = 'grabbing';
    } else {
      panning = true;
      panStart = {x,y};
      canvas.style.cursor = 'grabbing';
    }
    try { canvas.setPointerCapture(e.pointerId); } catch {}
  });
  canvas.addEventListener('pointermove', e=>{
    const {x, y} = getCanvasXY(e);
    if(pointers.has(e.pointerId)) pointers.set(e.pointerId, {x, y});
    if(pinch && pointers.size >= 2){
      const it = Array.from(pointers.values());
      const cx = (it[0].x + it[1].x) / 2;
      const cy = (it[0].y + it[1].y) / 2;
      pinchCenter = {x: cx, y: cy};
      const dxp = it[0].x - it[1].x;
      const dyp = it[0].y - it[1].y;
      const dist = Math.hypot(dxp, dyp);
      const factor = dist / Math.max(1e-6, pinchStartDist);
      const nz = Math.max(0.2, Math.min(5, pinchStartZoom * factor));
      const iw = img.width, ih = img.height;
      const dw0 = iw*zoom, dh0 = ih*zoom;
      const dx0 = (canvas.width - dw0)/2 + offset.x, dy0 = (canvas.height - dh0)/2 + offset.y;
      const imgX0 = (pinchCenter.x - dx0) / zoom;
      const imgY0 = (pinchCenter.y - dy0) / zoom;
      zoom = nz;
      const dw1 = iw*zoom, dh1 = ih*zoom;
      const dx1 = (canvas.width - dw1)/2 + offset.x, dy1 = (canvas.height - dh1)/2 + offset.y;
      const afterX = dx1 + imgX0 * zoom;
      const afterY = dy1 + imgY0 * zoom;
      offset.x += pinchCenter.x - afterX;
      offset.y += pinchCenter.y - afterY;
      updateZoomText();
      draw();
      return;
    }
    if(panning && dragging<0){
      offset.x += x - panStart.x;
      offset.y += y - panStart.y;
      panStart = {x,y};
      draw();
      return;
    }
    if(dragging>=0 && quad){
      const iw = img.width, ih = img.height;
      const dw = iw*zoom, dh = ih*zoom;
      const dx = (canvas.width - dw)/2 + offset.x, dy = (canvas.height - dh)/2 + offset.y;
      quad[dragging][0] = (x - dx) / zoom;
      quad[dragging][1] = (y - dy) / zoom;
      draw();
      return;
    }
    const best = hitTest(x,y);
    canvas.classList.toggle('grab-corner', best>=0);
    canvas.classList.toggle('can-grab', best<0);
    canvas.style.cursor = best>=0 ? 'pointer' : 'grab';
  });
  canvas.addEventListener('mouseleave', ()=>{
    canvas.style.cursor = 'grab';
    canvas.classList.remove('grab-corner','can-grab');
  });
  canvas.addEventListener('pointerup', e=>{
    pointers.delete(e.pointerId);
    if(pointers.size < 2){ pinch = false; }
    dragging = -1;
    panning = false;
    canvas.style.cursor = 'grab';
    canvas.classList.remove('grab-corner','can-grab');
    try { canvas.releasePointerCapture(e.pointerId); } catch {}
  });
  canvas.addEventListener('pointercancel', e=>{
    pointers.delete(e.pointerId);
    pinch = false;
    dragging = -1;
    panning = false;
    canvas.style.cursor = 'grab';
    canvas.classList.remove('grab-corner','can-grab');
  });

  function openFile(f){
    const url = URL.createObjectURL(f);
    img = new Image();
    img.onload = ()=>{
      zoom = Math.min(1, Math.min(canvas.width/img.width, canvas.height/img.height));
      offset = {x:0,y:0};
      updateZoomText(); draw();
    };
    img.src = url;
    const fd = new FormData();
    fd.append('file', f);
    postForm('/api/detect', fd).then(det=>{ quad = det.quad; draw(); });
  }
  fileInput.addEventListener('change', ()=>{ if(fileInput.files[0]) openFile(fileInput.files[0]); });
  dropArea.addEventListener('click', ()=> fileInput.click());
  dropArea.addEventListener('dragover', e=>{ e.preventDefault(); dropArea.classList.add('dragover'); });
  dropArea.addEventListener('dragleave', ()=> dropArea.classList.remove('dragover') );
  dropArea.addEventListener('drop', e=>{
    e.preventDefault();
    dropArea.classList.remove('dragover');
    if(e.dataTransfer.files[0]) openFile(e.dataTransfer.files[0]);
  });

  applyBtn.addEventListener('click', async ()=>{
    if(!img || !quad) return;
    const b64 = await new Promise((resolve)=>{
      const c = document.createElement('canvas');
      c.width = img.width; c.height = img.height;
      const cctx = c.getContext('2d');
      cctx.drawImage(img,0,0);
      resolve(c.toDataURL('image/jpeg', 0.95));
    });
    const res = await postJson('/api/warp', { image_base64: b64, quad: quad, rotate: parseFloat(rotateInput.value), pad_px: 20, refine: true });
    if(res.image_base64){ resultImg.src = res.image_base64; maybeEnableExport(); drawA4Preview(); }
  });
}

setupPane('front');
setupPane('back');

function drawA4Preview(){
  const canvas = document.getElementById('a4Canvas');
  const frontEl = document.getElementById('frontResult');
  const backEl = document.getElementById('backResult');
  const ctx = canvas.getContext('2d');
  const a4w_mm = 210, a4h_mm = 297;
  const card_w_mm = 85.6, card_h_mm = 54.0;
  const gap_mm = 10.0;
  const scale = canvas.width / a4w_mm;
  const target_h = Math.round(a4h_mm * scale);
  if (canvas.height !== target_h) canvas.height = target_h;
  ctx.clearRect(0,0,canvas.width,canvas.height);
  if(!frontEl.src || !backEl.src){ ctx.fillStyle = '#eee'; ctx.fillRect(0,0,canvas.width,canvas.height); return; }
  const frontImg = new Image(); frontImg.src = frontEl.src;
  const backImg = new Image(); backImg.src = backEl.src;
  let loaded = 0;
  function onload(){
    loaded++;
    if(loaded<2) return;
    ctx.fillStyle = '#fff'; ctx.fillRect(0,0,canvas.width,canvas.height);
    const pageW = canvas.width, pageH = canvas.height;
    const cardW = card_w_mm * scale;
    const cardH = card_h_mm * scale;
    const gap = gap_mm * scale;
    const totalH = cardH * 2 + gap;
    const startY = (pageH - totalH)/2;
    const x = (pageW - cardW)/2;
    ctx.drawImage(backImg, x, startY, cardW, cardH);
    ctx.drawImage(frontImg, x, startY + cardH + gap, cardW, cardH);
  }
  frontImg.onload = onload; backImg.onload = onload;
}

function maybeEnableExport(){
  const frontReady = document.getElementById('frontResult').src && document.getElementById('frontResult').src.startsWith('data:image');
  const backReady = document.getElementById('backResult').src && document.getElementById('backResult').src.startsWith('data:image');
  document.getElementById('exportPdf').disabled = !(frontReady && backReady);
  if(frontReady && backReady) drawA4Preview();
}

document.getElementById('exportPdf').addEventListener('click', async ()=>{
  const front = document.getElementById('frontResult').src;
  const back = document.getElementById('backResult').src;
  const res = await fetch('/api/export', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ front_base64: front, back_base64: back }) });
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'idcard_a4.pdf'; a.click();
});