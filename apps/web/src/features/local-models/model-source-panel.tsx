import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { FormFeedback } from "@/components/ui/form-feedback";
import { ModalDialog } from "@/components/ui/modal-dialog";
import { Select, SelectItem } from "@/components/ui/select";
import { Hint } from "@/features/local-computer/computer-hint";
import { localComputersQueryKey } from "@/features/local-computer/local-computer-queries";
import {
  tenantAgentAvailabilityQueryKey,
  tenantAgentsQueryKey,
} from "@/features/rooms/room-queries";
import { TeamHubError } from "@/features/teamhub/teamhub-error";
import { useTeamHubRuntime } from "@/features/teamhub/teamhub-runtime";
import { cn } from "@/lib/cn";

import {
  modelSourceErrorCopy,
  modelSourceModeLabels,
  modelSourceRuntimeLabels,
} from "./local-models-copy";
import {
  type LocalModel,
  tenantLocalModelsQueryKey,
} from "./local-models-queries";
import { formatGigabytes } from "./local-models-rules";
import {
  type ModelSourceMode,
  type ModelSourceStatus,
  type ModelSourceSwitchRequest,
  type ModelSourceView,
  modelSourceQueryKey,
  switchModelSource,
} from "./model-source-queries";

// Subscription is not offered: switching to it moves every Agent on the
// Computer to one Runtime without checking that Runtime is signed in, and
// unloads local models.
const modes: readonly ModelSourceMode[] = ["local", "byok"];

const byokExplanation =
  "Bring your own key: use your own OpenAI-compatible or Anthropic API endpoint. A gateway on this computer serves it to your Agents.";

/** What the page says the Computer's Agents run on now. */
export function activeSourceLabel(status: ModelSourceStatus) {
  const runtime = modelSourceRuntimeLabels[status.runtime];
  if (status.mode === "byok")
    return `BYOK · ${status.byok.model_id ?? runtime}`;
  if (status.mode === "subscription") return `Subscription · ${runtime}`;
  return "Local model";
}

export interface ModelSourceSwitcher {
  clearFeedback: () => void;
  failure: string | undefined;
  pending: ModelSourceSwitchRequest | undefined;
  request: (body: ModelSourceSwitchRequest) => void;
  saveRevision: number;
}

/**
 * Switching may take minutes while the Computer installs a Runtime or starts
 * its gateway. When Agents are working, the owner chooses whether to end
 * their tasks; nothing changes until they do. Work that starts during the
 * switch is asked about once the Computer has switched.
 */
export function useModelSourceSwitch({
  computerId,
  computerName,
  tenantId,
}: {
  computerId: string;
  computerName: string;
  tenantId: string;
}) {
  const { client } = useTeamHubRuntime();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState<{
    agents: string[];
    body: ModelSourceSwitchRequest;
  } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saveRevision, setSaveRevision] = useState(0);
  const mutation = useMutation({
    mutationFn: (body: ModelSourceSwitchRequest) =>
      switchModelSource(client, tenantId, computerId, body),
    onError: (error, body) => {
      // A switch can fail after the Computer changed (work started meanwhile,
      // or no answer in time), so show what it serves now.
      void queryClient.invalidateQueries({
        queryKey: modelSourceQueryKey(tenantId, computerId),
      });
      if (
        error instanceof TeamHubError &&
        error.code === "AGENT_HAS_ACTIVE_RUNS"
      )
        setBusy({
          agents: (error.details ?? []).map((detail) => detail.reason),
          body,
        });
    },
    onMutate: () => setNotice(null),
    onSuccess: (view) => {
      queryClient.setQueryData(modelSourceQueryKey(tenantId, computerId), view);
      setNotice(switchedNotice(view));
      setSaveRevision((current) => current + 1);
      void Promise.all([
        queryClient.invalidateQueries({
          queryKey: tenantLocalModelsQueryKey(tenantId),
        }),
        queryClient.invalidateQueries({
          queryKey: localComputersQueryKey(tenantId),
        }),
        queryClient.invalidateQueries({
          queryKey: tenantAgentsQueryKey(tenantId),
        }),
        queryClient.invalidateQueries({
          queryKey: tenantAgentAvailabilityQueryKey(tenantId),
        }),
      ]);
    },
  });
  const failureCode =
    mutation.error instanceof TeamHubError ? mutation.error.code : undefined;
  const switcher: ModelSourceSwitcher = {
    clearFeedback: () => {
      setNotice(null);
      if (mutation.isError) mutation.reset();
    },
    failure:
      mutation.isError && failureCode !== "AGENT_HAS_ACTIVE_RUNS"
        ? modelSourceErrorCopy(failureCode)
        : undefined,
    pending: mutation.isPending ? mutation.variables : undefined,
    request: (body) => mutation.mutate(body),
    saveRevision,
  };
  const feedback = (
    <>
      {notice ? (
        <div className="mt-4">
          <FormFeedback tone="success">{notice}</FormFeedback>
        </div>
      ) : null}
      {busy ? (
        <TerminateTasksDialog
          agents={busy.agents}
          computerName={computerName}
          onClose={() => setBusy(null)}
          onConfirm={() => {
            mutation.mutate({ ...busy.body, force_terminate: true });
            setBusy(null);
          }}
        />
      ) : null}
    </>
  );
  return { feedback, switcher };
}

