import { describe, expect, it } from "vitest";
import { browseInputHistory, consumeInputDraft, type InputDraft } from "./inputHistory";
import type { StoredChatMessage } from "./repository";

const messages: StoredChatMessage[] = [
  { id: "u1", role: "user", content: "older", status: "complete" },
  { id: "a1", role: "assistant", content: "reply", status: "failed" },
  { id: "u2", role: "user", content: "newer\nsecond line", status: "complete" },
  { id: "attachment", role: "user", content: "", status: "complete" },
  { id: "pending", role: "user", content: "uncommitted", status: "incomplete" },
];
const draft = (): InputDraft => ({ draft: "unsent  \n", draftRevision: 0, draftSelection: { start: 3, end: 3 } });
function move(current: InputDraft, direction: -1 | 1, list = messages) {
  return browseInputHistory(current, list, direction, current.draftSelection)!;
}

describe("input history", () => {
  it("browses visible user text in transcript order and restores exact draft and selection", () => {
    const original = draft();
    let state = move(original, -1);
    expect(state.draft).toBe("newer\nsecond line");
    expect(state.draftSelection).toEqual({ start: 0, end: 0 });
    state = move(state, -1);
    expect(state.draft).toBe("older");
    expect(move(state, -1)).toBe(state);
    state = move(state, 1);
    expect(state.draftSelection).toEqual({ start: 17, end: 17 });
    state = move(state, 1);
    expect(state.draft).toBe(original.draft);
    expect(state.draftSelection).toEqual(original.draftSelection);
    expect(browseInputHistory(state, messages, 1, state.draftSelection)).toBeUndefined();
  });

  it("keeps each edited history candidate and subsequent original edits without changing records", () => {
    let state = move(draft(), -1);
    state = { ...state, draft: "newer edited", draftRevision: 2 };
    state = move(state, -1);
    state = { ...state, draft: "older edited", draftRevision: 4 };
    expect(move(state, 1).draft).toBe("newer edited");
    state = move(move(state, 1), 1);
    state = { ...state, draft: "original edited", draftRevision: 7 };
    expect(move(move(state, -1), 1).draft).toBe("original edited");
    expect(messages[0].content).toBe("older");
    expect(messages[2].content).toBe("newer\nsecond line");
  });

  it("does not intercept empty history or Down outside browsing", () => {
    expect(browseInputHistory(draft(), [], -1, draft().draftSelection)).toBeUndefined();
    expect(browseInputHistory(draft(), messages, 1, draft().draftSelection)).toBeUndefined();
  });

  it("recovers the original after clear/deletion and does not use a changed version as the old candidate", () => {
    const state = move(draft(), -1);
    expect(move(state, 1, []).draft).toBe(draft().draft);
    const changed = messages.map(item => item.id === "u2" ? { ...item, content: "other version" } : item);
    expect(move(state, -1, changed).draft).toBe("other version");
    expect(move(state, 1, changed).draft).toBe(draft().draft);
  });

  it("restores the original only when the sent revision still owns the input", () => {
    const state = move(draft(), -1);
    const consumed = consumeInputDraft(state, state.draftRevision);
    expect(consumed.draft).toBe(draft().draft);
    expect(consumed.inputHistory).toBeUndefined();
    expect(consumeInputDraft({ ...state, draft: "typed while preparing", draftRevision: 10 }, state.draftRevision).draft)
      .toBe("typed while preparing");
    expect(consumeInputDraft(draft(), 0).draft).toBe("");
  });

  it("retains edited copies as unsent drafts after source deletion, clear or version changes", () => {
    let state = { ...move(draft(), -1), draft: "edited newer" };
    state = move(state, -1);
    state = { ...state, draft: "edited older" };
    state = move(state, 1, []);
    expect(state.draft).toBe(draft().draft);
    state = move(state, -1, []);
    expect(state.draft).toBe("edited older");
    state = move(state, -1, []);
    expect(state.draft).toBe("edited newer");
    expect(move(state, 1, []).draft).toBe("edited older");
    const changed = messages.map(item => item.id === "u2" ? { ...item, content: "new version" } : item);
    expect(move(state, 1, changed).draft).toBe(draft().draft);
    state = move(state, -1, changed);
    expect(state.draft).toBe("new version");
    expect(move(state, -1, changed).draft).toBe("edited older");
  });
});
