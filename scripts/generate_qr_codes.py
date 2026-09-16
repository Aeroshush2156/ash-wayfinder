"""
Generate printable QR codes for ASH Wayfinder's QR anchor points.

Reads data/qrpoints.json (produced by waypoint-editor.html) and writes a
print-ready PDF to qr-codes/ASH_Wayfinder_QR_Codes.pdf, one A4 page per
anchor point. Each QR code encodes index.html?from=<id>, which pre-fills
that anchor as the visitor's starting location.

Usage (from the project root):

    pip install qrcode reportlab
    python3 scripts/generate_qr_codes.py

Re-run this any time data/qrpoints.json changes.
"""

import json
import os

import qrcode
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen import canvas

BASE_URL = "https://aeroshush2156.github.io/ash-wayfinder/index.html"

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.dirname(SCRIPT_DIR)
QRPOINTS_PATH = os.path.join(REPO_ROOT, "data", "qrpoints.json")
OUT_DIR = os.path.join(REPO_ROOT, "qr-codes")
OUT_PATH = os.path.join(OUT_DIR, "ASH_Wayfinder_QR_Codes.pdf")


def main():
    with open(QRPOINTS_PATH) as f:
        points = json.load(f)

    os.makedirs(OUT_DIR, exist_ok=True)

    c = canvas.Canvas(OUT_PATH, pagesize=A4)
    page_w, page_h = A4

    for p in points:
        url = f"{BASE_URL}?from={p['id']}"

        qr = qrcode.QRCode(
            version=None,
            error_correction=qrcode.constants.ERROR_CORRECT_M,
            box_size=10,
            border=2,
        )
        qr.add_data(url)
        qr.make(fit=True)
        img = qr.make_image(fill_color="black", back_color="white").convert("RGB")

        floor_name = "GROUND FLOOR" if p["floor"] == 0 else "FIRST FLOOR"

        c.setFont("Helvetica-Bold", 14)
        c.drawCentredString(page_w / 2, page_h - 25 * mm, "ASH Wayfinder")

        c.setFont("Helvetica", 12)
        c.drawCentredString(page_w / 2, page_h - 33 * mm, floor_name)

        c.setFont("Helvetica-Bold", 22)
        label = p["label"]
        max_width = page_w - 30 * mm
        words = label.split()
        lines, cur = [], ""
        for w in words:
            test = (cur + " " + w).strip()
            if c.stringWidth(test, "Helvetica-Bold", 22) > max_width and cur:
                lines.append(cur)
                cur = w
            else:
                cur = test
        if cur:
            lines.append(cur)

        ty = page_h - 50 * mm
        for line in lines:
            c.drawCentredString(page_w / 2, ty, line)
            ty -= 9 * mm

        qr_size = 110 * mm
        qr_x = (page_w - qr_size) / 2
        qr_y = (page_h - qr_size) / 2 - 15 * mm
        c.drawImage(ImageReader(img), qr_x, qr_y, width=qr_size, height=qr_size)

        c.setFont("Helvetica", 13)
        c.drawCentredString(page_w / 2, qr_y - 12 * mm, "Scan for walking directions from here")

        c.setFont("Helvetica", 8)
        c.setFillGray(0.4)
        c.drawCentredString(page_w / 2, 15 * mm, f"id: {p['id']}")
        c.drawCentredString(page_w / 2, 11 * mm, url)
        c.setFillGray(0)

        c.showPage()

    c.save()
    print(f"Saved {OUT_PATH} with {len(points)} pages")


if __name__ == "__main__":
    main()
