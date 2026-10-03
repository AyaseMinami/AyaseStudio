import "./App.css";

import { useEffect, useRef, useState } from "react";
import { useUserAvatar } from "./avatar/useUserAvatar";

import { useAppearance } from "./appearance/useAppearance";
import { BackgroundFocusDialog } from "./ui/settings/BackgroundFocusDialog";
import { BackgroundImage } from "./ui/settings/BackgroundImage";
import { useChatSession } from "./chat/useChatSession";
import { getThinkingSettings } from "./chat/thinking";
import { AppShell, type AppPage } from "./ui/AppShell";
import { ChatWorkspace } from "./ui/chat/ChatWorkspace";
import { DrawingWorkspace } from "./ui/drawing/DrawingWorkspace";
import { useDrawingWorkspace } from "./drawing/useDrawingWorkspace";
import { useConfirmation } from "./ui/useConfirmation";
import type { GeneralSettingsState } from "./general/preferences";
import type { RegisterExitGuard } from "./general/lifecycle";
import { openDrawingOutputDirectory } from "./drawing/runtime";
import { getDrawingModels } from "./chat/settings";
import { ChatHeader } from "./ui/chat/ChatHeader";
import { ConversationNavigation } from "./ui/chat/ConversationNavigation";
import { useConversationNavigation } from "./ui/chat/useConversationNavigation";
import { useChatLayout } from "./ui/chat/useChatLayout";
import {
  SettingsWorkspace,
  type SettingsSection,
} from "./ui/settings/SettingsWorkspace";

