// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { SentAttachmentPreview } from "./SentAttachmentPreview";
import type { RequestAttachment, SentAttachment } from "../../chat/attachments";

const pdf = vi.hoisted(() => {
  let release!: () => void;
  let started!: () => void;
  return {
    gate: new Promise<void>(resolve => { release = resolve; }),
    loading: new Promise<void>(resolve => { started = resolve; }),
    release: () => release(), started: () => started(), getDocument: vi.fn(),
  };
});
vi.mock("pdfjs-dist", async () => {
  pdf.started();
  await pdf.gate;
  return { GlobalWorkerOptions: { workerSrc: "" }, getDocument: pdf.getDocument };
});
vi.mock("pdfjs-dist/build/pdf.worker.min.mjs?url", () => ({ default: "mock-worker" }));

const item: SentAttachment = {
  name: "example.pdf", mimeType: "application/pdf", size: 3,
  reference: "attachments/example.pdf",
};
const read = async (): Promise<RequestAttachment> => ({ ...item, data: "cGRm" });

function mount() {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  return { host, root, render: () => root.render(
    <SentAttachmentPreview item={item} read={read} returnFocus={host} onClose={() => {}} />,
  ) };
}

it("does not start a PDF worker if the preview closes during the lazy import", async () => {
  const { host, root, render } = mount();
  await act(async () => render());
  await pdf.loading;
  await act(async () => root.unmount());
  await act(async () => { pdf.release(); await vi.dynamicImportSettled(); });
  expect(pdf.getDocument).not.toHaveBeenCalled();
  host.remove();
});

it("destroys an already started PDF task when closing before document loading finishes", async () => {
  let resolve!: (document: { numPages: number; getPage: ReturnType<typeof vi.fn> }) => void;
  const promise = new Promise<{ numPages: number; getPage: ReturnType<typeof vi.fn> }>(done => { resolve = done; });
  const destroy = vi.fn().mockResolvedValue(undefined);
  pdf.getDocument.mockReturnValue({ promise, destroy });
  const { host, root, render } = mount();
  await act(async () => { render(); });
  await act(async () => { await vi.dynamicImportSettled(); });
  expect(pdf.getDocument).toHaveBeenCalledTimes(1);
  await act(async () => root.unmount());
  expect(destroy).toHaveBeenCalledTimes(1);
  const getPage = vi.fn();
  await act(async () => resolve({ numPages: 1, getPage }));
  expect(getPage).not.toHaveBeenCalled();
  host.remove();
});
