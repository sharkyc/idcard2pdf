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
  const statusEl = document.getElementById(prefix+'Status'); // Status message element
  const expandInput = document.getElementById(prefix+'Expand'); // Expansion ratio slider
  const expandValue = document.getElementById(prefix+'ExpandValue'); // Expansion value display
  const canvas = document.getElementById(prefix+'Canvas');
  const ctx = canvas.getContext('2d');
  const zoomText = document.getElementById(prefix+'ZoomText');
  const zoomIn = document.getElementById(prefix+'ZoomIn');
  const zoomOut = document.getElementById(prefix+'ZoomOut');
  const rotateInput = document.getElementById(prefix+'Rotate');
  const applyBtn = document.getElementById(prefix+'Apply');
  const resultImg = document.getElementById(prefix+'Result');
  let img = null;
  let originalFile = null; // Store original file for reset
  let originalQuad = null; // Store original detected quad for expansion
  let expandRatio = 0.08; // Default 8% expansion
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

  // Auto-preview with debouncing
  let previewTimer = null;
  let isPreviewPending = false;

  // Apply expansion to quad
  function applyExpansion(baseQuad, ratio) {
    if (!baseQuad || ratio === 0) return baseQuad ? baseQuad.map(p => [...p]) : null;

    // Calculate center
    const cx = (baseQuad[0][0] + baseQuad[1][0] + baseQuad[2][0] + baseQuad[3][0]) / 4;
    const cy = (baseQuad[0][1] + baseQuad[1][1] + baseQuad[2][1] + baseQuad[3][1]) / 4;

    // Expand each point away from center
    return baseQuad.map(p => [
      p[0] + (p[0] - cx) * ratio,
      p[1] + (p[1] - cy) * ratio
    ]);
  }

  // Reverse expansion (shrink back to original)
  function reverseExpansion(expandedQuad, currentRatio) {
    if (!expandedQuad || currentRatio === 0) return expandedQuad ? expandedQuad.map(p => [...p]) : null;

    // Calculate center
    const cx = (expandedQuad[0][0] + expandedQuad[1][0] + expandedQuad[2][0] + expandedQuad[3][0]) / 4;
    const cy = (expandedQuad[0][1] + expandedQuad[1][1] + expandedQuad[2][1] + expandedQuad[3][1]) / 4;

    // Shrink each point towards center
    return expandedQuad.map(p => [
      p[0] - (p[0] - cx) * currentRatio / (1 + currentRatio),
      p[1] - (p[1] - cy) * currentRatio / (1 + currentRatio)
    ]);
  }

  function schedulePreview() {
    if (!img || !quad) return;
    if (previewTimer) clearTimeout(previewTimer);
    isPreviewPending = true;
    resultImg.style.opacity = '0.5'; // Show loading state
    previewTimer = setTimeout(() => {
      applyWarp();
      isPreviewPending = false;
    }, 600); // 600ms debounce
  }

  async function applyWarp() {
    if (!img || !quad) return;
    const b64 = await new Promise((resolve) => {
      const c = document.createElement('canvas');
      c.width = img.width;
      c.height = img.height;
      const cctx = c.getContext('2d');
      cctx.drawImage(img, 0, 0);
      resolve(c.toDataURL('image/jpeg', 0.95));
    });
    const res = await postJson('/api/warp', {
      image_base64: b64,
      quad: quad,
      rotate: parseFloat(rotateInput.value),
      pad_px: 20,
      refine: true
    });
    if (res.image_base64) {
      resultImg.src = res.image_base64;
      resultImg.style.opacity = '1';
      maybeEnableExport();
      drawA4Preview();
    }
  }
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
        ctx.arc(cx, cy, 12, 0, Math.PI*2); // Increased from 8 to 12 for better visibility
        ctx.fill();
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 3;
        ctx.stroke();
      }
    }
  }
  function hitTest(mx,my){
    if(!quad) return -1;
    const iw = img.width, ih = img.height;
    const dw = iw*zoom, dh = ih*zoom;
    const dx = (canvas.width - dw)/2 + offset.x, dy = (canvas.height - dh)/2 + offset.y;
    let best = -1, bestD = 900; // Increased from 36 to 900 (30px radius for better mobile touch)
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

      // Update the corner position
      quad[dragging][0] = (x - dx) / zoom;
      quad[dragging][1] = (y - dy) / zoom;

      // Update originalQuad by shrinking the current quad (remove expansion)
      originalQuad = reverseExpansion(quad, expandRatio);

      draw();
      schedulePreview(); // Trigger auto-preview on corner adjustment
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
    originalFile = f; // Store original file for reset
    const url = URL.createObjectURL(f);
    img = new Image();
    img.onload = ()=>{
      zoom = Math.min(1, Math.min(canvas.width/img.width, canvas.height/img.height));
      offset = {x:0,y:0};
      updateZoomText(); draw();
      URL.revokeObjectURL(url);
    };
    img.src = url;
    const fd = new FormData();
    fd.append('file', f);
    fd.append('expand_ratio', expandRatio.toString()); // Send expansion ratio to server
    postForm('/api/detect', fd).then(det=>{
      // Server returns expanded quad, so we need to save the base (unexpanded) version
      quad = det.quad;
      if (det.detected && expandRatio > 0) {
        // Shrink to get the original detected quad without expansion
        originalQuad = reverseExpansion(quad, expandRatio);
      } else {
        // Detection failed or no expansion, save as-is
        originalQuad = JSON.parse(JSON.stringify(quad));
      }
      draw();

      // Show detection status
      if (det.detected === false) {
        statusEl.textContent = det.message || '未能自动检测到身份证，请手动调整四个角点';
        statusEl.className = 'status-msg warning';
      } else {
        statusEl.textContent = det.message || '自动检测成功';
        statusEl.className = 'status-msg success';
        // Auto-hide success message after 3 seconds
        setTimeout(() => {
          statusEl.style.display = 'none';
        }, 3000);
      }

      schedulePreview(); // Auto-preview after detection
    });
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

  // Manual apply button (also triggers auto-preview)
  applyBtn.addEventListener('click', () => {
    if (previewTimer) clearTimeout(previewTimer);
    applyWarp();
  });

  // Auto-preview on rotation change
  rotateInput.addEventListener('input', () => {
    schedulePreview();
  });

  // Expansion ratio slider
  expandInput.addEventListener('input', () => {
    if (!originalQuad || !quad) return;

    const val = parseInt(expandInput.value, 10);
    expandValue.textContent = val + '%';
    const newRatio = val / 100; // Convert percentage to ratio

    // First shrink back to original, then expand with new ratio
    const baseQuad = reverseExpansion(quad, expandRatio);
    quad = applyExpansion(baseQuad, newRatio);
    expandRatio = newRatio;

    // Update originalQuad to the new base (without expansion)
    originalQuad = baseQuad;

    draw();
    schedulePreview();
  });

  // Auto-level button
  const autoLevelBtn = document.getElementById(prefix + 'AutoLevel');
  autoLevelBtn.addEventListener('click', () => {
    if (!quad || quad.length !== 4) return;

    // Use the base quad (without expansion) for angle calculation
    const baseQuad = originalQuad || quad;

    // Calculate the angle of the top edge (tl to tr)
    const tl = baseQuad[0];
    const tr = baseQuad[1];
    const bl = baseQuad[3];
    const br = baseQuad[2];

    // Calculate angle of top edge
    const topDx = tr[0] - tl[0];
    const topDy = tr[1] - tl[1];
    const topAngle = Math.atan2(topDy, topDx) * 180 / Math.PI;

    // Calculate angle of bottom edge
    const botDx = br[0] - bl[0];
    const botDy = br[1] - bl[1];
    const botAngle = Math.atan2(botDy, botDx) * 180 / Math.PI;

    // Average the two angles for better accuracy
    const avgAngle = (topAngle + botAngle) / 2;

    // Set the rotation slider to compensate
    rotateInput.value = -avgAngle;
    schedulePreview();
  });

  // Reset button - re-run auto-detection
  const resetBtn = document.getElementById(prefix + 'Reset');
  resetBtn.addEventListener('click', () => {
    if (!originalFile || !img) return;

    // Reset rotation
    rotateInput.value = 0;

    // Clear status message
    statusEl.className = 'status-msg';
    statusEl.textContent = '';

    // Re-run detection with current expansion ratio
    const fd = new FormData();
    fd.append('file', originalFile);
    fd.append('expand_ratio', expandRatio.toString());
    postForm('/api/detect', fd).then(det => {
      quad = det.quad;
      if (det.detected && expandRatio > 0) {
        originalQuad = reverseExpansion(quad, expandRatio);
      } else {
        originalQuad = JSON.parse(JSON.stringify(quad));
      }
      draw();

      // Show detection status
      if (det.detected === false) {
        statusEl.textContent = det.message || '未能自动检测到身份证，请手动调整四个角点';
        statusEl.className = 'status-msg warning';
      } else {
        statusEl.textContent = det.message || '自动检测成功';
        statusEl.className = 'status-msg success';
        setTimeout(() => {
          statusEl.style.display = 'none';
        }, 3000);
      }

      schedulePreview();
    });
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

    // Draw watermark if enabled
    const watermarkEnabled = document.getElementById('watermarkEnabled').checked;
    if (watermarkEnabled) {
      drawWatermarkOnCanvas(ctx, pageW, pageH, scale);
    }
  }
  frontImg.onload = onload; backImg.onload = onload;
}

function drawWatermarkOnCanvas(ctx, pageW, pageH, scale) {
  const text = document.getElementById('watermarkText').value || '仅用于XX办理';
  const mode = document.getElementById('watermarkMode').value;
  const size = parseInt(document.getElementById('watermarkSize').value) * scale / 2; // Scale down for preview
  const opacity = parseInt(document.getElementById('watermarkOpacity').value) / 100;
  const color = document.getElementById('watermarkColor').value;
  const rotation = parseInt(document.getElementById('watermarkRotation').value);

  ctx.save();
  ctx.globalAlpha = opacity;
  ctx.fillStyle = color;
  ctx.font = `bold ${size}px sans-serif`;

  const rotationRad = rotation * Math.PI / 180;

  if (mode === 'single') {
    // Single centered watermark
    ctx.translate(pageW / 2, pageH / 2);
    ctx.rotate(rotationRad);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 0, 0);
  } else {
    // Tiled watermark mode
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';

    // Measure text for spacing
    const metrics = ctx.measureText(text);
    const textWidth = metrics.width;
    const textHeight = size * 1.2;

    const spacingX = textWidth + 30 * scale / 2;
    const spacingY = textHeight + 30 * scale / 2;

    // Create a grid of watermarks
    for (let y = -pageH; y < pageH * 2; y += spacingY) {
      for (let x = -pageW; x < pageW * 2; x += spacingX) {
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(rotationRad);
        ctx.fillText(text, 0, 0);
        ctx.restore();
      }
    }
  }

  ctx.restore();
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

  // Collect watermark settings
  const watermarkEnabled = document.getElementById('watermarkEnabled').checked;
  let watermarkConfig = null;

  if (watermarkEnabled) {
    watermarkConfig = {
      text: document.getElementById('watermarkText').value || '仅用于XX办理',
      mode: document.getElementById('watermarkMode').value,
      size: parseInt(document.getElementById('watermarkSize').value),
      opacity: parseInt(document.getElementById('watermarkOpacity').value) / 100,
      color: document.getElementById('watermarkColor').value,
      rotation: parseInt(document.getElementById('watermarkRotation').value)
    };
  }

  const payload = {
    front_base64: front,
    back_base64: back
  };

  if (watermarkConfig) {
    payload.watermark = watermarkConfig;
  }

  const res = await fetch('/api/export', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'idcard_a4.pdf'; a.click();
});