function App({ general, registerExitGuard, settingsRequest = 0 }: {
  general?: GeneralSettingsState; registerExitGuard?: RegisterExitGuard; settingsRequest?: number;
}) {
  const [activePage, setActivePage] = useState<AppPage>(window.location.hash === "#data" ? "settings" : "chat");
  const [activeSettingsSection, setActiveSettingsSection] =
    useState<SettingsSection>(window.location.hash === "#data" ? "data" : "general");
  const appearance = useAppearance();
  const avatar = useUserAvatar();
  const chatLayout = useChatLayout();
  const navigation = useConversationNavigation();
  const drawingCloseConfirmation = useConfirmation();
  const drawing = useDrawingWorkspace(activePage === "drawing", drawingCloseConfirmation.confirm, registerExitGuard);
  const [backupError, setBackupError] = useState<string>();
  const chat = useChatSession({
    externalBusy: drawing.busy || drawing.submitting || drawing.tasks.some(task => task.status === "queued") || drawing.closing,
    externalMaintenanceBusy: () => drawing.controller.getSnapshot().busy,
    onConfigurationRequired: () => {
      setActiveSettingsSection("connections");
      setActivePage("settings");
    },
  });
  useEffect(() => { drawing.controller.updateSettings(chat.connectionSettings); }, [drawing.controller, chat.connectionSettings]);
  const handledSettingsRequest = useRef(0);
  useEffect(() => {
    if (settingsRequest <= handledSettingsRequest.current || chat.backupPreparing || drawing.closing) return;
    handledSettingsRequest.current = settingsRequest;
    setActiveSettingsSection("general");
    setActivePage("settings");
  }, [settingsRequest, chat.backupPreparing, drawing.closing]);
  const modelLabel = chat.activeProvider && chat.activeConnection && chat.activeModel
    ? `${chat.activeProvider.name} · ${chat.activeConnection.name} · ${chat.activeModel.displayName || chat.activeModel.modelId}`
    : `${chat.workspace.effective.modelId ? "模型已失效" : "未选择模型"} · 点击选择模型`;

  return (
    <AppShell activePage={activePage} onPageChange={setActivePage} interactionDisabled={chat.backupPreparing || drawing.closing}
      background={<div className="appearance-background-art"><BackgroundImage url={appearance.backgroundUrl} focus={appearance.backgroundFocus} fit={appearance.backgroundFit} blur={appearance.backgroundBlur} /></div>}>
      {drawingCloseConfirmation.dialog}
      {appearance.backgroundDraft && <BackgroundFocusDialog
        url={appearance.backgroundDraft.url} focus={appearance.backgroundDraft.focus} fit={appearance.backgroundFit} blur={appearance.backgroundBlur}
        error={appearance.backgroundError}
        onConfirm={(focus) => void appearance.confirmBackgroundFocus(focus)}
        onCancel={() => void appearance.cancelBackgroundFocus()} />}
      {activePage === "chat" ? (
        <ConversationNavigation workspace={chat.workspace} settings={chat.connectionSettings} generatingIds={chat.generatingConversationIds} navigation={navigation}
          toolbar={<ChatHeader conversationId={chat.workspace.conversation?.id} title={chat.workspace.conversation?.title ?? "新对话"}
            layout={chatLayout.layout} onToggleLayout={chatLayout.toggleLayout} isHydrated={chat.isHydrated}
            isGenerating={chat.isGenerating}
            isWorkspaceBusy={chat.workspace.isTemporarilyBusy}
            onClear={chat.clearConversation} />}>
        <ChatWorkspace hideHeader
          onDraftActivate={navigation.activateDraft}
          userAvatarUrl={avatar.url}
          assistant={chat.workspace.assistant}
          layout={chatLayout.layout}
          onToggleLayout={chatLayout.toggleLayout}
          key={chat.workspace.conversation?.id ?? "loading"}
          title={chat.workspace.conversation?.title ?? "新对话"}
          draft={chat.draft}
          draftSelection={chat.workspace.view.draftSelection}
          onDraftSelectionChange={chat.workspace.setDraftSelection}
          onBrowseHistory={chat.workspace.browseHistory}
          draftAttachments={chat.draftAttachments}
          attachmentBusy={chat.attachmentBusy}
          contextPlan={chat.contextPlan}
          error={chat.error}
          isHydrated={chat.isHydrated}
          isWorkspaceBusy={chat.workspace.isTemporarilyBusy}
          isGenerating={chat.isGenerating}
          messages={chat.messages}
          messageActions={{ edit: chat.editMessage, editAndSend: chat.editAndSendMessage, delete: chat.deleteMessage, retry: chat.retryMessage, branch: chat.branchMessage, continue: chat.continueMessage, selectVersion: chat.selectRoundVersion }}
          messageActionsDisabled={!chat.isHydrated || chat.isGenerating}
          messageActionError={chat.workspace.operationError}
          modelId={chat.activeModel?.modelId}
          thinking={getThinkingSettings(chat.sessionConfig, chat.activeConnection?.protocol ?? "gemini-native")}
          onThinkingChange={(value) => void chat.setThinking(value)}
          searchMode={chat.searchMode}
          onSearchModeChange={(mode) => void chat.setSearchMode(mode)}
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
      ) : activePage === "drawing" ? (
        <DrawingWorkspace draft={drawing.draft} references={drawing.references} preparation={drawing.preparation} onDraftChange={drawing.controller.setDraft}
          models={getDrawingModels(chat.connectionSettings)} tasks={drawing.tasks} results={drawing.results}
          selectedResultId={drawing.selectedResultId} previewUrl={drawing.previewUrl} previewError={drawing.previewError}
          ready={drawing.ready && !chat.maintenanceBusy} busy={drawing.busy} error={drawing.error}
          submitting={drawing.submitting} paused={drawing.paused} onPause={drawing.controller.pause} onResume={drawing.controller.resume}
          onGenerate={() => { if (!chat.maintenanceBusy) void drawing.controller.generate(chat.connectionSettings); }}
          onCancel={drawing.controller.cancel} onCancelPreparation={drawing.controller.cancelPreparation} onSelectResult={drawing.controller.selectResult}
          managementBusy={drawing.managementBusy} onCancelBatch={drawing.controller.cancelBatch}
          onRegenerate={id => void drawing.controller.regenerate(id)} onDeleteTasks={ids => void drawing.controller.deleteTasks(ids)}
          onExport={id => void drawing.controller.export(id)} onRetrySave={id => void drawing.controller.retrySave(id)}
          onOpenOutputDirectory={openDrawingOutputDirectory}
          onReuse={id => void drawing.controller.reuse(id)}
          onReuseTask={id => void drawing.controller.reuseTask(id)}
          onCopyTaskPrompt={id => void drawing.controller.copyTaskPrompt(id)}
          presets={drawing.presets} presetsBusy={drawing.presetsBusy}
          onApplyPreset={drawing.controller.applyPreset} onCreatePreset={drawing.controller.createPreset}
          onUpdatePreset={drawing.controller.updatePreset} onDeletePreset={drawing.controller.deletePreset}
          onClearReferences={() => void drawing.controller.clearReferences()}
          readThumbnail={drawing.controller.readThumbnail} onPreviewActive={drawing.setPreviewActive}
          onDeleteResults={ids => void drawing.controller.deleteResults(ids)}
          onExportResults={(ids, withParameters) => void drawing.controller.exportResults(ids, withParameters)}
          onCopyPrompt={id => void drawing.controller.copyPrompt(id)} notice={drawing.notice} closing={drawing.closing}
          referencesBusy={drawing.referencesBusy} onAddReferences={files => void drawing.controller.addReferences(files)}
          onRemoveReference={id => void drawing.controller.removeReference(id)}
          onMoveReference={(id, direction) => void drawing.controller.moveReference(id, direction)}
          onUseAsReference={id => void drawing.controller.useAsReference(id)} readReference={drawing.controller.readReference}
          onConfigure={() => { setActiveSettingsSection("connections"); setActivePage("settings"); }} />
      ) : (
        <SettingsWorkspace
          general={general}
          dataImport={chat.dataImport}
          backupDisabled={chat.backupDisabled || appearance.backgroundBusy || avatar.busy || !drawing.ready || drawing.closing}
          backupError={backupError ?? chat.backupPreparationError}
          onBackup={() => {
            setBackupError(undefined);
            const drawingPrepared = drawing.controller.prepareMaintenance();
            const chatPrepared = chat.prepareBackup();
            void Promise.allSettled([drawingPrepared, chatPrepared]).then(([drawResult, chatResult]) => {
              if (drawResult.status === "fulfilled" && chatResult.status === "fulfilled" && chatResult.value) {
                window.location.hash = "backup"; window.location.reload();
              } else {
                drawing.controller.cancelMaintenance(); chat.cancelBackupPreparation();
                if (drawResult.status === "rejected") setBackupError(drawResult.reason instanceof Error ? drawResult.reason.message : "绘图维护准备失败，请重试。");
              }
            });
          }}
          avatar={avatar}
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
            chromeTransparency: appearance.chromeTransparency,
            sidebarTransparency: appearance.sidebarTransparency,
            composerTransparency: appearance.composerTransparency,
            sidebarGlassEnabled: appearance.sidebarGlassEnabled,
            composerGlassEnabled: appearance.composerGlassEnabled,
            assistantBubbleTransparency: appearance.assistantBubbleTransparency,
            effectiveAccentColor: appearance.effectiveAccentColor,
            effectiveCanvasColor: appearance.effectiveCanvasColor,
            backgroundReference: appearance.backgroundReference,
            backgroundLibrary: appearance.backgroundLibrary,
            backgroundEnabled: appearance.backgroundEnabled,
            backgroundName: appearance.backgroundName,
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
            onChromeTransparencyChange: appearance.setChromeTransparency,
            onSidebarTransparencyChange: appearance.setSidebarTransparency,
            onComposerTransparencyChange: appearance.setComposerTransparency,
            onSidebarGlassEnabledChange: appearance.setSidebarGlassEnabled,
            onComposerGlassEnabledChange: appearance.setComposerGlassEnabled,
            onAssistantBubbleTransparencyChange: appearance.setAssistantBubbleTransparency,
            onEditBackgroundFocus: appearance.editBackgroundFocus,
            onBackgroundFitChange: appearance.setBackgroundFit,
            onBackgroundMaskChange: appearance.setBackgroundMask,
            onBackgroundBlurChange: appearance.setBackgroundBlur,
            onPrepareLibraryBackground: appearance.prepareLibraryBackground,
            onSaveLibraryBackground: appearance.saveLibraryBackground,
            onDiscardLibraryBackground: appearance.discardLibraryBackground,
            onResolveLibraryBackground: appearance.resolveLibraryBackground,
            onApplyLibraryBackground: appearance.applyLibraryBackground,
            onRemoveLibraryBackgrounds: appearance.removeLibraryBackgrounds,
            onRestoreBackground: appearance.restoreBackground,
            onRemoveBackground: appearance.removeBackground,
            onResetCustomAppearance: appearance.resetCustomAppearance,
          }}
          connection={{
            canSelectModel: !!chat.workspace.assistant && !chat.workspace.busy,
            connectionSettings: chat.connectionSettings,
            isStreaming: chat.isAnyGenerating || drawing.busy || drawing.submitting || drawing.tasks.some(task => task.status === "queued"),
            streamPreview: chat.workspace.assistant?.defaultConfig.stream ?? true,
            modelCatalogs: chat.modelCatalogs,
            modelTests: chat.modelTests,
            onAddConnection: chat.addConnection,
            onAddModel: chat.addModel,
            onAddProvider: chat.addProvider,
            onProviderAvatarChange: chat.changeProviderAvatar,
            onResetConnection: chat.resetPresetConnection,
            onCancelModelCatalogRefresh: chat.cancelModelCatalogRefresh,
            onCancelModelTest: chat.cancelModelTest,
            onConnectionChange: chat.updateConnection,
            onConnectionMove: chat.moveConnection,
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
