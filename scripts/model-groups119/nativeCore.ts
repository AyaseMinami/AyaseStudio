export async function invoke(): Promise<never> { throw new Error("Native calls are disabled in the isolated model-group preview."); }
export function isTauri() { return false; }
export function convertFileSrc(): never { throw new Error("Native files are disabled in the isolated model-group preview."); }
