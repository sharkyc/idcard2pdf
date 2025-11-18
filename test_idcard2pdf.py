import os
import tempfile

import cv2
import numpy as np
from PIL import Image

from idcard2pdf import extract_idcard, make_a4_pdf


def _make_synthetic(path: str, angle: float) -> None:
    h, w = 800, 1200
    bg = np.full((h, w, 3), (50, 120, 180), dtype=np.uint8)
    rect_w, rect_h = 600, 380
    center = (w // 2, h // 2)
    box = ((center[0], center[1]), (rect_w, rect_h), angle)
    pts = cv2.boxPoints(box).astype(np.int32)
    cv2.fillPoly(bg, [pts], (230, 230, 230))
    cv2.putText(bg, "ID", (center[0] - 40, center[1]), cv2.FONT_HERSHEY_SIMPLEX, 2.0, (40, 40, 40), 3)
    cv2.imwrite(path, bg)


def main():
    tempdir = tempfile.gettempdir()
    f_path = os.path.join(tempdir, "idcard_front.jpg")
    b_path = os.path.join(tempdir, "idcard_back.jpg")
    _make_synthetic(f_path, 12.0)
    _make_synthetic(b_path, -7.0)
    f_img = extract_idcard(f_path)
    b_img = extract_idcard(b_path)
    out_pdf = os.path.join(tempdir, "idcard_output.pdf")
    make_a4_pdf(f_img, b_img, out_pdf)
    assert os.path.exists(out_pdf)
    assert os.path.getsize(out_pdf) > 1000
    print(out_pdf)


if __name__ == "__main__":
    main()