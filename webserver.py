import base64
import io
from flask import Flask, send_file, request, jsonify
from PIL import Image
from idcard2pdf import _find_card_quadrilateral, _read_bgr, extract_idcard, make_a4_pdf
import cv2
import numpy as np

import os
app = Flask(__name__, static_url_path="", static_folder="web")
app.config['MAX_CONTENT_LENGTH'] = 20 * 1024 * 1024


@app.get("/")
def index():
    return app.send_static_file("index.html")


@app.post("/api/detect")
def api_detect():
    f = request.files.get("file")
    if not f:
        return jsonify({"error": "no file"}), 400
    data = f.read()
    img = cv2.imdecode(np.frombuffer(data, dtype=np.uint8), cv2.IMREAD_COLOR)
    quad = _find_card_quadrilateral(img)
    h, w = img.shape[:2]
    if quad is None:
        cx, cy = w // 2, h // 2
        dw, dh = int(w * 0.4), int(h * 0.3)
        pts = np.array([[cx - dw, cy - dh], [cx + dw, cy - dh], [cx + dw, cy + dh], [cx - dw, cy + dh]], dtype=np.float32)
    else:
        pts = quad
    pts = pts.tolist()
    return jsonify({"width": w, "height": h, "quad": pts})


@app.post("/api/warp")
def api_warp():
    payload = request.json
    b64 = payload.get("image_base64")
    quad = np.array(payload.get("quad"), dtype=np.float32)
    rotate = float(payload.get("rotate", 0.0))
    pad_px = int(payload.get("pad_px", 20))
    refine = bool(payload.get("refine", True))
    if not b64 or quad.shape != (4, 2):
        return jsonify({"error": "bad payload"}), 400
    raw = base64.b64decode(b64.split(",")[-1])
    img = Image.open(io.BytesIO(raw)).convert("RGB")
    arr = cv2.cvtColor(np.array(img), cv2.COLOR_RGB2BGR)
    ordered = np.array(quad, dtype=np.float32)
    s = ordered.sum(axis=1)
    diff = np.diff(ordered, axis=1)
    tl = ordered[np.argmin(s)]
    br = ordered[np.argmax(s)]
    tr = ordered[np.argmin(diff)]
    bl = ordered[np.argmax(diff)]
    ordered = np.array([tl, tr, br, bl], dtype=np.float32)
    w = int(max(np.linalg.norm(ordered[0] - ordered[1]), np.linalg.norm(ordered[2] - ordered[3])))
    h = int(max(np.linalg.norm(ordered[0] - ordered[3]), np.linalg.norm(ordered[1] - ordered[2])))
    dst = np.array([[0, 0], [w - 1, 0], [w - 1, h - 1], [0, h - 1]], dtype=np.float32)
    M = cv2.getPerspectiveTransform(ordered, dst)
    warped = cv2.warpPerspective(arr, M, (w, h))
    if refine:
        alpha = np.ones((warped.shape[0], warped.shape[1]), dtype=np.uint8) * 255
        b, g, r = cv2.split(warped)
        warped = cv2.merge((b, g, r, alpha))
    if rotate:
        Mrot = cv2.getRotationMatrix2D((warped.shape[1] / 2.0, warped.shape[0] / 2.0), rotate, 1.0)
        warped = cv2.warpAffine(warped, Mrot, (warped.shape[1], warped.shape[0]), flags=cv2.INTER_LINEAR, borderValue=(255, 255, 255, 0) if warped.shape[2] == 4 else (255, 255, 255))
    if pad_px > 0:
        if warped.shape[2] == 4:
            warped = cv2.copyMakeBorder(warped, pad_px, pad_px, pad_px, pad_px, cv2.BORDER_CONSTANT, value=(255, 255, 255, 0))
        else:
            warped = cv2.copyMakeBorder(warped, pad_px, pad_px, pad_px, pad_px, cv2.BORDER_CONSTANT, value=(255, 255, 255))
    if warped.shape[2] == 4:
        img_out = Image.fromarray(cv2.cvtColor(warped, cv2.COLOR_BGRA2RGBA))
    else:
        img_out = Image.fromarray(cv2.cvtColor(warped, cv2.COLOR_BGR2RGB))
    buf = io.BytesIO()
    img_out.save(buf, format="PNG")
    b64out = base64.b64encode(buf.getvalue()).decode("ascii")
    return jsonify({"image_base64": "data:image/png;base64," + b64out})


@app.post("/api/export")
def api_export():
    payload = request.json
    f_b64 = payload.get("front_base64")
    b_b64 = payload.get("back_base64")
    if not f_b64 or not b_b64:
        return jsonify({"error": "missing images"}), 400
    f_raw = base64.b64decode(f_b64.split(",")[-1])
    b_raw = base64.b64decode(b_b64.split(",")[-1])
    f_img = Image.open(io.BytesIO(f_raw)).convert("RGBA")
    b_img = Image.open(io.BytesIO(b_raw)).convert("RGBA")
    buf = io.BytesIO()
    tmp_path = buf
    cbuf = io.BytesIO()
    make_a4_pdf(f_img, b_img, cbuf)
    cbuf.seek(0)
    return send_file(cbuf, mimetype="application/pdf", as_attachment=True, download_name="idcard_a4.pdf")


if __name__ == "__main__":
    host = os.environ.get("HOST", "0.0.0.0")
    port = int(os.environ.get("PORT", "5000"))
    app.run(host=host, port=port, debug=False)