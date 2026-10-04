export async function openExternal(url: string): Promise<void> {
  window.dispatchEvent(new CustomEvent("fixture76:external-link", { detail: url }));
}