function switchedNotice(view: ModelSourceView) {
  if (!view.status) return "Switched.";
  const updated = view.updated_agent_count ?? 0;
  const ended = view.terminated_run_count ?? 0;
  const parts = [`Agents now use ${activeSourceLabel(view.status)}.`];
  if (updated)
    parts.push(
      `${updated} ${updated === 1 ? "Agent was" : "Agents were"} moved.`,
    );
  if (ended)
    parts.push(`${ended} ${ended === 1 ? "task was" : "tasks were"} ended.`);
  return parts.join(" ");
}

function TerminateTasksDialog({
  agents,
  computerName,
  onClose,
  onConfirm,
}: {
  agents: string[];
  computerName: string;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const names = agents.length ? agents.join(", ") : "Some Agents";
  return (
    <ModalDialog
      description={`${names} ${agents.length === 1 ? "is" : "are"} working on tasks on ${computerName}. Switching now ends those tasks; they can't be resumed.`}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button onClick={onConfirm} tone="danger">
            Terminate tasks & Switch
          </Button>
        </>
      }
      onClose={onClose}
      size="md"
      title="End running tasks?"
    >
      <p className="px-5 py-4 text-sm text-muted-foreground">
        To keep them, wait until they finish and switch then.
      </p>
    </ModalDialog>
  );
}

/** The offered model sources as tabs; a dot marks the one in use. */
export function ModelSourceTabs({
  active,
  onChange,
  value,
}: {
  active: ModelSourceMode;
  onChange: (mode: ModelSourceMode) => void;
  value: ModelSourceMode;
}) {
  return (
    <div
      aria-label="Model source"
      className="mt-6 inline-flex self-start rounded-lg bg-muted p-0.5"
      role="tablist"
    >
      {modes.map((mode) => {
        const tab = (
          <button
            aria-selected={mode === value}
            className={cn(
              "inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-sm transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none",
              mode === value
                ? "bg-background text-foreground shadow-xs"
                : "text-muted-foreground hover:text-foreground",
            )}
            key={mode}
            onClick={() => onChange(mode)}
            role="tab"
            type="button"
          >
            {mode === active ? (
              <span
                aria-label="In use"
                className="size-1.5 rounded-full bg-app-success"
                role="img"
              />
            ) : null}
            {modelSourceModeLabels[mode]}
          </button>
        );
        return mode === "byok" ? (
          <Hint key={mode} placement="top" text={byokExplanation}>
            {tab}
          </Hint>
        ) : (
          tab
        );
      })}
    </div>
  );
}

/** Offered above the library while the Agents use another source. */
export function SwitchToLocalNotice({
  disabled,
  models,
  switcher,
}: {
  disabled: boolean;
  models: readonly LocalModel[];
  switcher: ModelSourceSwitcher;
}) {
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined);
  const chosen =
    (selectedId
      ? models.find((model) => model.id === selectedId)
      : undefined) ?? models[0];
  const single = models.length === 1 ? models[0] : undefined;

  return (
    <div className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-muted px-4 py-3">
      <p className="min-w-0 flex-1 text-sm text-muted-foreground">
        {single ? (
          <>
            <span className="text-foreground">{single.name}</span> is on this
            computer and can run your Agents locally.
          </>
        ) : models.length > 1 ? (
          "Choose a model on this computer to run your Agents locally."
        ) : (
          "Download a model below to run your Agents locally."
        )}
      </p>
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        {models.length > 1 && chosen ? (
          <Select
            aria-label="Local model"
            onValueChange={setSelectedId}
            value={chosen.id}
            variant="pill"
          >
            {models.map((model) => (
              <SelectItem key={model.id} value={model.id}>
                {model.name} ·{" "}
                {model.state === "loaded" ? "Loaded" : "Downloaded"} ·{" "}
                {formatGigabytes(model.memory_bytes)}
              </SelectItem>
            ))}
          </Select>
        ) : null}
        <Button
          disabled={disabled || !chosen}
          loading={switcher.pending?.mode === "local"}
          onClick={() =>
            chosen &&
            switcher.request({ local_model_id: chosen.id, mode: "local" })
          }
          size="compact"
          tone="primary"
        >
          Switch to Local model
        </Button>
      </div>
    </div>
  );
}