// Watermark UI controls
const watermarkEnabled = document.getElementById('watermarkEnabled');
const watermarkControls = document.getElementById('watermarkControls');
const watermarkSize = document.getElementById('watermarkSize');
const watermarkSizeValue = document.getElementById('watermarkSizeValue');
const watermarkOpacity = document.getElementById('watermarkOpacity');
const watermarkOpacityValue = document.getElementById('watermarkOpacityValue');
const watermarkRotation = document.getElementById('watermarkRotation');
const watermarkRotationValue = document.getElementById('watermarkRotationValue');
const watermarkPreset = document.getElementById('watermarkPreset');

// Toggle watermark controls
watermarkEnabled.addEventListener('change', () => {
  if (watermarkEnabled.checked) {
    watermarkControls.classList.add('active');
    watermarkControls.classList.remove('disabled');
  } else {
    watermarkControls.classList.remove('active');
    watermarkControls.classList.add('disabled');
  }
  // Refresh preview when watermark is toggled
  drawA4Preview();
});

// Update slider values and refresh preview
watermarkSize.addEventListener('input', () => {
  watermarkSizeValue.textContent = watermarkSize.value;
  drawA4Preview();
});

watermarkOpacity.addEventListener('input', () => {
  watermarkOpacityValue.textContent = watermarkOpacity.value;
  drawA4Preview();
});

