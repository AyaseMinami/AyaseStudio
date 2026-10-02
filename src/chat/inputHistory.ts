import type { StoredChatMessage } from "./repository";

export interface DraftSelection { start: number; end: number }
interface SavedInput { text: string; selection: DraftSelection }
interface HistoryInput extends SavedInput { id: string; source: string }
export interface InputHistory {
  original: SavedInput;
  active?: { id: string; source: string };
  edits: HistoryInput[];
}
export interface InputDraft {
  draft: string;
  draftRevision: number;
  draftSelection: DraftSelection;
  inputHistory?: InputHistory;
}

export function browseInputHistory(current: InputDraft, messages: StoredChatMessage[], direction: -1 | 1,
  selection: DraftSelection): InputDraft | undefined {
  // Transcript order is authoritative; hidden round versions and assistant replies are not candidates.
  const visible = messages.filter(message => message.role === "user" && message.status === "complete" && message.content.trim())
    .map(message => ({ id: message.id, source: message.content }));
  const previous = current.inputHistory;
  if (!previous?.active && direction === 1) return undefined;
  const saved = { text: current.draft, selection: { ...selection } };
  const history: InputHistory = previous
    ? { ...previous, edits: [...previous.edits] }
    : { original: saved, edits: [] };
  if (history.active) {
    const active = history.active;
    // Keep an edited candidate separate from the unsent original. Never write it to the transcript.
    const editIndex = history.edits.findIndex(edit => edit.id === active.id && edit.source === active.source);
    if (saved.text === active.source) history.edits = history.edits.filter((_, index) => index !== editIndex);
    else if (editIndex < 0) history.edits.push({ ...active, ...saved });
    else history.edits[editIndex] = { ...active, ...saved };
  } else history.original = saved;
  // Edited copies are unsent drafts. Even if their source is deleted or changes version,
  // retain them after the visible history so browsing cannot silently destroy user input.
  const candidates = [...visible, ...history.edits.filter(edit =>
    !visible.some(item => item.id === edit.id && item.source === edit.source))];
  if (!history.active && !candidates.length) return undefined;
  const index = history.active
    ? candidates.findIndex(item => item.id === history.active!.id && item.source === history.active!.source)
    : candidates.length;
  // A deleted/changed candidate remains editable in the input. Down recovers the original;
  // Up starts again from the newest still-visible candidate instead of reusing a stale index.
  const target = index < 0 ? (direction === 1 ? candidates.length : candidates.length - 1) : index + direction;
  if (target < 0) return current;
  if (target >= candidates.length) {
    return { ...current, draft: history.original.text, draftSelection: { ...history.original.selection },
      draftRevision: current.draftRevision + 1, inputHistory: { ...history, active: undefined } };
  }
  const candidate = candidates[target];
  const text = history.edits.find(edit => edit.id === candidate.id && edit.source === candidate.source)?.text ?? candidate.source;
  const caret = direction === -1 ? 0 : text.length;
  return { ...current, draft: text, draftSelection: { start: caret, end: caret }, draftRevision: current.draftRevision + 1,
    inputHistory: { ...history, active: { id: candidate.id, source: candidate.source } } };
}

export function consumeInputDraft(current: InputDraft, revision: number): InputDraft {
  if (current.draftRevision !== revision) return current;
  const original = current.inputHistory?.active ? current.inputHistory.original : undefined;
  return { ...current, draft: original?.text ?? "", draftSelection: original ? { ...original.selection } : { start: 0, end: 0 },
    draftRevision: current.draftRevision + 1, inputHistory: undefined };
}
