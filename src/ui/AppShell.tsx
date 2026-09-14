import type { ReactNode } from "react";

export function AppShell({
  settingsPanel,
  children,
}: {
  settingsPanel?: ReactNode;
  children: ReactNode;
}) {
  return (
    <main className="app-shell">
      {settingsPanel}
      <section className="workspace-shell">{children}</section>
    </main>
  );
}
