// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => {
  let reject!: (error: Error) => void;
  const startup = new Promise<void>((_resolve, failure) => { reject = failure; });
  return { startup, reject, verify: vi.fn(), recover: vi.fn(async () => false), appearance: vi.fn(), mounted: vi.fn(), settingsRequest: 0 };
});
vi.mock("../appearance/bootstrap", () => ({ startup: mocks.startup, verifyStartupConfiguration: mocks.verify }));
vi.mock("../appearance/browser", () => ({ applyBrowserInitialAppearance: mocks.appearance }));
vi.mock("./runtime", () => ({ createBackupApi: vi.fn(() => ({})), recoverBackupAtStartup: mocks.recover }));
vi.mock("../App", () => ({ default: (props: unknown) => { mocks.mounted(props); return <div>normal workspace</div>; } }));
vi.mock("../general/useTraySettingsRequest", () => ({ useTraySettingsRequest: () => mocks.settingsRequest }));
vi.mock("../ui/settings/BackupWorkspace", () => ({ BackupWorkspace: () => <div>protected backup workspace</div> }));
import { BackupApp } from "./BackupApp";

it("shows a protective startup failure and retries validation before mounting any normal workspace", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  try {
    await act(async () => { root.render(<BackupApp />); mocks.reject(new Error("synthetic unsupported data")); });
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("原数据已保留");
    expect(mocks.mounted).not.toHaveBeenCalled();
    mocks.settingsRequest = 1;
    await act(async () => root.render(<BackupApp />));
    expect(mocks.mounted).not.toHaveBeenCalled();
    expect([...host.querySelectorAll("button")].map(button => button.textContent)).toEqual(["重试整理", "恢复 Ayase 备份"]);
    mocks.verify.mockImplementationOnce(() => { throw new Error("still unsupported"); });
    await act(async () => host.querySelector<HTMLButtonElement>("button")!.click());
    expect(mocks.mounted).not.toHaveBeenCalled(); expect(mocks.appearance).not.toHaveBeenCalled();
    window.location.hash = "backup";
    await act(async () => host.querySelector<HTMLButtonElement>("button")!.click());
    expect(mocks.verify).toHaveBeenCalledTimes(2); expect(mocks.appearance).toHaveBeenCalledOnce();
    expect(host.textContent).toContain("protected backup workspace");
    expect(mocks.mounted).not.toHaveBeenCalled();
    window.location.hash = "";
    await act(async () => root.render(<BackupApp />));
    expect(host.textContent).toContain("normal workspace");
    expect(mocks.mounted).toHaveBeenLastCalledWith(expect.objectContaining({ settingsRequest: 1 }));
  } finally { window.location.hash = ""; await act(async () => root.unmount()); host.remove(); }
});
