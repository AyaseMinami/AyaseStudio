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
          protocolLabel={
            chat.activeProvider && chat.activeConnection && chat.activeModel
              ? `${chat.activeProvider.name} · ${chat.activeConnection.name} · ${
                  chat.activeModel.displayName || chat.activeModel.modelId
                }`
              : "未选择模型"
          }
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
            connectionSettings: chat.connectionSettings,
            isStreaming: chat.isStreaming,
            modelCatalogs: chat.modelCatalogs,
            modelTests: chat.modelTests,
            onAddConnection: chat.addConnection,
            onAddModel: chat.addModel,
            onAddProvider: chat.addProvider,
            onCancelModelCatalogRefresh: chat.cancelModelCatalogRefresh,
            onCancelModelTest: chat.cancelModelTest,
            onConnectionChange: chat.updateConnection,
            onDeleteConnection: chat.deleteConnection,
            onDeleteModel: chat.deleteModel,
            onDeleteProvider: chat.deleteProvider,
            onModelChange: chat.updateModel,
            onProviderRename: chat.renameProvider,
            onRefreshModelCatalog: chat.refreshModelCatalog,
            onRunModelTest: chat.runModelTest,
            onSelectModel: chat.setActiveModel,
          }}
          onSectionChange={setActiveSettingsSection}
        />
      )}
    </AppShell>
  );
}

export default App;
