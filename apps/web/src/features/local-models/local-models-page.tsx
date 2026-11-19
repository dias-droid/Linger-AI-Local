import { AiChipIcon } from "@hugeicons/core-free-icons";
import {
  useMutation,
  useMutationState,
  useQuery,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";

import { Button } from "@/components/ui/button";
import { FormFeedback } from "@/components/ui/form-feedback";
import { Icon } from "@/components/ui/icon";
import { Select, SelectItem } from "@/components/ui/select";
import { relativeTime } from "@/features/local-computer/computer-relative-time";
import { useDesktopComputer } from "@/features/local-computer/desktop-computer";
import { localComputersQueryOptions } from "@/features/local-computer/local-computer-queries";
import {
  anotherMeQueryOptions,
  teamHubIdentityQueryOptions,
  tenantAgentAvailabilityQueryKey,
  tenantAgentAvailabilityQueryOptions,
  tenantAgentsQueryKey,
  tenantAgentsQueryOptions,
} from "@/features/rooms/room-queries";
import { requireRoomRouteParam } from "@/features/rooms/room-route-params";
import { teamHubData } from "@/features/teamhub/teamhub-api";
import { TeamHubError } from "@/features/teamhub/teamhub-error";
import { useTeamHubRuntime } from "@/features/teamhub/teamhub-runtime";
import type {
  TeamHubLocalComputerPage,
  TeamHubTenantAgent,
} from "@/features/teamhub/teamhub-types";

import {
  type AssignableLocalModelAgent,
  assignableLocalModelAgents,
  buildLocalModelRuntimeUpdate,
  isAgentUsingModel,
} from "./local-model-agents";
import { AdvancedDialog } from "./local-model-details";
import { ModelRow } from "./local-model-row";
import {
  MakeRoomDialog,
  RemoveModelDialog,
  UnloadModelDialog,
} from "./local-model-dialogs";
import {
  actionErrorCopy,
  libraryUnavailableCopy,
  memoryGuidanceCopy,
} from "./local-models-copy";
import {
  actOnLocalComputerModel,
  localModelActionMutationKey,
  localModelsQueryKey,
  localModelsQueryOptions,
  localModelsRefreshMutationKey,
  refreshLocalComputerModels,
  type LocalModelAction,
  type LocalModelActionInput,
  type LocalModelsView,
} from "./local-models-queries";
import {
  downloadStopped,
  formatGigabytes,
  loadCheck,
  localSwitchTargets,
  memoryGuidance,
  memorySummary,
  modelEntries,
  poolFreeBytes,
  poolOf,
  type ModelEntry,
  type ModelStatus,
} from "./local-models-rules";
import {
  activeSourceLabel,
  ByokPanel,
  ModelSourceTabs,
  SubscriptionPanel,
  SwitchToLocalNotice,
  useModelSourceSwitch,
} from "./model-source-panel";
import {
  type ModelSourceMode,
  modelSourceQueryOptions,
  type ModelSourceStatus,
} from "./model-source-queries";

type Dialog =
  | { kind: "advanced" }
  | { kind: "makeRoom"; modelId: string }
  | { kind: "remove"; modelId: string }
  | { kind: "unload"; modelId: string };

/**
 * The model states each confirmed action applies to, as the row offers it. A
 * stopped download is failed too but offers none of them.
 */
const actionStatuses: Record<"load" | "remove" | "unload", ModelStatus[]> = {
  load: ["idle", "failed"],
  remove: ["loaded", "idle", "failed"],
  unload: ["loaded"],
};

function computersPath(tenantId: string) {
  return `/t/${tenantId}/settings/computers`;
}

type LocalComputerRuntime = InventoryComputer["runtimes"][number];
type InventoryComputer = TeamHubLocalComputerPage["items"][number];

/**
 * Where one Computer's Agents get their model, chosen by `?computer=`, and
 * its local model library. Without it the desktop app opens its own Computer
 * and a browser the first one.
 */
export function ModelsPage() {
  const { client } = useTeamHubRuntime();
  const tenantId = requireRoomRouteParam(useParams().tenantId, "Tenant");
  const { data: inventory } = useSuspenseQuery(
    localComputersQueryOptions(client, tenantId),
  );
  const desktop = useDesktopComputer();
  const [searchParams, setSearchParams] = useSearchParams();
  const computers = inventory.items;
  const linkedId = searchParams.get("computer");
  const requestedId = linkedId ?? desktop?.status?.computerId;
  const owned = computers.find((item) => item.computer_id === requestedId);
  // A linked Computer the viewer does not own may be another member's: the
  // library API, not the owned inventory, decides whether they may read it.
  const sharedId = linkedId && !owned ? linkedId : undefined;
  const computer = sharedId ? undefined : (owned ?? computers[0]);

  function select(computerId: string) {
    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current);
        next.set("computer", computerId);
        return next;
      },
      { replace: true },
    );
  }

  return (
    <main className="mx-auto flex min-h-0 w-full max-w-(--app-settings-width) flex-col pb-4">
      {sharedId ? (
        <ComputerModels
          computerId={sharedId}
          computerPicker={null}
          key={sharedId}
          tenantId={tenantId}
        />
      ) : computer ? (
        <ComputerModels
          computer={computer}
          computerId={computer.computer_id}
          displayName={computer.display_name}
          computerPicker={
            computers.length > 1 ? (
              <Select
                aria-label="Computer"
                onValueChange={select}
                value={computer.computer_id}
                variant="pill"
              >
                {computers.map((item) => (
                  <SelectItem key={item.computer_id} value={item.computer_id}>
                    {item.status === "online"
                      ? item.display_name
                      : `${item.display_name} · Offline`}
                  </SelectItem>
                ))}
              </Select>
            ) : null
          }
          key={computer.computer_id}
          tenantId={tenantId}
        />
      ) : (
        <>
          <h1 className="text-2xl text-foreground">Models</h1>
          <EmptyState title="No computers yet">
            Connect a computer in{" "}
            <Link
              className="text-foreground underline underline-offset-2"
              to={computersPath(tenantId)}
            >
              Computers
            </Link>{" "}
            to download and run models on it.
          </EmptyState>
        </>
      )}
    </main>
  );
}

