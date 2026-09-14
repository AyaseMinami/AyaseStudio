import "./App.css";

import { useState } from "react";

import { useAppearance } from "./appearance/useAppearance";
import { useChatSession } from "./chat/useChatSession";
import { AppShell, type AppPage } from "./ui/AppShell";
import { ChatWorkspace } from "./ui/chat/ChatWorkspace";
import {
  SettingsWorkspace,
  type SettingsSection,
} from "./ui/settings/SettingsWorkspace";

function App() {
  const [activePage, setActivePage] = useState<AppPage>("chat");
  const [activeSettingsSection, setActiveSettingsSection] =
    useState<SettingsSection>("connections");
  const appearance = useAppearance();
  const chat = useChatSession({
    onConfigurationRequired: () => {
      setActiveSettingsSection("connections");
      setActivePage("settings");
    },
  });

  return (
    <AppShell activePage={activePage} onPageChange={setActivePage}>
      {activePage === "chat" ? (
        <ChatWorkspace
          draft={chat.draft}
          error={chat.error}
          isHydrated={chat.isHydrated}
          isStreaming={chat.isStreaming}
          messages={chat.messages}
          protocolLabel={chat.protocolInfo.label}
          onClear={chat.clearConversation}
          onDraftChange={chat.setDraft}
          onSend={() => void chat.sendMessage()}
          onStop={chat.stopGeneration}
        />
      ) : (
        <SettingsWorkspace
          activeSection={activeSettingsSection}
          appearance={{
            themeMode: appearance.themeMode,
            onThemeModeChange: appearance.setThemeMode,
          }}
          connection={{
            activeProfile: chat.activeProfile,
            isStreaming: chat.isStreaming,
            protocol: chat.protocol,
            protocolInfo: chat.protocolInfo,
            onProfileChange: chat.updateProfile,
            onProtocolChange: chat.setProtocol,
          }}
          onSectionChange={setActiveSettingsSection}
        />
      )}
    </AppShell>
  );
}

export default App;
