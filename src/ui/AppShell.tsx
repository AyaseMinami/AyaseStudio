import type { ReactNode } from "react";
import { Image, MessageSquare, Settings } from "lucide-react";
import appIcon from "../../assets/branding/ayase-icon.svg";

export type AppPage = "chat" | "drawing" | "settings";

export function AppShell({
  activePage,
  children,
  background,
  onPageChange,
  interactionDisabled = false,
}: {
  activePage: AppPage;
  children: ReactNode;
  background?: ReactNode;
  onPageChange(page: AppPage): void;
  interactionDisabled?: boolean;
}) {
  return (
    <main className="app-shell" inert={interactionDisabled} aria-busy={interactionDisabled || undefined}>
      <div className="app-background" aria-hidden="true">{background}</div>
      <div className="app-window-chrome" aria-hidden="true" />
      <aside className="app-navigation" aria-label="主要功能">
        <div className="app-navigation-brand" aria-label="Ayase Studio">
          <img src={appIcon} width={28} height={28} alt="" />
        </div>
        <nav className="app-navigation-pages">
          <button
            className="app-navigation-button"
            aria-label="聊天"
            title="聊天"
            aria-current={activePage === "chat" ? "page" : undefined}
            onClick={() => onPageChange("chat")}
            type="button"
          >
            <MessageSquare size={19} />
          </button>
          <button
            className="app-navigation-button"
            aria-label="绘图"
            title="绘图"
            aria-current={activePage === "drawing" ? "page" : undefined}
            onClick={() => onPageChange("drawing")}
            type="button"
          >
            <Image size={19} />
          </button>
          <button
            className="app-navigation-button app-navigation-settings"
            aria-label="设置"
            title="设置"
            aria-current={activePage === "settings" ? "page" : undefined}
            onClick={() => onPageChange("settings")}
            type="button"
          >
            <Settings size={19} />
          </button>
        </nav>
      </aside>
      <section className="workspace-shell">{children}</section>
    </main>
  );
}
