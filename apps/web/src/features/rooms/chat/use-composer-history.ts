import { useState } from "react";

import {
  appendRoomComposerHistory,
  readRoomComposerHistory,
  type RoomComposerHistoryEntry,
  type RoomDraftScope,
} from "../room-drafts";
import type { ComposerDraft } from "./use-composer-draft";

export interface ComposerHistoryInput {
  draft: ComposerDraft;
  /** Without a scope the composer keeps no history. */
  scope?: RoomDraftScope;
}

interface HistoryBrowsing {
  entries: RoomComposerHistoryEntry[];
  index: number;
  /** The unsent draft that stepping past the newest entry brings back. */
  saved: RoomComposerHistoryEntry;
}

/**
 * Steps through the messages sent in one Room or Thread, as a shell steps
 * through earlier commands. Editing a recalled message makes it an ordinary
 * draft: browsing holds only while the body is the entry it showed.
 */
export function useComposerHistory({ draft, scope }: ComposerHistoryInput) {
  const [browsing, setBrowsing] = useState<HistoryBrowsing | null>(null);
  const active =
    browsing && browsing.entries[browsing.index]?.body === draft.body
      ? browsing
      : null;

  function show(entry: RoomComposerHistoryEntry) {
    draft.selectedMentionsRef.current = entry.mentions;
    draft.selectedDocumentsRef.current = entry.documentReferences;
    draft.selectedSkillsRef.current = entry.skillReferences;
    draft.pendingCaretRef.current = entry.body.length;
    draft.updateBody(entry.body);
  }

  /**
   * Moves to an older (-1) or newer (1) message when the caret sits on the
   * first or last line; returns whether it did, so the key keeps its default
   * caret movement otherwise.
   */
  function step(direction: -1 | 1, textarea: HTMLTextAreaElement) {
    if (!scope) return false;
    const { selectionEnd, selectionStart, value } = textarea;
    if (selectionStart !== selectionEnd) return false;
    const offLine =
      direction < 0
        ? value.slice(0, selectionStart).includes("\n")
        : value.slice(selectionEnd).includes("\n");
    if (offLine) return false;

    if (direction < 0) {
      const entries = active?.entries ?? readRoomComposerHistory(scope);
      const index = (active?.index ?? entries.length) - 1;
      if (index < 0) return false;
      setBrowsing({
        entries,
        index,
        saved: active?.saved ?? {
          body: draft.body,
          documentReferences: draft.selectedDocumentsRef.current,
          mentions: draft.selectedMentionsRef.current,
          skillReferences: draft.selectedSkillsRef.current,
        },
      });
      show(entries[index]!);
      return true;
    }

    if (!active) return false;
    const index = active.index + 1;
    if (index >= active.entries.length) {
      setBrowsing(null);
      show(active.saved);
      return true;
    }
    setBrowsing({ ...active, index });
    show(active.entries[index]!);
    return true;
  }

  function record(entry: RoomComposerHistoryEntry) {
    setBrowsing(null);
    if (scope) appendRoomComposerHistory(scope, entry);
  }

  return {
    position: active
      ? { index: active.index + 1, total: active.entries.length }
      : null,
    record,
    step,
  };
}

export type ComposerHistory = ReturnType<typeof useComposerHistory>;
