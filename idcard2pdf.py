import argparse
import io
import os
from typing import Tuple

import cv2
import numpy as np
from PIL import Image
from reportlab.lib.pagesizes import A4
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont


def _read_bgr(path: str) -> np.ndarray:
    img = cv2.imdecode(np.fromfile(path, dtype=np.uint8), cv2.IMREAD_COLOR)
    return img


def _resize_for_processing(img: np.ndarray, target_max: int = 1000) -> Tuple[np.ndarray, float]:
    h, w = img.shape[:2]
    scale = 1.0
    if max(h, w) > target_max:
        scale = target_max / float(max(h, w))
        img = cv2.resize(img, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_AREA)
    return img, scale


def _order_pts(pts: np.ndarray) -> np.ndarray:
    s = pts.sum(axis=1)
    diff = np.diff(pts, axis=1)
    tl = pts[np.argmin(s)]
    br = pts[np.argmax(s)]
    tr = pts[np.argmin(diff)]
    bl = pts[np.argmax(diff)]
    return np.array([tl, tr, br, bl], dtype=np.float32)


def _find_card_quadrilateral(img: np.ndarray) -> np.ndarray:
    proc, scale = _resize_for_processing(img)
    gray = cv2.cvtColor(proc, cv2.COLOR_BGR2GRAY)
    gray = cv2.GaussianBlur(gray, (5, 5), 0)
    edges = cv2.Canny(gray, 50, 150)
    edges = cv2.dilate(edges, np.ones((3, 3), np.uint8), iterations=1)
    contours, _ = cv2.findContours(edges, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    best = None
    best_score = -1.0
    for cnt in contours:
        peri = cv2.arcLength(cnt, True)
        approx = cv2.approxPolyDP(cnt, 0.02 * peri, True)
        if len(approx) != 4:
            continue
        area = cv2.contourArea(approx)
        if area < 0.02 * proc.shape[0] * proc.shape[1]:
            continue
        rect = cv2.minAreaRect(approx)
        (cx, cy), (rw, rh), _ = rect
        if rw == 0 or rh == 0:
            continue
        ratio = max(rw, rh) / max(1.0, min(rw, rh))
        if ratio < 1.2 or ratio > 2.2:
            continue
        box = approx.reshape(-1, 2).astype(np.float32)
        box = _order_pts(box)
        w = np.linalg.norm(box[0] - box[1])
        h = np.linalg.norm(box[0] - box[3])
        score = area + 0.5 * (w + h)
        if score > best_score:
            best_score = score
            best = box
    if best is None:
        return None
    best = best / scale
    return best.astype(np.float32)


def _warp_card(img: np.ndarray, quad: np.ndarray) -> Tuple[np.ndarray, np.ndarray]:
    ordered = _order_pts(quad.astype(np.float32))
    w = int(max(np.linalg.norm(ordered[0] - ordered[1]), np.linalg.norm(ordered[2] - ordered[3])))
    h = int(max(np.linalg.norm(ordered[0] - ordered[3]), np.linalg.norm(ordered[1] - ordered[2])))
    w = max(w, 1)
    h = max(h, 1)
    dst = np.array([[0, 0], [w - 1, 0], [w - 1, h - 1], [0, h - 1]], dtype=np.float32)
    M = cv2.getPerspectiveTransform(ordered, dst)
    warped = cv2.warpPerspective(img, M, (w, h))
    return warped, M


def extract_idcard(path: str, pad_px: int = 20, refine: bool = True, rotate_to_landscape: bool = True) -> Image.Image:
    img = _read_bgr(path)
    quad = _find_card_quadrilateral(img)
    if quad is None:
        rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
        out = Image.fromarray(rgb)
        if rotate_to_landscape and out.width < out.height:
            out = out.rotate(90, expand=True)
        return out
    warped, M = _warp_card(img, quad)
    if refine:
        alpha = np.ones((warped.shape[0], warped.shape[1]), dtype=np.uint8) * 255
        b, g, r = cv2.split(warped)
        rgba = cv2.merge((r, g, b, alpha))
        warped = cv2.cvtColor(rgba, cv2.COLOR_RGBA2BGRA)
    if pad_px > 0:
        if warped.shape[2] == 4:
            warped = cv2.copyMakeBorder(warped, pad_px, pad_px, pad_px, pad_px, cv2.BORDER_CONSTANT, value=(255, 255, 255, 0))
        else:
            warped = cv2.copyMakeBorder(warped, pad_px, pad_px, pad_px, pad_px, cv2.BORDER_CONSTANT, value=(255, 255, 255))
    if rotate_to_landscape and warped.shape[1] < warped.shape[0]:
        warped = cv2.rotate(warped, cv2.ROTATE_90_COUNTERCLOCKWISE)
    if warped.shape[2] == 4:
        rgba = cv2.cvtColor(warped, cv2.COLOR_BGRA2RGBA)
        return Image.fromarray(rgba)
    rgb = cv2.cvtColor(warped, cv2.COLOR_BGR2RGB)
    return Image.fromarray(rgb)


def _pil_to_bytes(img: Image.Image) -> bytes:
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


# Global variable to track if Chinese font has been registered
_chinese_font_registered = False
_chinese_font_name = None


def _register_chinese_font():
    """Register a Chinese font for ReportLab"""
    global _chinese_font_registered, _chinese_font_name

    if _chinese_font_registered:
        return _chinese_font_name

    # List of common Chinese fonts to try, in order of preference
    font_paths = []

    # Windows fonts
    windows_fonts = [
        ('C:/Windows/Fonts/msyh.ttc', 'Microsoft YaHei'),
        ('C:/Windows/Fonts/simhei.ttf', 'SimHei'),
        ('C:/Windows/Fonts/simsun.ttc', 'SimSun'),
        ('C:/Windows/Fonts/simkai.ttf', 'KaiTi'),
    ]

    # Linux fonts
    linux_fonts = [
        ('/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc', 'WenQuanYi Zen Hei'),
        ('/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc', 'Noto Sans CJK'),
        ('/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc', 'Noto Sans CJK'),
        ('/System/Library/Fonts/PingFang.ttc', 'PingFang'),  # macOS also
    ]

    # macOS fonts
    macos_fonts = [
        ('/System/Library/Fonts/PingFang.ttc', 'PingFang'),
        ('/System/Library/Fonts/STHeiti Light.ttc', 'STHeiti'),
        ('/Library/Fonts/Arial Unicode.ttf', 'Arial Unicode'),
    ]

    # Try to find and register a font based on the platform
    import platform
    system = platform.system()

    if system == 'Windows':
        font_paths = windows_fonts
    elif system == 'Linux':
        font_paths = linux_fonts + windows_fonts  # Also try Windows fonts via Wine
    elif system == 'Darwin':  # macOS
        font_paths = macos_fonts
    else:
        font_paths = linux_fonts + macos_fonts + windows_fonts  # Try all

    for font_path, font_name in font_paths:
        if os.path.exists(font_path):
            try:
                # Register the font with a unique name
                registered_name = f'ChineseFont-{font_name.replace(" ", "")}'
                pdfmetrics.registerFont(TTFont(registered_name, font_path))
                _chinese_font_registered = True
                _chinese_font_name = registered_name
                print(f"Registered Chinese font: {font_name} from {font_path}")
                return registered_name
            except Exception as e:
                print(f"Failed to register font {font_path}: {e}")
                continue

    # If no Chinese font found, return None (will use default)
    print("Warning: No Chinese font found, watermarks may not display correctly")
    _chinese_font_registered = True  # Don't try again
    _chinese_font_name = None
    return None


def _contains_chinese(text: str) -> bool:
    """Check if text contains Chinese characters"""
    for char in text:
        if '\u4e00' <= char <= '\u9fff':
            return True
    return False


def make_a4_pdf(front: Image.Image, back: Image.Image, out_path: str, watermark_config: dict = None) -> None:
    page_w, page_h = A4
    c = canvas.Canvas(out_path, pagesize=A4)

    def mm_to_pt(mm: float) -> float:
        return mm * 72.0 / 25.4

    def hex_to_rgb(hex_color: str) -> tuple:
        """Convert hex color to RGB tuple (0-1 range for ReportLab)"""
        hex_color = hex_color.lstrip('#')
        return tuple(int(hex_color[i:i+2], 16) / 255.0 for i in (0, 2, 4))

    def draw_watermark(c_canvas, config: dict, page_width: float, page_height: float):
        """Draw watermark on the canvas"""
        text = config.get('text', '仅用于XX办理')
        mode = config.get('mode', 'tile')
        size = config.get('size', 48)
        opacity = config.get('opacity', 0.3)
        color = config.get('color', '#ff0000')
        rotation = config.get('rotation', -45)

        c_canvas.saveState()
        c_canvas.setFillAlpha(opacity)

        # Convert hex color to RGB
        rgb_color = hex_to_rgb(color)
        c_canvas.setFillColorRGB(*rgb_color)

        # Choose font based on whether text contains Chinese
        if _contains_chinese(text):
            font_name = _register_chinese_font()
            if font_name:
                c_canvas.setFont(font_name, size)
            else:
                # Fallback to default, but it won't display Chinese correctly
                c_canvas.setFont("Helvetica-Bold", size)
        else:
            c_canvas.setFont("Helvetica-Bold", size)

        # Get font name for stringWidth calculation
        if _contains_chinese(text):
            font_for_width = _register_chinese_font() or "Helvetica-Bold"
        else:
            font_for_width = "Helvetica-Bold"

        if mode == 'single':
            # Single centered watermark
            c_canvas.translate(page_width / 2, page_height / 2)
            c_canvas.rotate(rotation)
            c_canvas.drawCentredString(0, 0, text)
        else:
            # Tiled watermark mode
            # Calculate text dimensions for spacing
            text_width = c_canvas.stringWidth(text, font_for_width, size)
            text_height = size * 1.2  # Approximate height with line spacing

            # Spacing between watermarks
            spacing_x = text_width + 50
            spacing_y = text_height + 50

            # Create a grid of watermarks
            for y in range(int(-page_height), int(page_height * 2), int(spacing_y)):
                for x in range(int(-page_width), int(page_width * 2), int(spacing_x)):
                    c_canvas.saveState()
                    # Position and rotate
                    c_canvas.translate(x, y)
                    c_canvas.rotate(rotation)
                    c_canvas.drawString(0, 0, text)
                    c_canvas.restoreState()

        c_canvas.restoreState()

    card_w_pt = mm_to_pt(85.6)
    card_h_pt = mm_to_pt(54.0)
    gap_pt = mm_to_pt(10.0)

    if front.width < front.height:
        front = front.rotate(90, expand=True)
    if back.width < back.height:
        back = back.rotate(90, expand=True)

    total_h = card_h_pt * 2.0 + gap_pt
    start_y = (page_h - total_h) / 2.0
    x = (page_w - card_w_pt) / 2.0

    front_x = x
    back_x = x
    back_y = start_y
    front_y = start_y + card_h_pt + gap_pt

    # Draw ID cards
    c.drawImage(ImageReader(io.BytesIO(_pil_to_bytes(front))), front_x, front_y, width=card_w_pt, height=card_h_pt, preserveAspectRatio=False, mask='auto')
    c.drawImage(ImageReader(io.BytesIO(_pil_to_bytes(back))), back_x, back_y, width=card_w_pt, height=card_h_pt, preserveAspectRatio=False, mask='auto')

    # Draw watermark if configured
    if watermark_config:
        draw_watermark(c, watermark_config, page_w, page_h)

    c.showPage()
    c.save()


def run_cli():
    parser = argparse.ArgumentParser()
    parser.add_argument("--front", required=True)
    parser.add_argument("--back", required=True)
    parser.add_argument("--out", required=True)
    args = parser.parse_args()
    front = extract_idcard(args.front)
    back = extract_idcard(args.back)
    make_a4_pdf(front, back, args.out)
    print(args.out)


def run_gui():
    import tkinter as tk
    from tkinter import filedialog, messagebox

    root = tk.Tk()
    root.title("身份证合并到A4 PDF")

    paths = {"front": None, "back": None}

    def select_front():
        p = filedialog.askopenfilename(title="选择正面照片", filetypes=[("图片", "*.jpg;*.jpeg;*.png;*.bmp;*.webp")])
        if p:
            paths["front"] = p
            btn_front.configure(text=os.path.basename(p))

    def select_back():
        p = filedialog.askopenfilename(title="选择反面照片", filetypes=[("图片", "*.jpg;*.jpeg;*.png;*.bmp;*.webp")])
        if p:
            paths["back"] = p
            btn_back.configure(text=os.path.basename(p))

    def generate_pdf():
        if not paths["front"] or not paths["back"]:
            messagebox.showerror("错误", "请先选择两张照片")
            return
        out = filedialog.asksaveasfilename(title="保存PDF", defaultextension=".pdf", filetypes=[("PDF", "*.pdf")])
        if not out:
            return
        try:
            f = extract_idcard(paths["front"])
            b = extract_idcard(paths["back"])
            make_a4_pdf(f, b, out)
            messagebox.showinfo("完成", f"已生成: {out}")
        except Exception as e:
            messagebox.showerror("失败", str(e))

    btn_front = tk.Button(root, text="选择正面照片", width=30, command=select_front)
    btn_back = tk.Button(root, text="选择反面照片", width=30, command=select_back)
    btn_gen = tk.Button(root, text="生成PDF", width=30, command=generate_pdf)

    btn_front.pack(padx=10, pady=10)
    btn_back.pack(padx=10, pady=10)
    btn_gen.pack(padx=10, pady=20)

    root.mainloop()


if __name__ == "__main__":
    import sys
    if any(arg.startswith("--front") for arg in sys.argv):
        run_cli()
    else:
        run_gui()