watermarkRotation.addEventListener('input', () => {
  watermarkRotationValue.textContent = watermarkRotation.value;
  drawA4Preview();
});

// Refresh preview when other watermark settings change
document.getElementById('watermarkText').addEventListener('input', drawA4Preview);
document.getElementById('watermarkMode').addEventListener('change', drawA4Preview);
document.getElementById('watermarkColor').addEventListener('input', drawA4Preview);

// Preset button - show common use cases
watermarkPreset.addEventListener('click', () => {
  const presets = [
    { text: '仅用于办理银行卡', color: '#ff0000' },
    { text: '仅用于办理社保', color: '#ff0000' },
    { text: '仅用于办理公积金', color: '#ff0000' },
    { text: '仅用于办理护照', color: '#ff0000' },
    { text: '仅用于办理签证', color: '#ff0000' },
    { text: '仅用于入职办理', color: '#ff0000' },
    { text: '仅用于XX办理', color: '#0066cc' },
    { text: '仅供一次性使用', color: '#0066cc' }
  ];

  const preset = presets[Math.floor(Math.random() * presets.length)];
  document.getElementById('watermarkText').value = preset.text;
  document.getElementById('watermarkColor').value = preset.color;

  // Enable watermark if not already enabled
  if (!watermarkEnabled.checked) {
    watermarkEnabled.checked = true;
    watermarkControls.classList.add('active');
    watermarkControls.classList.remove('disabled');
  }

  // Refresh preview
  drawA4Preview();
});
