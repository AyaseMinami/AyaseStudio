import "./App.css";

import { useAppearance } from "./appearance/useAppearance";
import { useChatSession } from "./chat/useChatSession";
import { AppShell } from "./ui/AppShell";
import { SettingsPanel } from "./ui/SettingsPanel";
import { ChatWorkspace } from "./ui/chat/ChatWorkspace";

function App() {
  const appearance = useAppearance();
  const chat = useChatSession({
    onConfigurationRequired: () => appearance.setSettingsOpen(true),
  });

  return (
    <AppShell
      settingsPanel={
        appearance.settingsOpen ? (
          <SettingsPanel
            activeProfile={chat.activeProfile}
            isStreaming={chat.isStreaming}
            protocol={chat.protocol}
            protocolInfo={chat.protocolInfo}
            themeMode={appearance.themeMode}
            onProfileChange={chat.updateProfile}
            onProtocolChange={chat.setProtocol}
            onThemeModeChange={appearance.setThemeMode}
          />
        ) : undefined
      }
    >
      <ChatWorkspace
        draft={chat.draft}
        error={chat.error}
        isHydrated={chat.isHydrated}
        isStreaming={chat.isStreaming}
        messages={chat.messages}
        protocolLabel={chat.protocolInfo.label}
        settingsOpen={appearance.settingsOpen}
        onClear={chat.clearConversation}
        onDraftChange={chat.setDraft}
        onSend={() => void chat.sendMessage()}
        onStop={chat.stopGeneration}
        onToggleSettings={() =>
          appearance.setSettingsOpen(!appearance.settingsOpen)
        }
      />
    </AppShell>
  );
}

export default App;
