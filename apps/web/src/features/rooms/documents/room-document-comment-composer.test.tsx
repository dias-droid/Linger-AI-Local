import { BlockNoteEditor } from "@blocknote/core";
import { FormattingToolbarExtension } from "@blocknote/core/extensions";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TextSelection } from "@tiptap/pm/state";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { MessageComposer } from "../chat/message-composer";
import {
  commentBodyFromComposition,
  commentCompositionFromBody,
} from "./room-document-comment-body";
import { RoomDocumentCommentComposer } from "./room-document-comment-composer";
import { roomDocumentCommentSchema } from "./room-document-comment-schema";

const composerMocks = vi.hoisted(() => ({
  createThread: vi.fn(async () => undefined),
  editor: null as BlockNoteEditor | null,
  stopPendingComment: vi.fn(),
}));

vi.mock("@blocknote/react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@blocknote/react")>();
  return {
    ...actual,
    useBlockNoteEditor: () => composerMocks.editor,
    useExtension: () => ({
      createThread: composerMocks.createThread,
      stopPendingComment: composerMocks.stopPendingComment,
    }),
  };
});

const bob = {
  display_name: "Bob Smith",
  id: "actor_bob",
  kind: "human" as const,
  tenant_id: "tenant_1",
};

describe("Room Document Comment composer", () => {
  it("round-trips a structured mention through the editable composition", () => {
    const body = commentBodyFromComposition({
      body: "Ask @Bob Smith today",
      files: [],
      mentions: [bob],
    });

    expect(commentCompositionFromBody(body, [bob])).toEqual({
      body: "Ask @Bob Smith today",
      files: [],
      mentions: [bob],
    });
  });

  it("submits an existing mention identity when editing without changing it", () => {
    const onSend = vi.fn();
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MessageComposer
          ariaLabel="Edit comment"
          initialMentions={[bob]}
          initialValue="Ask @Bob Smith today"
          mentionOptions={[bob]}
          onSend={onSend}
        />
      </QueryClientProvider>,
    );

    fireEvent.keyDown(screen.getByLabelText("Edit comment"), { key: "Enter" });

    expect(onSend).toHaveBeenCalledWith({
      body: "Ask @Bob Smith today",
      files: [],
      mentions: [bob],
    });
  });

  it("preserves a historical mention label as plain text after the Actor leaves the Room", () => {
    const body = commentBodyFromComposition({
      body: "Ask @Bob Smith today",
      files: [],
      mentions: [bob],
    });

    expect(commentCompositionFromBody(body, [])).toEqual({
      body: "Ask @Bob Smith today",
      files: [],
      mentions: [],
    });
  });

  it("collapses the document selection and dismisses the formatting toolbar on submit", async () => {
    const editor = BlockNoteEditor.create({
      initialContent: [{ content: "Selected comment text", type: "paragraph" }],
      schema: roomDocumentCommentSchema,
    });
    const host = document.createElement("div");
    document.body.append(host);
    editor.mount(host);
    try {
      editor.transact((tr) =>
        tr.setSelection(TextSelection.create(tr.doc, 2, 10)),
      );
      const toolbar = editor.getExtension(FormattingToolbarExtension)!;
      toolbar.store.setState(true);
      expect(editor.prosemirrorState.selection.empty).toBe(false);
      expect(toolbar.store.state).toBe(true);

      composerMocks.editor = editor as unknown as BlockNoteEditor;
      composerMocks.createThread.mockClear();
      composerMocks.stopPendingComment.mockClear();

      render(
        <QueryClientProvider client={new QueryClient()}>
          <RoomDocumentCommentComposer mentionOptions={[bob]} />
        </QueryClientProvider>,
      );

      const input = screen.getByLabelText("New Document comment");
      fireEvent.change(input, { target: { value: "Looks good" } });
      fireEvent.keyDown(input, { key: "Enter" });

      await waitFor(() =>
        expect(composerMocks.createThread).toHaveBeenCalledOnce(),
      );
      await waitFor(() =>
        expect(composerMocks.stopPendingComment).toHaveBeenCalledOnce(),
      );
      expect(editor.prosemirrorState.selection.empty).toBe(true);
      expect(toolbar.store.state).toBe(false);
    } finally {
      editor._tiptapEditor.destroy();
      host.remove();
      composerMocks.editor = null;
    }
  });
});
