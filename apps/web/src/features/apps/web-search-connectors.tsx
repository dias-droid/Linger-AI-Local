import { Globe02Icon } from "@hugeicons/core-free-icons";
import {
  type UseQueryResult,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { ModalDialog } from "@/components/ui/modal-dialog";
import { teamHubData, teamHubDone } from "@/features/teamhub/teamhub-api";
import { useTeamHubRuntime } from "@/features/teamhub/teamhub-runtime";
import type {
  TeamHubWebSearchBackend,
  TeamHubWebSearchBackendList,
  TeamHubWebSearchKeyBackend,
} from "@/features/teamhub/teamhub-types";
import {
  isWebSearchKeyBackend,
  type ShownWebSearchBackend,
  webSearchQueryKey,
} from "@/features/web-search/web-search-backends";
import { WebSearchKeyForm } from "@/features/web-search/web-search-key-form";
import { WebSearchKeysUnavailable } from "@/features/web-search/web-search-keys-unavailable";
import { webSearchBackendLogo } from "@/features/web-search/web-search-logos";
import { formatUpdatedAt } from "@/lib/date-format";
import { cn } from "@/lib/cn";

import { WEB_SEARCH_FILTER } from "./app-groups";
import { AppLogo } from "./app-logo";

/**
 * The web search backends as Connectors cards. They need no Composio key:
 * each provider's own key is saved in TeamHub, and the list loads and fails
 * on its own.
 */
export function WebSearchSection({
  backends,
  className,
  heading,
  list,
}: {
  /** The backends to show, narrowed by Connected only. */
  backends: readonly ShownWebSearchBackend[];
  className?: string;
  heading: boolean;
  list: UseQueryResult<TeamHubWebSearchBackendList>;
}) {
  const [openID, setOpenID] = useState<string | null>(null);
  const opened = backends.find((backend) => backend.id === openID);
  const headingId = "connector-group-web-search";
  return (
    <section
      aria-label={heading ? undefined : WEB_SEARCH_FILTER.label}
      aria-labelledby={heading ? headingId : undefined}
      className={className}
    >
      {heading ? (
        <h2
          className="mb-2.5 text-[14px] font-medium text-muted-foreground"
          id={headingId}
        >
          {WEB_SEARCH_FILTER.label}
        </h2>
      ) : null}
      {list.isPending ? (
        <p className="py-3 text-sm text-muted-foreground" role="status">
          Loading web search...
        </p>
      ) : list.error ? (
        <div className="flex items-center gap-3 py-3" role="alert">
          <p className="text-sm text-app-danger">{list.error.message}</p>
          <Button onClick={() => void list.refetch()} size="compact">
            Retry
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {backends.map((backend) => (
            <WebSearchBackendCard
              backend={backend}
              isDefault={list.data.default_search === backend.id}
              key={backend.id}
              onOpen={() => setOpenID(backend.id)}
            />
          ))}
        </div>
      )}
      {opened && list.data ? (
        <WebSearchBackendDialog
          backend={opened}
          list={list.data}
          onClose={() => setOpenID(null)}
        />
      ) : null}
    </section>
  );
}

/**
 * A backend card in the app cards' shape: the provider's own description
 * until it is usable, then a status dot and line, and Connect while a key
 * can still be added.
 */
function WebSearchBackendCard({
  backend,
  isDefault,
  onOpen,
}: {
  backend: ShownWebSearchBackend;
  isDefault: boolean;
  onOpen: () => void;
}) {
  const state = connectionState(backend);
  const line = state?.label ?? backend.description;
  const canConnect =
    isWebSearchKeyBackend(backend) &&
    (backend.key_state === "none" || state?.tone === "danger");
  return (
    <article className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-border bg-card px-4 py-3 transition-colors duration-150 hover:bg-accent/40 motion-reduce:transition-none">
      <button
        aria-label={backend.name}
        className="flex min-w-0 flex-1 items-center gap-3 rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={onOpen}
        type="button"
      >
        <BackendLogoTile backend={backend} />
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-baseline gap-1.5">
            <span className="truncate text-sm font-medium text-foreground">
              {backend.name}
            </span>
            {isDefault ? (
              <span className="shrink-0 text-xs text-muted-foreground">
                Default
              </span>
            ) : null}
          </span>
          <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
            {state ? (
              <span
                aria-hidden
                className={cn(
                  "size-1.5 shrink-0 rounded-full",
                  state.tone === "danger"
                    ? "bg-[var(--app-status-danger-text)]"
                    : "bg-[var(--app-status-success-text)]",
                )}
              />
            ) : null}
            <span className="truncate" title={line}>
              {line}
            </span>
          </span>
        </span>
      </button>
      {canConnect ? (
        <Button
          aria-label={`Connect ${backend.name}`}
          className="px-2.5"
          onClick={onOpen}
          size="compact"
          tone="secondary"
        >
          Connect
        </Button>
      ) : null}
    </article>
  );
}

function WebSearchBackendDialog({
  backend,
  list,
  onClose,
}: {
  backend: ShownWebSearchBackend;
  list: TeamHubWebSearchBackendList;
  onClose: () => void;
}) {
  const usage = usageLine(backend);
  return (
    <ModalDialog
      className="app-key-dialog"
      closeOnBackdrop
      description={backend.description}
      onClose={onClose}
      size="md"
      title={backend.name}
    >
      <div className="space-y-5 px-5 py-5 text-sm text-app-body">
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5">
          <Fact label="Does">
            {backend.commands.includes("open")
              ? "Searches the web and reads pages"
              : "Searches the web"}
          </Fact>
          {backend.free_tier ? (
            <Fact label="Free tier">{backend.free_tier}</Fact>
          ) : null}
          {backend.tier_text ? (
            <Fact label="Free use">{backend.tier_text}</Fact>
          ) : null}
          {usage ? <Fact label="Usage">{usage}</Fact> : null}
        </dl>
        {isWebSearchKeyBackend(backend) ? (
          <KeySection backend={backend} canSave={list.can_save_keys} />
        ) : null}
        <DefaultSection backend={backend} list={list} />
      </div>
    </ModalDialog>
  );
}

function KeySection({
  backend,
  canSave,
}: {
  backend: TeamHubWebSearchBackend & { id: TeamHubWebSearchKeyBackend };
  canSave: boolean;
}) {
  const { client } = useTeamHubRuntime();
  const queryClient = useQueryClient();
  const saved = backend.key_state !== "none";
  const remove = useMutation({
    mutationFn: () =>
      teamHubDone(
        client.api.DELETE("/v0/web-search/backends/{backend}/key", {
          params: { path: { backend: backend.id } },
        }),
      ),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: webSearchQueryKey }),
  });
  return (
    <section aria-label="API key" className="space-y-3">
      {saved ? <p>{savedKeyText(backend)}</p> : null}
      {canSave ? (
        <WebSearchKeyForm
          backend={backend}
          submitLabel={saved ? "Replace key" : "Save key"}
        />
      ) : (
        <WebSearchKeysUnavailable />
      )}
      {saved ? (
        <div className="space-y-1.5">
          <Button
            loading={remove.isPending}
            onClick={() => remove.mutate()}
            tone="danger"
          >
            Remove key
          </Button>
          {remove.error ? (
            <p className="text-xs text-app-danger" role="alert">
              {remove.error.message}
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function DefaultSection({
  backend,
  list,
}: {
  backend: ShownWebSearchBackend;
  list: TeamHubWebSearchBackendList;
}) {
  const { client } = useTeamHubRuntime();
  const queryClient = useQueryClient();
  const chosen = list.chosen_default_search === backend.id;
  const change = useMutation({
    mutationFn: (makeDefault: boolean) =>
      teamHubData(
        makeDefault
          ? client.api.PUT("/v0/web-search/default", {
              body: { backend: backend.id },
            })
          : client.api.DELETE("/v0/web-search/default"),
      ),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: webSearchQueryKey }),
  });
  const text = chosen
    ? `Your Agents search with ${backend.name} when they name no backend.`
    : list.default_search === backend.id
      ? `Your Agents search with ${backend.name} when they name no backend, because it is the first ready one in the default order.`
      : backend.status === "ready"
        ? `Make ${backend.name} the backend your Agents search with when they name none.`
        : `Add a key to make ${backend.name} the default.`;
  return (
    <section aria-label="Default search backend" className="space-y-2">
      <p className="text-muted-foreground">{text}</p>
      {chosen ? (
        <Button
          loading={change.isPending}
          onClick={() => change.mutate(false)}
          tone="secondary"
        >
          Clear default
        </Button>
      ) : backend.status === "ready" ? (
        <Button
          loading={change.isPending}
          onClick={() => change.mutate(true)}
          tone="secondary"
        >
          Make default
        </Button>
      ) : null}
      {change.error ? (
        <p className="text-xs text-app-danger" role="alert">
          {change.error.message}
        </p>
      ) : null}
    </section>
  );
}

function Fact({ children, label }: { children: string; label: string }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="[overflow-wrap:anywhere]">{children}</dd>
    </>
  );
}

function BackendLogoTile({ backend }: { backend: TeamHubWebSearchBackend }) {
  const logo = webSearchBackendLogo(backend.id);
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex size-10 shrink-0 items-center justify-center rounded-lg bg-card shadow-outline",
        logo ? "text-foreground" : "text-muted-foreground",
      )}
    >
      {logo ? (
        <AppLogo name={backend.name} url={logo} />
      ) : (
        <Icon icon={Globe02Icon} size={20} />
      )}
    </span>
  );
}

