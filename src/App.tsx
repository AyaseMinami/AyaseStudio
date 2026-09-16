import "./App.css";

import { useState } from "react";

import { useAppearance } from "./appearance/useAppearance";
import { useChatSession } from "./chat/useChatSession";
import { AppShell, type AppPage } from "./ui/AppShell";
import { ChatWorkspace } from "./ui/chat/ChatWorkspace";
import { ConversationNavigation } from "./ui/chat/ConversationNavigation";
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
        <ConversationNavigation workspace={chat.workspace} settings={chat.connectionSettings} generatingId={chat.generatingConversationId}>
        <ChatWorkspace
          key={chat.workspace.conversation?.id ?? "loading"}
          title={chat.workspace.conversation?.title ?? "新对话"}
          isGeneratingElsewhere={chat.isGenerating && chat.generatingConversationId !== chat.workspace.conversation?.id}
          draft={chat.draft}
          draftAttachments={chat.draftAttachments}
          attachmentBusy={chat.attachmentBusy}
          contextPlan={chat.contextPlan}
          error={chat.error}
          isHydrated={chat.isHydrated}
          isGenerating={chat.isGenerating}
          messages={chat.messages}
          modelId={chat.activeModel?.modelId}
          geminiThinking={chat.sessionConfig.geminiThinking}
          thinkingNotice={chat.thinkingNotice}
          onThinkingChange={(value) => void chat.setGeminiThinking(value)}
          protocol={chat.activeConnection?.protocol}
          protocolLabel={
            chat.activeProvider && chat.activeConnection && chat.activeModel
              ? `${chat.activeProvider.name} · ${chat.activeConnection.name} · ${
                  chat.activeModel.displayName || chat.activeModel.modelId
                }`
              : "未选择模型"
          }
          onClear={chat.clearConversation}
          onDraftChange={chat.setDraft}
          onFiles={(files) => void chat.addFiles(files)}
          onRemoveAttachment={chat.removeDraftAttachment}
          onReadAttachment={chat.readAttachment}
          onSend={() => void chat.sendMessage()}
          onStop={chat.stopGeneration}
        />
        </ConversationNavigation>
      ) : (
        <SettingsWorkspace
          activeSection={activeSettingsSection}
          appearance={{
            themeMode: appearance.themeMode,
            resolvedTheme: appearance.resolvedTheme,
            accentColor: appearance.accentColor,
            canvasColor: appearance.canvasColor,
            effectiveAccentColor: appearance.effectiveAccentColor,
            effectiveCanvasColor: appearance.effectiveCanvasColor,
            backgroundReference: appearance.backgroundReference,
            backgroundFit: appearance.backgroundFit,
            backgroundMask: appearance.backgroundMask,
            backgroundBlur: appearance.backgroundBlur,
            backgroundBusy: appearance.backgroundBusy,
            backgroundError: appearance.backgroundError,
            readabilityWarnings: appearance.readabilityWarnings,
            onThemeModeChange: appearance.setThemeMode,
            onAccentColorChange: appearance.setAccentColor,
            onCanvasColorChange: appearance.setCanvasColor,
            onBackgroundFitChange: appearance.setBackgroundFit,
            onBackgroundMaskChange: appearance.setBackgroundMask,
            onBackgroundBlurChange: appearance.setBackgroundBlur,
            onSelectBackground: appearance.selectBackground,
            onRemoveBackground: appearance.removeBackground,
            onResetCustomAppearance: appearance.resetCustomAppearance,
          }}
          connection={{
            canSelectModel: !!chat.workspace.assistant && !chat.workspace.busy,
            connectionSettings: chat.connectionSettings,
            isStreaming: chat.isGenerating,
            streamPreview: chat.sessionConfig.stream,
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
