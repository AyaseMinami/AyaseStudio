"""Export the SVG with the repository's Tauri CLI, then package desktop assets.

Run from any directory: python assets/branding/export.py
Requires Pillow; uses the existing npm installation, without fetching packages.
"""

from pathlib import Path
import os
import subprocess
import shutil
import tempfile

from PIL import Image, ImageDraw


HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
SIZES = (16, 24, 32, 48, 64, 128, 256, 512, 1024)
PREVIEW = HERE / "preview"
command = [
    "npm.cmd" if os.name == "nt" else "npm", "run", "tauri", "--", "icon",
    str(HERE / "ayase-icon.svg"), "--output", str(PREVIEW),
]
for size in SIZES:
    command.extend(("--png", str(size)))
subprocess.run(command, cwd=ROOT, check=True)

frames = {}
for size in SIZES:
    with Image.open(PREVIEW / f"{size}x{size}.png") as source:
        frames[size] = source.convert("RGBA")
    assert frames[size].size == (size, size)
    assert frames[size].getpixel((0, 0))[3] == 0

# Supply the SVG-rendered frames directly rather than downsampling one bitmap.
frames[256].save(
    HERE / "ayase-icon.ico", format="ICO", bitmap_format="png",
    sizes=[(size, size) for size in SIZES if size <= 256],
    append_images=[frames[size] for size in SIZES if size < 256],
)
with Image.open(HERE / "ayase-icon.ico") as icon:
    assert icon.ico.sizes() == {(size, size) for size in SIZES if size <= 256}

# Refresh the existing desktop bundle assets without adding mobile platforms.
desktop = ROOT / "src-tauri" / "icons"
with tempfile.TemporaryDirectory(prefix="ayase-icons-") as temporary:
    subprocess.run(command[:7] + [temporary], cwd=ROOT, check=True)
    for target in desktop.iterdir():
        generated = Path(temporary) / target.name
        if target.is_file() and generated.is_file():
            shutil.copyfile(generated, target)
shutil.copyfile(HERE / "ayase-icon.ico", desktop / "icon.ico")

sheet = Image.new("RGB", (1000, 480), "#f4f5f9")
draw = ImageDraw.Draw(sheet)
draw.rectangle((0, 240, 999, 479), fill="#20232d")
for top, text_color in ((0, "#242838"), (240, "#eef0f8")):
    draw.text((24, top + 16), "AYASE STUDIO / SVG / actual pixel sizes", fill=text_color)
    x = 24
    for size in (16, 24, 32, 48, 64, 128):
        sheet.paste(frames[size], (x, top + 70), frames[size])
        draw.text((x, top + 210), f"{size}px", fill=text_color)
        x += max(size + 40, 90)
    overview = frames[256].resize((180, 180), Image.Resampling.LANCZOS)
    sheet.paste(overview, (790, top + 42), overview)
sheet.save(HERE / "size-review.png")
print("Verified PNG dimensions/transparency and all seven ICO frames.")