/**
 * The status line of a backend that has a key or a free tier; null for one
 * that still needs a key, whose card shows its description.
 */
function connectionState(
  backend: TeamHubWebSearchBackend,
): { label: string; tone: "danger" | "success" } | null {
  if (backend.key_state === "rejected" || backend.status === "key_rejected")
    return { label: "Key rejected", tone: "danger" };
  if (backend.key_state !== "none") {
    const usage = usageLine(backend);
    return {
      label: usage ? `Connected · ${usage}` : "Connected",
      tone: "success",
    };
  }
  if (backend.tier === "free")
    return { label: "Free, limited", tone: "success" };
  return null;
}

function savedKeyText(backend: TeamHubWebSearchBackend): string {
  if (backend.key_state === "rejected")
    return `${backend.name} refused the saved key. Paste a new one.`;
  if (backend.key_state === "unverified")
    return `A key is saved. ${backend.name} has no key check, so the first search proves it.`;
  return "A key is saved.";
}

const numberFormat = new Intl.NumberFormat("en-US");
const dollarFormat = new Intl.NumberFormat("en-US", {
  currency: "USD",
  style: "currency",
});

/**
 * What is left on the account, from the live quota; null when the provider
 * reported no numbers worth a line.
 */
function usageLine(backend: TeamHubWebSearchBackend): string | null {
  const quota = backend.quota;
  if (!quota) return null;
  if (quota.from === "unavailable") {
    switch (quota.reason) {
      case "not_observed":
        return "Usage shows after the first search";
      case "provider_unavailable":
        return "Usage unavailable right now";
      default:
        return null;
    }
  }
  if (quota.remaining === undefined) return null;
  const amount = (value: number) =>
    quota.unit === "usd"
      ? dollarFormat.format(value)
      : numberFormat.format(value);
  const unit =
    quota.unit === "credits"
      ? " credits"
      : quota.unit === "requests"
        ? " requests"
        : "";
  const left = `${amount(quota.remaining)}${
    quota.limit === undefined ? "" : ` / ${amount(quota.limit)}`
  }${unit} left`;
  return quota.from === "last_response" && quota.observed_at
    ? `${left}, as of the last search ${formatUpdatedAt(quota.observed_at)}`
    : left;
}
