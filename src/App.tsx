import "./App.css";

import { useState } from "react";

import { useAppearance } from "./appearance/useAppearance";
import { BackgroundFocusDialog } from "./ui/settings/BackgroundFocusDialog";
import { BackgroundImage } from "./ui/settings/BackgroundImage";
import { useChatSession } from "./chat/useChatSession";
import { getThinkingSettings } from "./chat/thinking";
import { AppShell, type AppPage } from "./ui/AppShell";
import { ChatWorkspace } from "./ui/chat/ChatWorkspace";
import { ChatHeader } from "./ui/chat/ChatHeader";
import { ConversationNavigation } from "./ui/chat/ConversationNavigation";
import { useChatLayout } from "./ui/chat/useChatLayout";
import {
  SettingsWorkspace,
  type SettingsSection,
} from "./ui/settings/SettingsWorkspace";

function App() {
  const [activePage, setActivePage] = useState<AppPage>("chat");
  const [activeSettingsSection, setActiveSettingsSection] =
    useState<SettingsSection>("connections");
  const appearance = useAppearance();
  const chatLayout = useChatLayout();
  const chat = useChatSession({
    onConfigurationRequired: () => {
      setActiveSettingsSection("connections");
      setActivePage("settings");
    },
  });
  const modelLabel = chat.activeProvider && chat.activeConnection && chat.activeModel
    ? `${chat.activeProvider.name} · ${chat.activeConnection.name} · ${chat.activeModel.displayName || chat.activeModel.modelId}`
    : `${chat.workspace.effective.modelId ? "模型已失效" : "未选择模型"} · 点击选择模型`;

  return (
    <AppShell activePage={activePage} onPageChange={setActivePage}
      background={<div className="appearance-background-art"><BackgroundImage url={appearance.backgroundUrl} focus={appearance.backgroundFocus} fit={appearance.backgroundFit} /></div>}>
      {appearance.backgroundDraft && <BackgroundFocusDialog
        url={appearance.backgroundDraft.url} focus={appearance.backgroundDraft.focus} fit={appearance.backgroundFit}
        onConfirm={(focus) => void appearance.confirmBackgroundFocus(focus)}
        onCancel={() => void appearance.cancelBackgroundFocus()} />}
      {activePage === "chat" ? (
        <ConversationNavigation workspace={chat.workspace} settings={chat.connectionSettings} generatingIds={chat.generatingConversationIds}
          toolbar={<ChatHeader key={chat.workspace.conversation?.id ?? "loading"} title={chat.workspace.conversation?.title ?? "新对话"}
            layout={chatLayout.layout} onToggleLayout={chatLayout.toggleLayout} isHydrated={chat.isHydrated}
            isGenerating={chat.isGenerating}
            onClear={chat.clearConversation} />}>
        <ChatWorkspace hideHeader
          layout={chatLayout.layout}
          onToggleLayout={chatLayout.toggleLayout}
          key={chat.workspace.conversation?.id ?? "loading"}
          title={chat.workspace.conversation?.title ?? "新对话"}
          draft={chat.draft}
          draftAttachments={chat.draftAttachments}
          attachmentBusy={chat.attachmentBusy}
          contextPlan={chat.contextPlan}
          error={chat.error}
          isHydrated={chat.isHydrated}
          isGenerating={chat.isGenerating}
          messages={chat.messages}
          messageActions={{ edit: chat.editMessage, editAndSend: chat.editAndSendMessage, delete: chat.deleteMessage, retry: chat.retryMessage, branch: chat.branchMessage, continue: chat.continueMessage, selectVersion: chat.selectRoundVersion }}
          messageActionsDisabled={!chat.isHydrated || chat.isGenerating}
          messageActionError={chat.workspace.operationError}
          modelId={chat.activeModel?.modelId}
          thinking={getThinkingSettings(chat.sessionConfig, chat.activeConnection?.protocol ?? "gemini-native")}
          onThinkingChange={(value) => void chat.setThinking(value)}
          webSearch={chat.sessionConfig.webSearch ?? false}
          onWebSearchChange={(enabled) => void chat.setWebSearch(enabled)}
          protocol={chat.activeConnection?.protocol}
          protocolLabel={modelLabel}
          modelLabel={chat.activeModel?.displayName || chat.activeModel?.modelId || (chat.workspace.effective.modelId ? "模型已失效" : "选择模型")}
          modelPicker={{ settings: chat.connectionSettings, selectedModelId: chat.workspace.effective.modelId,
            disabled: !chat.isHydrated, error: chat.workspace.operationError ?? chat.workspace.loadError,
            onSelect: chat.setConversationModel }}
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
            unifiedThemeColor: appearance.unifiedThemeColor,
            effectiveUserBubbleColor: appearance.effectiveUserBubbleColor,
            onUnifiedThemeColorChange: appearance.setUnifiedThemeColor,
            onUserBubbleColorChange: appearance.setUserBubbleColor,
            canvasColor: appearance.canvasColor,
            assistantBubbleColor: appearance.assistantBubbleColor,
            unifiedTransparency: appearance.unifiedTransparency,
            sidebarTransparency: appearance.sidebarTransparency,
            composerTransparency: appearance.composerTransparency,
            assistantBubbleTransparency: appearance.assistantBubbleTransparency,
            effectiveAccentColor: appearance.effectiveAccentColor,
            effectiveCanvasColor: appearance.effectiveCanvasColor,
            backgroundReference: appearance.backgroundReference,
            backgroundUrl: appearance.backgroundUrl,
            backgroundFocus: appearance.backgroundFocus,
            backgroundFit: appearance.backgroundFit,
            backgroundMask: appearance.backgroundMask,
            backgroundBlur: appearance.backgroundBlur,
            backgroundBusy: appearance.backgroundBusy,
            backgroundError: appearance.backgroundError,
            readabilityWarnings: appearance.readabilityWarnings,
            onThemeModeChange: appearance.setThemeMode,
            colorPreset: appearance.colorPreset,
            onColorPresetChange: appearance.setColorPreset,
            onAccentColorChange: appearance.setAccentColor,
            onCanvasColorChange: appearance.setCanvasColor,
            onAssistantBubbleColorChange: appearance.setAssistantBubbleColor,
            onUnifiedTransparencyChange: appearance.setUnifiedTransparency,
            onSidebarTransparencyChange: appearance.setSidebarTransparency,
            onComposerTransparencyChange: appearance.setComposerTransparency,
            onAssistantBubbleTransparencyChange: appearance.setAssistantBubbleTransparency,
            onEditBackgroundFocus: appearance.editBackgroundFocus,
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
            isStreaming: chat.isAnyGenerating,
            streamPreview: chat.workspace.assistant?.defaultConfig.stream ?? true,
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
            onProviderMove: chat.moveProvider,
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
