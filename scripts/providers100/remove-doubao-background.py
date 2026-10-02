"""Remove this official avatar's blue matte without regenerating the person.

Requires Pillow. Foreground interiors retain their exact RGBA bytes; only the
connected blue backdrop and its immediately adjacent antialiased edge change.
Input is checked against the original official #100 asset hash.
"""
from collections import deque
from hashlib import sha256
from pathlib import Path
import sys

from PIL import Image

source, destination = map(Path, sys.argv[1:3])
assert sha256(source.read_bytes()).hexdigest() == "dabb2abd94e3a6c11e7f1a42c9343839b6ef643c086751b71afbc68f615aec38"
image = Image.open(source).convert("RGBA")
width, height = image.size
pixels = list(image.getdata())
blue = (202, 228, 255)

def neighbors(index):
    x, y = index % width, index // width
    for dy in (-1, 0, 1):
        for dx in (-1, 0, 1):
            nx, ny = x + dx, y + dy
            if (dx or dy) and 0 <= nx < width and 0 <= ny < height:
                yield ny * width + nx

def backdrop(pixel):
    return pixel[3] == 0 or max(abs(pixel[c] - blue[c]) for c in range(3)) <= 12

removed = set()
queue = deque(index for index in range(width * height)
              if (index % width in (0, width - 1) or index // width in (0, height - 1)) and backdrop(pixels[index]))
while queue:
    index = queue.popleft()
    if index in removed:
        continue
    removed.add(index)
    queue.extend(n for n in neighbors(index) if n not in removed and backdrop(pixels[n]))

# Only pixels touching the removed matte may be unmatted. Find nearby interior
# foreground as a color reference; do not change face, hair or shirt interiors.
edge = {n for index in removed for n in neighbors(index) if n not in removed}
result = list(pixels)
for index in removed:
    result[index] = (0, 0, 0, 0)
for index in edge:
    pixel = pixels[index]
    x, y = index % width, index // width
    candidates = []
    for dy in range(-3, 4):
        for dx in range(-3, 4):
            nx, ny = x + dx, y + dy
            if 0 <= nx < width and 0 <= ny < height:
                other = ny * width + nx
                if other not in removed and other not in edge and pixels[other][3] == 255:
                    candidates.append((dx * dx + dy * dy, other))
    if not candidates:
        continue
    foreground = pixels[min(candidates)[1]]
    vector = [foreground[c] - blue[c] for c in range(3)]
    denominator = sum(component * component for component in vector)
    if not denominator:
        continue
    alpha = sum((pixel[c] - blue[c]) * vector[c] for c in range(3)) / denominator
    # Skip opaque edges and unrelated colors; no color changes to solid art.
    if not 0 < alpha < 0.97:
        continue
    predicted = [blue[c] + alpha * vector[c] for c in range(3)]
    if max(abs(predicted[c] - pixel[c]) for c in range(3)) > 12:
        continue
    rgb = tuple(round(max(0, min(255, (pixel[c] - (1 - alpha) * blue[c]) / alpha))) for c in range(3))
    result[index] = (*rgb, round(pixel[3] * alpha))

image.putdata(result)
image.save(destination)
assert all(result[index] == pixels[index] for index in range(width * height) if index not in removed and index not in edge)
assert image.getchannel("A").getextrema() == (0, 255)
print(f"removed {len(removed)} backdrop pixels; inspected {len(edge)} edge pixels; all other RGBA pixels unchanged")
