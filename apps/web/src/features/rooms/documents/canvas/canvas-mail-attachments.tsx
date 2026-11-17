import {
  Attachment01Icon,
  Cancel01Icon,
  File01Icon,
} from "@hugeicons/core-free-icons";
import { parseRoomDocumentAssetReference } from "@linger/document-model";
import {
  queryOptions,
  useQueries,
  useQueryClient,
} from "@tanstack/react-query";
import { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { AutoHeight } from "@/components/ui/auto-height";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { teamHubData } from "@/features/teamhub/teamhub-api";
import type { TeamHubClient } from "@/features/teamhub/teamhub-client";
import { formatBytes } from "@/lib/format-bytes";
import { uploadRoomDocumentAsset } from "../room-document-assets";
import type { RoomDocumentEditor } from "../room-document-comment-schema";

const maxAttachmentBytes = 15 << 20;

function fileBlocks(blocks: RoomDocumentEditor["document"]) {
  const files: { id: string; name: string; url: string }[] = [];
  for (const block of blocks) {
    if (block.type === "file" && block.props.url) {
      files.push({
        id: block.id,
        name: block.props.name,
        url: block.props.url,
      });
    }
    files.push(...fileBlocks(block.children));
  }
  return files;
}

function assetQuery(client: TeamHubClient, reference: string) {
  return queryOptions({
    queryKey: ["document-asset", reference],
    staleTime: Infinity,
    queryFn: () => {
      const documentAssetId = parseRoomDocumentAssetReference(reference);
      if (!documentAssetId) throw new Error("Attachment reference is invalid.");
      return teamHubData(
        client.api.GET("/v0/document-assets/{documentAssetId}", {
          params: { path: { documentAssetId } },
        }),
      );
    },
  });
}

export function CanvasMailAttachments({
  client,
  documentId,
  editable,
  editor,
  portalTarget,
  scope,
}: {
  client: TeamHubClient;
  documentId: string;
  editable: boolean;
  editor: RoomDocumentEditor;
  portalTarget?: HTMLElement | null;
  scope: string;
}) {
  const queryClient = useQueryClient();
  const [attachments, setAttachments] = useState(() =>
    fileBlocks(editor.document),
  );
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string>();
  const input = useRef<HTMLInputElement>(null);
  const busy = useRef(false);
  const canEdit = useRef(editable);
  const active = useRef(true);
  useLayoutEffect(() => {
    canEdit.current = editable;
  }, [editable]);
  useLayoutEffect(() => {
    active.current = true;
    const refresh = () => setAttachments(fileBlocks(editor.document));
    refresh();
    const unsubscribe = editor.onChange(refresh);
    return () => {
      active.current = false;
      unsubscribe();
    };
  }, [editor]);
  const metadata = useQueries({
    queries: attachments.map((file) => assetQuery(client, file.url)),
  });

  async function add(files: File[]) {
    if (!canEdit.current || busy.current || files.length === 0) return;
    busy.current = true;
    setUploading(true);
    setError(undefined);
    try {
      if (files.some((file) => file.size === 0))
        throw new Error("Empty files cannot be attached.");
      const existing = await Promise.all(
        fileBlocks(editor.document).map((file) =>
          queryClient.ensureQueryData(assetQuery(client, file.url)),
        ),
      );
      const total =
        existing.reduce((sum, asset) => sum + asset.size_bytes, 0) +
        files.reduce((sum, file) => sum + file.size, 0);
      if (total > maxAttachmentBytes)
        throw new Error("Attachments must total 15 MB or less.");
      // Insert only durable assets; a failed upload must not leave a file placeholder.
      for (const file of files) {
        if (!active.current || !canEdit.current) return;
        const url = await uploadRoomDocumentAsset(client, documentId, file);
        if (!active.current || !canEdit.current) return;
        const last = editor.document.at(-1);
        if (!last)
          throw new Error("The email is no longer available for editing.");
        editor.insertBlocks(
          [{ type: "file", props: { name: file.name, url } }],
          last.id,
          "after",
        );
      }
    } catch (failure) {
      if (active.current)
        setError(
          failure instanceof Error
            ? failure.message
            : "Could not attach the file. Try again.",
        );
    } finally {
      busy.current = false;
      if (active.current) setUploading(false);
    }
  }

  async function download(file: { url: string; name: string }) {
    setError(undefined);
    try {
      if (!editor.resolveFileUrl)
        throw new Error("The attachment is not available for download.");
      const url = await editor.resolveFileUrl(file.url);
      if (!active.current) return;
      const link = document.createElement("a");
      link.href = url;
      link.download = file.name || "attachment";
      link.click();
    } catch (failure) {
      if (active.current)
        setError(
          failure instanceof Error
            ? failure.message
            : "Could not download the attachment.",
        );
    }
  }

  return (
    <>
      {attachments.length > 0 ? (
        <style>
          {attachments
            .map(
              (file) =>
                `[data-knowledge-scope=${JSON.stringify(scope)}] .bn-block[data-id=${JSON.stringify(file.id)}] > .bn-block-content { display: none; }`,
            )
            .join("\n")}
        </style>
      ) : null}
      {editable && portalTarget
        ? createPortal(
            <>
              <input
                ref={input}
                aria-label="Email attachments"
                className="hidden"
                type="file"
                multiple
                onChange={(event) => {
                  const files = Array.from(event.currentTarget.files ?? []);
                  event.currentTarget.value = "";
                  void add(files);
                }}
              />
              <Button
                aria-label="Add attachments"
                title="Add attachments"
                tone="ghost"
                size={attachments.length ? "compact" : "compactIcon"}
                loading={uploading}
                onClick={() => input.current?.click()}
              >
                {!uploading ? <Icon icon={Attachment01Icon} size={16} /> : null}
                {attachments.length > 0 ? (
                  <span>{attachments.length}</span>
                ) : null}
              </Button>
            </>,
            portalTarget,
          )
        : null}
      <AutoHeight>
        {attachments.length > 0 || uploading || error ? (
          <section aria-label="Email attachments" className="space-y-2 pt-5">
            {attachments.map((file, index) => (
              <div
                key={file.id}
                className="flex min-w-0 items-center gap-2 rounded-md bg-app-surface-soft px-3 py-2 text-sm"
              >
                <Icon
                  icon={File01Icon}
                  size={16}
                  className="shrink-0 text-app-muted"
                />
                <button
                  type="button"
                  className="min-w-0 flex-1 text-left [overflow-wrap:anywhere] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={() => void download(file)}
                >
                  {file.name || metadata[index]?.data?.filename || "Attachment"}
                </button>
                {metadata[index]?.data ? (
                  <span className="shrink-0 text-xs text-app-muted">
                    {formatBytes(metadata[index].data.size_bytes)}
                  </span>
                ) : null}
                {editable ? (
                  <Button
                    aria-label={`Remove ${file.name || "attachment"}`}
                    tone="ghost"
                    size="compactIcon"
                    onClick={() => {
                      if (canEdit.current && editor.getBlock(file.id))
                        editor.removeBlocks([file.id]);
                    }}
                  >
                    <Icon icon={Cancel01Icon} size={14} />
                  </Button>
                ) : null}
              </div>
            ))}
            {uploading ? (
              <p role="status" className="text-xs text-app-muted">
                Uploading attachments…
              </p>
            ) : null}
            {error ? (
              <p role="alert" className="text-xs text-destructive">
                {error}
              </p>
            ) : null}
          </section>
        ) : null}
      </AutoHeight>
    </>
  );
}