function EmptyState({
  action,
  children,
  title,
}: {
  action?: ReactNode;
  children: ReactNode;
  title: string;
}) {
  return (
    <section
      aria-label={title}
      className="mt-6 flex flex-col items-center px-4 pt-12 text-center"
    >
      <span className="flex size-16 items-center justify-center rounded-[20%] bg-muted text-foreground">
        <Icon icon={AiChipIcon} size={28} />
      </span>
      <h2 className="mt-6 text-xl">{title}</h2>
      <p className="mt-1.5 max-w-md text-sm text-muted-foreground">
        {children}
      </p>
      {action}
    </section>
  );
}

function Notice({ children }: { children: ReactNode }) {
  return (
    <p
      className="mt-6 rounded-xl bg-muted px-3.5 py-3 text-sm text-muted-foreground"
      role="status"
    >
      {children}
    </p>
  );
}

function ComputerModels({
  computer,
  computerId,
  computerPicker,
  displayName,
  tenantId,
}: {
  computer?: InventoryComputer;
  computerId: string;
  computerPicker: ReactNode;
  /** Absent for a Computer outside the viewer's own inventory. */
  displayName?: string;
  tenantId: string;
}) {
  const runtimes: readonly LocalComputerRuntime[] = computer?.runtimes ?? [];
  const { client } = useTeamHubRuntime();
  const queryClient = useQueryClient();
  const query = useQuery(localModelsQueryOptions(client, tenantId, computerId));
  const view = query.data;
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const summary = view?.available ? memorySummary(view) : undefined;
  // Only the owner switches sources, and only their own Computers carry a
  // display name here.
  const source = useQuery({
    ...modelSourceQueryOptions(client, tenantId, computerId),
    enabled: displayName !== undefined,
  });
  const status = source.data?.status;
  const [tab, setTab] = useState<ModelSourceMode | null>(null);
  const shownTab = tab ?? status?.mode ?? "local";
  const computerName = displayName ?? "this computer";
  const { feedback, switcher } = useModelSourceSwitch({
    computerId,
    computerName,
    tenantId,
  });
  const switching = switcher.pending !== undefined;
  const switchTargets = view?.available ? localSwitchTargets(view) : [];
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const refresh = useMutation({
    mutationFn: () => refreshLocalComputerModels(client, tenantId, computerId),
    mutationKey: localModelsRefreshMutationKey(tenantId, computerId),
    onError: (error) =>
      setRefreshError(
        error instanceof TeamHubError ? error.code : "REFRESH_FAILED",
      ),
    onMutate: () => setRefreshError(null),
    onSettled: () =>
      queryClient.invalidateQueries({
        queryKey: localModelsQueryKey(tenantId, computerId),
      }),
  });
  const canRecheck = Boolean(
    view && view.viewer_is_owner && view.computer.status === "online",
  );
  const guidance = view?.available ? memoryGuidance(view) : null;
  const subscriptionGuidanceCopy = guidance
    ? memoryGuidanceCopy(guidance)
    : undefined;

  return (
    <>
      <header className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl text-foreground">Models</h1>
          {status ? (
            <p className="mt-1.5 text-sm text-muted-foreground">
              Agents on {computerName} use {activeSourceLabel(status)}
            </p>
          ) : null}
          {summary?.totalBytes ? (
            <>
              <p className="mt-1.5 text-sm text-muted-foreground">
                {formatGigabytes(summary.usedBytes)} of{" "}
                {formatGigabytes(summary.totalBytes)}{" "}
                {summary.gpu ? "GPU memory" : "memory"} in use
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {formatGigabytes(summary.freeBytes)} free
                {view?.observed_at
                  ? ` · Checked ${relativeTime(view.observed_at)}`
                  : ""}
              </p>
            </>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {computerPicker}
          {canRecheck ? (
            <Button
              loading={refresh.isPending}
              onClick={() => refresh.mutate()}
              size="compact"
            >
              Recheck memory
            </Button>
          ) : null}
          {view?.available ? (
            <Button
              onClick={() => setDialog({ kind: "advanced" })}
              size="compact"
            >
              Details
            </Button>
          ) : null}
        </div>
      </header>

      {status ? (
        <ModelSourceTabs
          active={status.mode}
          onChange={setTab}
          value={shownTab}
        />
      ) : null}
      {switcher.failure ? (
        <div className="mt-4">
          <FormFeedback tone="danger">{switcher.failure}</FormFeedback>
        </div>
      ) : null}
      {refreshError ? (
        <div className="mt-4">
          <FormFeedback tone="danger">
            {actionErrorCopy(refreshError)}
          </FormFeedback>
        </div>
      ) : null}
      {switching ? (
        <p className="mt-4 text-sm text-muted-foreground" role="status">
          Switching {computerName}. This can take a few minutes the first time.
        </p>
      ) : null}
      {feedback}
      {status && shownTab === "subscription" ? (
        <>
          <SubscriptionPanel
            disabled={switching}
            runtimes={runtimes}
            status={status}
            switcher={switcher}
          />
          {subscriptionGuidanceCopy ? (
            <aside
              aria-label="Local model tip"
              className="mt-6 flex flex-wrap items-start justify-between gap-3 rounded-xl bg-muted px-4 py-3"
            >
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-foreground">
                  {subscriptionGuidanceCopy.title}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {subscriptionGuidanceCopy.body}
                </p>
              </div>
              <Button onClick={() => setTab("local")} size="compact">
                Open Local model
              </Button>
            </aside>
          ) : null}
        </>
      ) : status && shownTab === "byok" ? (
        <ByokPanel
          computerId={computerId}
          disabled={switching}
          key={status.mode}
          status={status}
          switcher={switcher}
          tenantId={tenantId}
        />
      ) : view ? (
        <>
          {status && status.mode !== "local" ? (
            <SwitchToLocalNotice
              disabled={switching || view.computer.status === "offline"}
              models={switchTargets}
              switcher={switcher}
            />
          ) : null}
          <Library
            computer={computer}
            dialog={dialog}
            guidance={guidance}
            onRefresh={() => refresh.mutate()}
            onUseForAgents={(modelId) =>
              switcher.request({ local_model_id: modelId, mode: "local" })
            }
            rechecking={refresh.isPending}
            setDialog={setDialog}
            status={status}
            switchingModelId={
              switcher.pending?.mode === "local"
                ? switcher.pending.local_model_id
                : undefined
            }
            switching={switching}
            tenantId={tenantId}
            view={view}
          />
        </>
      ) : query.isError ? (
        <EmptyState
          action={
            <Button
              className="mt-6"
              onClick={() => void query.refetch()}
              size="compact"
            >
              Try again
            </Button>
          }
          title={`Couldn't load the models of ${displayName ?? "this computer"}`}
        >
          {actionErrorCopy(
            query.error instanceof TeamHubError ? query.error.code : undefined,
          )}
        </EmptyState>
      ) : (
        <p className="mt-6 text-sm text-muted-foreground" role="status">
          Loading models
        </p>
      )}
    </>
  );
}

function Library({
  computer,
  dialog,
  guidance,
  onRefresh,
  onUseForAgents,
  rechecking,
  setDialog,
  status,
  switching,
  switchingModelId,
  tenantId,
  view,
}: {
  computer?: InventoryComputer;
  dialog: Dialog | null;
  guidance: ReturnType<typeof memoryGuidance>;
  onRefresh: () => void;
  onUseForAgents: (modelId: string) => void;
  rechecking: boolean;
  setDialog: (dialog: Dialog | null) => void;
  status: ModelSourceStatus | undefined;
  switching: boolean;
  switchingModelId: string | undefined;
  tenantId: string;
  view: LocalModelsView;
}) {
  const { client } = useTeamHubRuntime();
  const queryClient = useQueryClient();
  const computerId = view.computer.computer_id;
  const name = view.computer.display_name;
  const offline = view.computer.status === "offline";
  const readOnly = !view.viewer_is_owner;
  const canManageAgents = !readOnly;
  const piReady =
    !computer ||
    computer.runtimes.some(
      (runtime) => runtime.type === "pi" && runtime.status === "ready",
    );
  const canSwitchAgents =
    !offline &&
    canManageAgents &&
    piReady &&
    (!status?.mode || status.mode === "local");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [failure, setFailure] = useState<{
    code?: string;
    modelId: string;
  } | null>(null);
  const [assignError, setAssignError] = useState<string | null>(null);
  const [pendingSwitch, setPendingSwitch] = useState<{
    agentIds: string[];
    modelId: string;
  } | null>(null);
  const completedSwitchKeyRef = useRef<string | null>(null);
  // An action the Computer accepted, shown on its row until a snapshot moves
  // the model on: a different status or a newer snapshot.
  const [accepted, setAccepted] = useState<
    Record<
      string,
      { action: LocalModelAction; from?: ModelStatus; observedAt?: string }
    >
  >({});
  const identityQuery = useQuery({
    ...teamHubIdentityQueryOptions(client),
    enabled: canManageAgents,
  });
  const anotherMeQuery = useQuery({
    ...anotherMeQueryOptions(client, tenantId),
    enabled: canManageAgents,
  });
  const agentsQuery = useQuery({
    ...tenantAgentsQueryOptions(client, tenantId),
    enabled: canManageAgents,
  });
  const availabilityQuery = useQuery({
    ...tenantAgentAvailabilityQueryOptions(client, tenantId),
    enabled: canManageAgents,
  });
  const currentActorId = identityQuery.data?.actors.find(
    (candidate) => candidate.tenant_id === tenantId,
  )?.id;
  const assignableAgents = useMemo(
    () =>
      canManageAgents
        ? assignableLocalModelAgents({
            agents: agentsQuery.data?.items,
            anotherMeActorId: anotherMeQuery.data?.agent_actor_id,
            availability: availabilityQuery.data?.items,
            computer,
            computerId,
            currentActorId,
          })
        : [],
    [
      agentsQuery.data?.items,
      anotherMeQuery.data?.agent_actor_id,
      availabilityQuery.data?.items,
      canManageAgents,
      computer,
      computerId,
      currentActorId,
    ],
  );
  const anotherMeChatHref = anotherMeQuery.data?.room_id
    ? `/t/${encodeURIComponent(tenantId)}/rooms/${encodeURIComponent(anotherMeQuery.data.room_id)}/chat`
    : undefined;
  const entries = useMemo(
    () => (view.available ? modelEntries(view) : []),
    [view],
  );
  const find = (modelId: string) =>
    entries.find((entry) => entry.model.id === modelId);
  const mutationKey = localModelActionMutationKey(tenantId, computerId);
  const action = useMutation({
    mutationFn: (input: LocalModelActionInput) =>
      actOnLocalComputerModel(client, tenantId, computerId, input),
    mutationKey,
    onError: (error, input) => {
      setFailure({
        code: error instanceof TeamHubError ? error.code : undefined,
        modelId: input.modelId,
      });
      setPendingSwitch((current) =>
        current?.modelId === input.modelId ? null : current,
      );
    },
    onMutate: (input) => {
      setFailure(null);
      return { from: find(input.modelId)?.status };
    },
    onSuccess: (_result, input, started) =>
      setAccepted((current) => ({
        ...current,
        [input.modelId]: {
          action: input.action,
          from: started?.from,
          observedAt: queryClient.getQueryData<LocalModelsView>(
            localModelsQueryKey(tenantId, computerId),
          )?.observed_at,
        },
      })),
    // The Computer answers at once; a fresh read shows what it started even
    // before its next snapshot hint.
    onSettled: () =>
      queryClient.invalidateQueries({
        queryKey: localModelsQueryKey(tenantId, computerId),
      }),
  });
  const assignMutation = useMutation({
    mutationFn: ({
      agent,
      piModel,
    }: {
      agent: AssignableLocalModelAgent;
      piModel: string;
    }) =>
      teamHubData(
        client.api.PATCH("/v0/tenants/{tenantId}/agents/{agentId}", {
          body: {
            expected_configuration_revision: agent.configurationRevision,
            runtime: buildLocalModelRuntimeUpdate(
              agent,
              piModel,
              computerId,
              computer,
            ),
          },
          params: { path: { agentId: agent.actorId, tenantId } },
        }),
      ),
    onError: (error) => {
      setAssignError(
        error instanceof Error
          ? error.message
          : "Couldn't switch the Agent to this model. Try again.",
      );
    },
    onMutate: () => {
      setAssignError(null);
    },
    onSuccess: (updated) => {
      queryClient.setQueryData(
        tenantAgentsQueryKey(tenantId),
        (current: { items: TeamHubTenantAgent[] } | undefined) =>
          current
            ? {
                ...current,
                items: current.items.map((item) =>
                  item.actor.id === updated.actor.id
                    ? { ...item, ...updated }
                    : item,
                ),
              }
            : current,
      );
      void Promise.all([
        queryClient.invalidateQueries({
          queryKey: tenantAgentsQueryKey(tenantId),
        }),
        queryClient.invalidateQueries({
          queryKey: localModelsQueryKey(tenantId, computerId),
        }),
        queryClient.invalidateQueries({
          queryKey: tenantAgentAvailabilityQueryKey(tenantId),
        }),
      ]);
    },
  });
  const { mutateAsync: applyAgentAssignment } = assignMutation;
  const assigningAgentId = assignMutation.isPending
    ? assignMutation.variables?.agent.actorId
    : undefined;
  const sending = useMutationState({
    filters: { mutationKey, status: "pending" },
    select: (mutation) =>
      mutation.state.variables as LocalModelActionInput | undefined,
  });
  // The action each row shows as under way: one being sent, or one accepted
  // that no snapshot reflects yet.
  const requests = new Map<string, LocalModelAction>();
  for (const [modelId, request] of Object.entries(accepted)) {
    if (
      request.observedAt === view.observed_at &&
      request.from === find(modelId)?.status
    )
      requests.set(modelId, request.action);
  }
  for (const input of sending) {
    if (input) requests.set(input.modelId, input.action);
  }
  // A download the Computer accepted is a job it can cancel before the
  // first progress reaches a snapshot; every other request holds the row.
  const busy = (modelId: string) =>
    requests.has(modelId) &&
    (requests.get(modelId) !== "download" ||
      sending.some((input) => input?.modelId === modelId));
  const pendingLoadInFlight = pendingSwitch
    ? requests.get(pendingSwitch.modelId) === "load"
    : false;
  useEffect(() => {
    if (!pendingSwitch) return;
    const target = entries.find(
      (entry) => entry.model.id === pendingSwitch.modelId,
    );
    if (
      !target ||
      (!pendingLoadInFlight &&
        (target.status === "failed" ||
          target.status === "available" ||
          target.status === "unavailable"))
    ) {
      setPendingSwitch(null);
      return;
    }
    if (target.status !== "loaded" || !target.model.pi_model) return;
    const key = `${pendingSwitch.modelId}:${view.observed_at ?? ""}:${pendingSwitch.agentIds.join(",")}`;
    if (completedSwitchKeyRef.current === key) return;
    completedSwitchKeyRef.current = key;
    const piModel = target.model.pi_model;
    const matching = assignableAgents.filter(
      (agent) =>
        pendingSwitch.agentIds.includes(agent.actorId) &&
        !isAgentUsingModel(target, agent, computerId),
    );
    const busySkipped = matching.filter((agent) => agent.busy);
    const targets = matching.filter((agent) => !agent.busy);
    setPendingSwitch(null);
    if (busySkipped.length) {
      const names = busySkipped.map((agent) => agent.name).join(", ");
      setAssignError(
        `Couldn't switch ${names} to ${target.model.name} while working. Switch once the current turn finishes.`,
      );
    }
    if (!targets.length) return;
    void Promise.all(
      targets.map((agent) => applyAgentAssignment({ agent, piModel })),
    ).catch(() => undefined);
  }, [
    applyAgentAssignment,
    assignableAgents,
    computerId,
    entries,
    pendingLoadInFlight,
    pendingSwitch,
    view.observed_at,
  ]);
  // A dialog stays open across snapshots, so its confirm checks the model
  // and Computer as they are now, the way the row's buttons do.
  const confirmable = (
    entry: ModelEntry,
    action: "load" | "remove" | "unload",
  ) =>
    !offline &&
    !readOnly &&
    !requests.has(entry.model.id) &&
    !downloadStopped(entry.model) &&
    actionStatuses[action].includes(entry.status);
  const dialogEntry =
    dialog && dialog.kind !== "advanced" ? find(dialog.modelId) : undefined;
  const dialogPool = dialogEntry
    ? poolOf(view, dialogEntry.model.pool)
    : undefined;
  const makeRoom =
    dialog?.kind === "makeRoom" && dialogEntry
      ? (loadCheck(view, dialogEntry.model) ??
        (dialogPool
          ? {
              freeBytes: poolFreeBytes(dialogPool),
              kept: [],
              loaded: [],
              needBytes: dialogEntry.model.memory_bytes,
              pool: dialogPool,
            }
          : null))
      : null;
  const failedEntry = failure ? find(failure.modelId) : undefined;
  const guidanceCopy =
    !offline && view.available && guidance
      ? memoryGuidanceCopy(guidance)
      : undefined;

  function act(input: LocalModelActionInput) {
    setDialog(null);
    if (
      (input.action === "cancel" ||
        input.action === "remove" ||
        input.action === "unload") &&
      pendingSwitch?.modelId === input.modelId
    ) {
      setPendingSwitch(null);
    }
    action.mutate(input);
  }

  function load(entry: ModelEntry) {
    if (loadCheck(view, entry.model))
      setDialog({ kind: "makeRoom", modelId: entry.model.id });
    else act({ action: "load", modelId: entry.model.id });
  }

  function unload(entry: ModelEntry) {
    if (entry.used_by.length)
      setDialog({ kind: "unload", modelId: entry.model.id });
    else act({ action: "unload", modelId: entry.model.id });
  }

  const unavailable = view.available
    ? undefined
    : libraryUnavailableCopy(view.reason?.code, name);

  return (
    <>
      {offline ? (
        <Notice>
          <span className="text-foreground">
            {name} is offline
            {view.computer.last_seen_at
              ? ` (last seen ${relativeTime(view.computer.last_seen_at)})`
              : ""}
            .
          </span>{" "}
          This is what it last reported.
          {readOnly ? null : (
            <>
              {" "}
              Reconnect it in{" "}
              <Link
                className="text-foreground underline underline-offset-2"
                to={computersPath(tenantId)}
              >
                Computers
              </Link>{" "}
              to manage its models.
            </>
          )}
        </Notice>
      ) : null}
      {readOnly ? (
        <Notice>
          Only the person who connected {name} can download, load or remove its
          models.
        </Notice>
      ) : null}

      {unavailable ? (
        <EmptyState title={unavailable.title}>{unavailable.body}</EmptyState>
      ) : (
        <>
          {failure ? (
            <div className="mt-6">
              <FormFeedback tone="danger">
                {failedEntry ? `${failedEntry.model.name}: ` : null}
                {actionErrorCopy(failure.code)}
              </FormFeedback>
            </div>
          ) : null}
          {assignError ? (
            <div className="mt-6">
              <FormFeedback tone="danger">{assignError}</FormFeedback>
            </div>
          ) : null}
          {guidanceCopy ? (
            <aside
              aria-label="Memory guidance"
              className="mt-6 flex flex-wrap items-start justify-between gap-3 rounded-xl border border-[var(--app-status-warning-border)] bg-[var(--app-status-warning-surface)] px-4 py-3"
            >
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-app-warning">
                  {guidanceCopy.title}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {guidanceCopy.body}
                </p>
              </div>
              {readOnly ? null : (
                <Button loading={rechecking} onClick={onRefresh} size="compact">
                  Recheck memory
                </Button>
              )}
            </aside>
          ) : null}
          <section aria-label="Models" className="mt-6 grid gap-2">
            {entries.map((entry) => {
              const modelId = entry.model.id;
              const canUseForAgents =
                !offline &&
                !readOnly &&
                status?.mode === "local" &&
                entry.status === "loaded" &&
                entry.model.pi_model !== status.runtime_model &&
                entry.model.id !== status.runtime_model;
              return (
                <ModelRow
                  anotherMeChatHref={anotherMeChatHref}
                  assignableAgents={assignableAgents}
                  assigningAgentId={assigningAgentId}
                  computer={computer}
                  disabled={offline || readOnly || switching || busy(modelId)}
                  entry={entry}
                  expanded={expandedId === modelId}
                  key={modelId}
                  onAssignAgent={
                    entry.model.pi_model && canSwitchAgents
                      ? (agent) =>
                          assignMutation.mutate({
                            agent,
                            piModel: entry.model.pi_model!,
                          })
                      : undefined
                  }
                  onCancel={() => act({ action: "cancel", modelId })}
                  onDownload={() => act({ action: "download", modelId })}
                  onLoad={() => load(entry)}
                  onRemove={() => setDialog({ kind: "remove", modelId })}
                  onToggle={() =>
                    setExpandedId((current) =>
                      current === modelId ? null : modelId,
                    )
                  }
                  onUnload={() => unload(entry)}
                  onUseForAgents={
                    canUseForAgents ? () => onUseForAgents(modelId) : undefined
                  }
                  requested={requests.get(modelId)}
                  switchingForAgents={switchingModelId === modelId}
                  view={view}
                />
              );
            })}
          </section>
        </>
      )}

      {dialog?.kind === "advanced" ? (
        <AdvancedDialog onClose={() => setDialog(null)} view={view} />
      ) : null}
      {dialogEntry && makeRoom ? (
        <MakeRoomDialog
          assignableAgents={assignableAgents}
          check={makeRoom}
          disabled={!confirmable(dialogEntry, "load")}
          entry={dialogEntry}
          onClose={() => setDialog(null)}
          onConfirm={(unloadFirst, switchAgentIds) => {
            completedSwitchKeyRef.current = null;
            setPendingSwitch(
              canSwitchAgents && switchAgentIds.length
                ? { agentIds: switchAgentIds, modelId: dialogEntry.model.id }
                : null,
            );
            act({
              action: "load",
              modelId: dialogEntry.model.id,
              unloadFirst,
            });
          }}
          onRecheck={!offline && !readOnly ? onRefresh : undefined}
          rechecking={rechecking}
          view={view}
        />
      ) : null}
      {dialogEntry && dialog?.kind === "unload" ? (
        <UnloadModelDialog
          disabled={!confirmable(dialogEntry, "unload")}
          entry={dialogEntry}
          onClose={() => setDialog(null)}
          onConfirm={() =>
            act({ action: "unload", modelId: dialogEntry.model.id })
          }
          view={view}
        />
      ) : null}
      {dialogEntry && dialog?.kind === "remove" ? (
        <RemoveModelDialog
          disabled={!confirmable(dialogEntry, "remove")}
          entry={dialogEntry}
          onClose={() => setDialog(null)}
          onConfirm={() =>
            act({ action: "remove", modelId: dialogEntry.model.id })
          }
          view={view}
        />
      ) : null}
    </>
  );
}
