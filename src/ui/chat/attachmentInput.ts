export interface PasteImageSequence { stamp: string; count: number }

/** Shared by focused chat inputs; no global clipboard listener. */
export function namePastedImages(images: File[], existingNames: string[], sequence: PasteImageSequence, now = new Date()): File[] {
  const pad = (value: number) => String(value).padStart(2, "0");
  const stamp = `${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  if (sequence.stamp !== stamp) { sequence.stamp = stamp; sequence.count = 0; }
  const names = new Set([...existingNames, ...images.map((image) => image.name)]);
  return images.map((image) => {
    if (image.name.trim() && !/^image(?:\.[a-z0-9]+)?$/i.test(image.name)) return image;
    const extension = image.type === "image/jpeg" ? "jpg" : image.type === "image/webp" ? "webp" : "png";
    let name: string;
    do {
      const count = ++sequence.count;
      name = `粘贴图片-${stamp}${count > 1 ? `-${count}` : ""}.${extension}`;
    } while (names.has(name));
    names.add(name);
    return new File([image], name, { type: image.type, lastModified: image.lastModified });
  });
}
