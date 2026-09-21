import type { ReactNode } from "react";
import { MessageSquare, Settings } from "lucide-react";
import appIcon from "../../assets/branding/ayase-icon.svg";

export type AppPage = "chat" | "settings";

export function AppShell({
  activePage,
  children,
  onPageChange,
}: {
  activePage: AppPage;
  children: ReactNode;
  onPageChange(page: AppPage): void;
}) {
  return (
    <main className="app-shell">
      <aside className="app-navigation" aria-label="主要功能">
        <div className="app-navigation-brand" aria-label="Ayase Studio">
          <img src={appIcon} width={40} height={40} alt="" />
        </div>
        <nav className="app-navigation-pages">
          <button
            className="app-navigation-button"
            aria-label="聊天"
            aria-current={activePage === "chat" ? "page" : undefined}
            onClick={() => onPageChange("chat")}
            type="button"
          >
            <MessageSquare size={19} />
            <span>聊天</span>
          </button>
          <button
            className="app-navigation-button app-navigation-settings"
            aria-label="设置"
            aria-current={activePage === "settings" ? "page" : undefined}
            onClick={() => onPageChange("settings")}
            type="button"
          >
            <Settings size={19} />
            <span>设置</span>
          </button>
        </nav>
      </aside>
      <section className="workspace-shell">{children}</section>
    </main>
  );
}
