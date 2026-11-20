import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Copy01Icon,
  Link01Icon,
  RefreshIcon,
} from "@hugeicons/core-free-icons";
import { Icon } from "@/components/ui/icon";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Select, SelectItem } from "@/components/ui/select";
import {
  TeamHubError,
  type TeamHubClient,
} from "@/features/teamhub/teamhub-client";
import { writeClipboardText } from "@/lib/clipboard";

export function DocumentLinkSharing({
  client,
  documentId,
  hasActiveLink = true,
  onPolicyChange,
}: {
  client: TeamHubClient;
  documentId: string;
  hasActiveLink?: boolean;
  onPolicyChange?: () => void;
}) {
  const queryClient = useQueryClient();
  const queryKey = ["teamhub", "document-link-policy", documentId] as const;
  const [hasLoadedPolicy, setHasLoadedPolicy] = useState(hasActiveLink);
  const shouldFetchPolicy = hasActiveLink || hasLoadedPolicy;
  const policy = useQuery({
    enabled: shouldFetchPolicy,
    queryKey,
    queryFn: () => client.documentLinks.get(documentId),
    retry: false,
  });
  const [link, setLink] = useState<{ url: string; version: number } | null>(
    null,
  );
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const active = policy.data?.status === "active";

  async function saveLinkRole(
    role: "viewer" | "editor",
    expectedVersion: number,
    reset: boolean,
  ) {
    try {
      return await client.documentLinks.set(documentId, {
        role,
        expected_version: expectedVersion,
        reset,
      });
    } catch (cause) {
      // A previously revoked link keeps a non-zero version even though
      // general_access.scope reports restricted; load that version on conflict.
      if (
        !shouldFetchPolicy &&
        cause instanceof TeamHubError &&
        cause.status === 409
      ) {
        const existing = await client.documentLinks.get(documentId);
        if (existing && existing.version !== expectedVersion) {
          return await client.documentLinks.set(documentId, {
            role,
            expected_version: existing.version,
            reset,
          });
        }
      }
      throw cause;
    }
  }

  async function update(role: "disabled" | "viewer" | "editor", reset = false) {
    setPending(true);
    setError(null);
    try {
      const expected_version = policy.data?.version ?? 0;
      if (role === "disabled") {
        await client.documentLinks.revoke(documentId, { expected_version });
        setLink(null);
      } else {
        const result = await saveLinkRole(role, expected_version, reset);
        const url =
          result.url ?? (link?.version === expected_version ? link.url : null);
        setLink(url ? { url, version: result.version } : null);
        queryClient.setQueryData(queryKey, result);
      }
      setHasLoadedPolicy(true);
      await policy.refetch();
      onPolicyChange?.();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Link sharing could not be updated.",
      );
      if (shouldFetchPolicy) {
        await policy.refetch();
      }
    } finally {
      setPending(false);
    }
  }
  return (
    <section className="mt-5 border-t border-app-border pt-4">
      <div className="flex flex-wrap items-center gap-3">
        <Icon icon={Link01Icon} className="text-app-muted" />
        <h3 className="mr-auto text-sm font-medium">Anyone with the link</h3>
        <Select
          aria-label="Link access"
          value={active ? policy.data!.role : "disabled"}
          disabled={pending || policy.isLoading || Boolean(policy.error)}
          onValueChange={(value) =>
            void update(value as "disabled" | "viewer" | "editor")
          }
          className="h-8 w-auto"
        >
          <SelectItem value="disabled">Disabled</SelectItem>
          <SelectItem value="viewer">Can view</SelectItem>
          <SelectItem value="editor">Can edit</SelectItem>
        </Select>
        {active ? (
          <Button
            aria-label="Reset link"
            title="Reset link"
            disabled={pending}
            size="compactIcon"
            tone="ghost"
            onClick={() => void update(policy.data!.role, true)}
          >
            <Icon icon={RefreshIcon} />
          </Button>
        ) : null}
        {active && link?.version === policy.data?.version ? (
          <Button
            aria-label="Copy shared link"
            title="Copy shared link"
            size="compactIcon"
            tone="ghost"
            onClick={() =>
              void writeClipboardText(link!.url).catch(() =>
                setError("Could not copy the link."),
              )
            }
          >
            <Icon icon={Copy01Icon} />
          </Button>
        ) : null}
      </div>
      {error || policy.error ? (
        <p role="alert" className="mt-2 text-sm text-app-danger">
          {error ?? "Link sharing is unavailable."}
        </p>
      ) : null}
    </section>
  );
}
