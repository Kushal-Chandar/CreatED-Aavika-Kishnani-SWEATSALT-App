#!/usr/bin/env python3
"""Render the firmware's real OLED screens on the desktop.

Usage: python3 tools/oled-preview/preview.py [out.png]

Extracts the display code from firmware/firmware.ino, compiles it against a
framebuffer SSD1306 + the real Adafruit_GFX, and draws every screen.
"""
import re, subprocess, sys, tempfile, pathlib
from PIL import Image, ImageDraw

HERE = pathlib.Path(__file__).resolve().parent
INO = HERE.parent.parent / "firmware" / "firmware.ino"
GFX = pathlib.Path.home() / "Arduino/libraries/Adafruit_GFX_Library"
OUT = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else HERE / "preview.png"

src = INO.read_text().splitlines(keepends=True)
RULE = "// " + "=" * 77


def section_start(name):
    for i, l in enumerate(src):
        if l.rstrip() == "//  " + name or (l.startswith("//  " + name) and name not in ("BLE", "SETUP")):
            return i - 1  # the rule line above the title
    raise SystemExit(f"section not found: {name}")


def slice_(first, until):
    return "".join(src[section_start(first):section_start(until)])


build = pathlib.Path(tempfile.mkdtemp(prefix="oledprev_"))
(build / "slice_a.inc").write_text(slice_("ALERT TYPE ENUM", "MPU-6050"))
(build / "slice_b.inc").write_text(slice_("HISTORY BUFFERS", "HEART RATE / PULSE"))
(build / "slice_c.inc").write_text(slice_("DISPLAY STATE", "BLE"))
(build / "slice_d.inc").write_text(slice_("BOOT SEQUENCE", "SETUP"))
exe = build / "preview"
cmd = ["g++", "-std=c++17", "-O1", "-w", "-DARDUINO=200", f"-I{HERE/'shim'}", f"-I{GFX}", f"-I{build}", f"-I{HERE}",
       str(HERE / "harness.cpp"), str(GFX / "Adafruit_GFX.cpp"), "-o", str(exe)]
subprocess.run(cmd, check=True)
out = subprocess.run([str(exe)], check=True, capture_output=True, text=True).stdout

frames = []
for block in out.split("FRAME ")[1:]:
    lines = block.strip().split("\n")
    frames.append((lines[0], lines[1:65]))

S, PAD, COLS = 4, 14, 3
W, H = 128 * S, 64 * S
LABEL = 16
rows = (len(frames) + COLS - 1) // COLS
img = Image.new("RGB", (COLS * (W + PAD) + PAD, rows * (H + LABEL + PAD) + PAD), (24, 24, 28))
d = ImageDraw.Draw(img)
for n, (name, px) in enumerate(frames):
    cx = PAD + (n % COLS) * (W + PAD)
    cy = PAD + (n // COLS) * (H + LABEL + PAD)
    d.text((cx, cy), name, fill=(200, 200, 210))
    oy = cy + LABEL
    d.rectangle([cx - 2, oy - 2, cx + W + 1, oy + H + 1], outline=(70, 70, 80))
    d.rectangle([cx, oy, cx + W - 1, oy + H - 1], fill=(0, 0, 0))
    for y, row in enumerate(px):
        for x, c in enumerate(row):
            if c == "1":
                d.rectangle([cx + x * S, oy + y * S, cx + x * S + S - 2, oy + y * S + S - 2], fill=(120, 210, 255))
img.save(OUT)
print(f"{len(frames)} screens -> {OUT}")
