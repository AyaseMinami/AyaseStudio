import { useEffect, useMemo, useRef, useState, type SetStateAction } from "react";
import { readConversationConfig } from "./conversationConfig";
import type { ContextSummary } from "./contextBudget";
import type { StoredChatMessage, WorkspaceRepository } from "./repository";
import type { ConfigErrors } from "./sessionConfig";
import type { DraftAttachment } from "./attachments";
import { SessionStore } from "./sessionStore";
import { selectedConversation, type WorkspaceCommand, type WorkspaceSnapshot } from "./workspace";

interface ConversationView {
  messages: StoredChatMessage[];
  draft: string;
  draftRevision: number;
  draftAttachments: DraftAttachment[];
  attachmentBusy: boolean;
  error?: string;
  contextPlan?: ContextSummary;
  configErrors: ConfigErrors;
}

function emptyView(): ConversationView {
  return { messages: [], draft: "", draftRevision: 0, draftAttachments: [], attachmentBusy: false, configErrors: {} };
}

export function useConversationWorkspace(repository: WorkspaceRepository, legacyModelId: string | null,
  validModelIds: string[], generatingId: { current: string | null }, cleanupAttachments?: () => Promise<void>) {
  const [snapshot, setSnapshot] = useState<WorkspaceSnapshot>();
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState<string>();
  const [operationError, setOperationError] = useState<string>();
  const [, render] = useState(0);
  const alive = useRef(false);
  const snapshotRef = useRef<WorkspaceSnapshot | undefined>(undefined);
  const stores = useRef(new Map<string, SessionStore>());
  const views = useRef(new Map<string, ConversationView>());
  const fallback = useRef(emptyView());
  const queue = useRef(Promise.resolve());
  const pending = useRef(0);
  const initial = useRef({ legacyModelId, validModelIds });
  const latestModelIds = useRef(validModelIds);
  latestModelIds.current = validModelIds;

  function changed() { if (alive.current) render((version) => version + 1); }

  async function loadView(id: string): Promise<void> {
    if (stores.current.has(id)) return;
    const store = new SessionStore(repository, id);
    const state = await store.hydrate();
    stores.current.set(id, store);
    views.current.set(id, { ...(views.current.get(id) ?? emptyView()), messages: state.messages });
  }

  async function publish(next: WorkspaceSnapshot): Promise<void> {
    // The database action has committed. Publish its identity even if reading
    // the new transcript fails; retry must load it, not repeat the mutation.
    snapshotRef.current = next;
    if (alive.current) setSnapshot(next);
    const selected = selectedConversation(next);
    if (selected) await loadView(selected.id);
    if (alive.current) setLoadError(undefined);
    changed();
  }

  function initialize(): void {
    if (pending.current) return;
    pending.current++;
    setBusy(true);
    setLoadError(undefined);
    queue.current = queue.current.catch(() => undefined).then(async () => {
      try {
        const next = await repository.initializeWorkspace(initial.current.legacyModelId, latestModelIds.current);
        await publish(next);
        try { await cleanupAttachments?.(); }
        catch { if (alive.current) setOperationError("附件副本整理失败；重试加载时可再次整理，现有消息未受影响。"); }
      } catch {
        if (alive.current) setLoadError("无法读取本地工作区。请重试；现有记录未被清空。");
      } finally {
        pending.current--;
        if (alive.current) setBusy(false);
      }
    });
  }

  useEffect(() => {
    alive.current = true;
    initialize();
    return () => { alive.current = false; };
  }, []);

  async function execute(command: WorkspaceCommand): Promise<boolean> {
    if (!snapshotRef.current) return false;
    const action = structuredClone(command);
    pending.current++;
    setBusy(true);
    setOperationError(undefined);
    let success = false;
    const next = queue.current.catch(() => undefined).then(async () => {
      try {
        const current = snapshotRef.current!;
        const running = generatingId.current;
        const messageAction = action.type === "edit-message" || action.type === "delete-message" || action.type === "fork-conversation";
        if (running && (
          (messageAction && action.conversationId === running) ||
          (action.type === "delete-conversation" && action.id === running) ||
          (action.type === "delete-assistant" && current.conversations.some((item) => item.id === running && item.assistantId === action.id))
        )) throw new Error("请先停止该对话的生成并等待保存完成，再执行此操作。");
        const affected = action.type === "delete-assistant"
          ? current.conversations.filter((item) => item.assistantId === action.id).map((item) => item.id)
          : action.type === "delete-conversation" ? [action.id] : messageAction ? [action.conversationId] : [];
        await Promise.all(affected.map((id) => stores.current.get(id)?.flush()));
        const updated = await repository.execute(action);
        success = true;
        snapshotRef.current = updated;
        if (alive.current) setSnapshot(updated);
        const remaining = new Set(updated.conversations.map((item) => item.id));
        for (const id of stores.current.keys()) {
          if (!remaining.has(id)) { stores.current.delete(id); views.current.delete(id); }
        }
        if (action.type === "edit-message" || action.type === "delete-message") {
          const id = action.conversationId;
          const view = views.current.get(id);
          // If reloading fails, the old writable store must not resurrect the
          // transcript that the transaction has already edited or deleted.
          stores.current.delete(id);
          if (view) views.current.set(id, { ...view, contextPlan: undefined, error: undefined });
          await loadView(id);
        }
        await publish(updated);
        if (action.type === "delete-message" ||
          (affected.length && affected.some((affectedId) => !remaining.has(affectedId)))) {
          try { await cleanupAttachments?.(); }
          catch { if (alive.current) setOperationError("操作已保存，但附件副本整理失败；下次启动可重试。"); }
        }
      } catch (error) {
        if (alive.current) {
          if (success) setLoadError("操作已保存，但读取所选对话失败。请重试加载，无需重复操作。");
          else setOperationError(error instanceof Error ? error.message : "本地操作失败，请重试。");
        }
      } finally {
        pending.current--;
        if (alive.current) setBusy(pending.current > 0);
      }
    });
    queue.current = next;
    await next;
    return success;
  }

  const modelKey = JSON.stringify([...validModelIds].sort());
  useEffect(() => {
    if (!snapshot) return;
    const valid = new Set(validModelIds);
    if (snapshot.assistants.some((item) => item.defaultModelId && !valid.has(item.defaultModelId))) {
      void execute({ type: "repair-models", validModelIds });
    }
  }, [modelKey, snapshot]);

  const conversation = snapshot && selectedConversation(snapshot);
  const assistant = snapshot?.assistants.find((item) => item.id === snapshot.selection.activeAssistantId);
  const effective = useMemo(() => readConversationConfig(conversation?.settings), [conversation?.settings]);
  const id = conversation?.id;
  const view = (id && views.current.get(id)) || fallback.current;
  function setField<K extends keyof ConversationView>(field: K, value: SetStateAction<ConversationView[K]>): void {
    if (!id) return;
    const current = views.current.get(id);
    if (!current) return;
    const next = typeof value === "function" ? (value as (old: ConversationView[K]) => ConversationView[K])(current[field]) : value;
    views.current.set(id, { ...current, [field]: next });
    changed();
  }

  return {
    snapshot, conversation, assistant, effective, view, busy, loadError, operationError, execute, retry: initialize,
    isReady: !!snapshot && !busy && !!id && stores.current.has(id),
    canSend: () => pending.current === 0 && !!id && stores.current.has(id) && snapshotRef.current === snapshot && !!snapshot && selectedConversation(snapshot)?.id === id,
    store: id ? stores.current.get(id) : undefined,
    setMessages: (value: SetStateAction<StoredChatMessage[]>) => setField("messages", value),
    setDraft: (value: string) => {
      if (!id) return;
      const current = views.current.get(id);
      if (!current) return;
      views.current.set(id, { ...current, draft: value, draftRevision: current.draftRevision + 1 });
      changed();
    },
    clearDraftIfUnchanged: (revision: number) => {
      if (!id || views.current.get(id)?.draftRevision !== revision) return;
      setField("draft", "");
    },
    setDraftAttachments: (value: SetStateAction<DraftAttachment[]>) => setField("draftAttachments", value),
    setAttachmentBusy: (value: boolean) => setField("attachmentBusy", value),
    setError: (value: SetStateAction<string | undefined>) => setField("error", value),
    setContextPlan: (value: ContextSummary | undefined) => setField("contextPlan", value),
    setConfigErrors: (value: ConfigErrors) => setField("configErrors", value),
  };
}
