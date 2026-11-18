import { RefreshIcon } from "@hugeicons/core-free-icons";
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { type FormEvent, type ReactNode, useId, useState } from "react";

import { Button } from "@/components/ui/button";
import { Field, fieldControlClassName } from "@/components/ui/field";
import { FormFeedback } from "@/components/ui/form-feedback";
import { Icon } from "@/components/ui/icon";
import { ModalDialog } from "@/components/ui/modal-dialog";
import { Select, SelectItem } from "@/components/ui/select";
import { Hint } from "@/features/local-computer/computer-hint";
import { localComputersQueryKey } from "@/features/local-computer/local-computer-queries";
import { TeamHubError } from "@/features/teamhub/teamhub-error";
import { useTeamHubRuntime } from "@/features/teamhub/teamhub-runtime";
import type { TeamHubLocalComputerPage } from "@/features/teamhub/teamhub-types";
import { cn } from "@/lib/cn";

import {
  byokProtocolLabels,
  modelSourceErrorCopy,
  modelSourceModeLabels,
  modelSourceRuntimeLabels,
} from "./local-models-copy";
import { tenantLocalModelsQueryKey } from "./local-models-queries";
import { contextLabel } from "./local-models-rules";
import {
  type ByokInput,
  type ByokModel,
  type ByokTestRequest,
  byokModelsQueryOptions,
  type ModelSourceMode,
  type ModelSourceRuntime,
  type ModelSourceStatus,
  type ModelSourceSwitchRequest,
  type ModelSourceView,
  modelSourceQueryKey,
  switchModelSource,
  testByokEndpoint,
} from "./model-source-queries";

type LocalComputerRuntime =
  TeamHubLocalComputerPage["items"][number]["runtimes"][number];

const modes: readonly ModelSourceMode[] = ["local", "subscription", "byok"];
const subscriptionRuntimes = ["claude", "codex"] as const;
const byokRuntimes: readonly ModelSourceRuntime[] = ["claude", "codex", "pi"];

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

interface ModelSourceSwitcher {
  failure: string | undefined;
  pending: ModelSourceSwitchRequest | undefined;
  request: (body: ModelSourceSwitchRequest) => void;
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
      void queryClient.invalidateQueries({
        queryKey: tenantLocalModelsQueryKey(tenantId),
      });
      void queryClient.invalidateQueries({
        queryKey: localComputersQueryKey(tenantId),
      });
    },
  });
  const failureCode =
    mutation.error instanceof TeamHubError ? mutation.error.code : undefined;
  const switcher: ModelSourceSwitcher = {
    failure:
      mutation.isError && failureCode !== "AGENT_HAS_ACTIVE_RUNS"
        ? modelSourceErrorCopy(failureCode)
        : undefined,
    pending: mutation.isPending ? mutation.variables : undefined,
    request: (body) => mutation.mutate(body),
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

/** The three model sources as tabs; a dot marks the one in use. */
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
      className="mt-6 inline-flex rounded-lg bg-muted p-0.5"
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
          <Hint key={mode} placement="bottom" text={byokExplanation}>
            {tab}
          </Hint>
        ) : (
          tab
        );
      })}
    </div>
  );
}

function Panel({ children, title }: { children: ReactNode; title: string }) {
  return (
    <section
      aria-label={title}
      className="mt-6 rounded-xl border border-border px-4 py-4"
    >
      {children}
    </section>
  );
}

/** Offered above the library while the Agents use another source. */
export function SwitchToLocalNotice({
  disabled,
  modelId,
  modelName,
  switcher,
}: {
  disabled: boolean;
  modelId: string | undefined;
  modelName: string | undefined;
  switcher: ModelSourceSwitcher;
}) {
  return (
    <div className="mt-6 flex items-center justify-between gap-4 rounded-xl bg-muted px-4 py-3">
      <p className="text-sm text-muted-foreground">
        {modelName ? (
          <>
            <span className="text-foreground">{modelName}</span> is on this
            computer and can run your Agents locally.
          </>
        ) : (
          "Download a model below to run your Agents locally."
        )}
      </p>
      <Button
        disabled={disabled || !modelId}
        loading={switcher.pending?.mode === "local"}
        onClick={() =>
          switcher.request({ local_model_id: modelId, mode: "local" })
        }
        size="compact"
        tone="primary"
      >
        Switch to Local model
      </Button>
    </div>
  );
}

const runtimeStateCopy: Partial<
  Record<LocalComputerRuntime["status"], string>
> = {
  authentication_required: "Signed out",
  not_installed: "Not installed",
  ready: "Signed in",
};

/** Claude Code and Codex on the person's own subscription accounts. */
export function SubscriptionPanel({
  disabled,
  runtimes,
  status,
  switcher,
}: {
  disabled: boolean;
  runtimes: readonly LocalComputerRuntime[];
  status: ModelSourceStatus;
  switcher: ModelSourceSwitcher;
}) {
  return (
    <Panel title="Subscription">
      <ul className="grid gap-3">
        {subscriptionRuntimes.map((runtime) => {
          const active =
            status.mode === "subscription" && status.runtime === runtime;
          // Off subscription, the Computer checks Runtimes against the
          // gateway, so their sign-in state is only known while active.
          const state =
            status.mode === "subscription"
              ? runtimeStateCopy[
                  runtimes.find((item) => item.type === runtime)?.status ??
                    "not_installed"
                ]
              : undefined;
          return (
            <li
              className="flex items-center justify-between gap-4"
              key={runtime}
            >
              <div className="min-w-0">
                <p className="text-sm text-foreground">
                  {modelSourceRuntimeLabels[runtime]}
                  {active ? (
                    <span className="ml-2 text-xs text-app-success">
                      In use
                    </span>
                  ) : null}
                </p>
                <p className="text-xs text-muted-foreground">
                  {state ? `${state} · ` : ""}
                  {runtime === "claude"
                    ? "Anthropic account on this computer"
                    : "ChatGPT account on this computer"}
                </p>
              </div>
              {active ? null : (
                <Button
                  disabled={disabled}
                  loading={
                    switcher.pending?.mode === "subscription" &&
                    switcher.pending.runtime === runtime
                  }
                  onClick={() =>
                    switcher.request({ mode: "subscription", runtime })
                  }
                  size="compact"
                >
                  Switch to {modelSourceRuntimeLabels[runtime]}
                </Button>
              )}
            </li>
          );
        })}
      </ul>
      <p className="mt-4 text-xs text-muted-foreground">
        Switching to a subscription unloads local models to free memory; their
        files stay on disk.
      </p>
    </Panel>
  );
}

/** A listed model: its ID, then its name and context window when known. */
function ByokModelOption({ model }: { model: ByokModel }) {
  const details = [
    model.name,
    model.context_window ? contextLabel(model.context_window) : undefined,
  ].filter(Boolean);
  return (
    <>
      {details.length ? `${model.id} ` : model.id}
      {details.length ? (
        <span className="ml-1 text-xs text-muted-foreground">
          {details.join(" · ")}
        </span>
      ) : null}
    </>
  );
}

/**
 * The person's own endpoint. The API key goes to the Computer, which keeps
 * it private; Linger never shows it again.
 */
export function ByokPanel({
  computerId,
  disabled,
  status,
  switcher,
  tenantId,
}: {
  computerId: string;
  disabled: boolean;
  status: ModelSourceStatus;
  switcher: ModelSourceSwitcher;
  tenantId: string;
}) {
  const { client } = useTeamHubRuntime();
  const saved = status.byok;
  const [runtime, setRuntime] = useState<ModelSourceRuntime>(
    status.mode === "byok" ? status.runtime : "claude",
  );
  const [baseUrl, setBaseUrl] = useState(saved.base_url ?? "");
  const [apiKey, setApiKey] = useState("");
  // Starts empty until a model is saved, then shows the saved one.
  const [modelId, setModelId] = useState(saved.model_id ?? "");
  // Models are listed for the address and key as they stand when a field is
  // left, not on every keystroke.
  const [listed, setListed] = useState({
    baseUrl: saved.base_url ?? "",
    keyRevision: 0,
  });
  const [keyEdited, setKeyEdited] = useState(false);
  const credentials = apiKey
    ? { api_key: apiKey }
    : saved.key_saved
      ? { reuse_saved_key: true }
      : {};
  const input: ByokInput = {
    base_url: baseUrl.trim(),
    model_id: modelId.trim(),
    ...credentials,
  };
  const models = useQuery({
    ...byokModelsQueryOptions(
      client,
      tenantId,
      computerId,
      { base_url: listed.baseUrl, ...credentials },
      listed.keyRevision,
    ),
    // A refresh keeps the current choices on screen until the new list lands.
    placeholderData: keepPreviousData,
  });
  const listedModels = models.data?.models ?? [];
  // A saved or typed ID the endpoint does not list stays choosable.
  const modelOptions =
    input.model_id === "" ||
    listedModels.some((model) => model.id === input.model_id)
      ? listedModels
      : [{ id: input.model_id }, ...listedModels];
  const modelControlId = useId();
  const modelHintId = `${modelControlId}-hint`;
  const modelHint = models.isFetching
    ? "Listing the endpoint's models…"
    : models.isError
      ? "The endpoint didn't list its models. Type the model ID."
      : listedModels.length
        ? `${listedModels.length} ${listedModels.length === 1 ? "model" : "models"} listed.`
        : undefined;
  // The Computer decides whether the endpoint needs a key: one on this
  // computer or the local network may have none.
  const complete = input.base_url !== "" && input.model_id !== "";
  const test = useMutation({
    mutationFn: (body: ByokTestRequest) =>
      testByokEndpoint(client, tenantId, computerId, body),
  });
  const active = status.mode === "byok";

  function save(event: FormEvent) {
    event.preventDefault();
    switcher.request({ byok: input, mode: "byok", runtime });
  }

  function listModels() {
    setKeyEdited(false);
    setListed((current) => ({
      baseUrl: input.base_url,
      keyRevision: current.keyRevision + 1,
    }));
  }

  return (
    <form
      aria-label="BYOK"
      className="mt-6 overflow-hidden rounded-xl border border-border"
      onSubmit={save}
    >
      <div className="grid grid-cols-1 gap-4 px-4 py-4">
        {active && saved.protocol ? (
          <p className="text-xs text-muted-foreground">
            In use, through {byokProtocolLabels[saved.protocol]}.
          </p>
        ) : null}
        <div>
          <p className="mb-1.5 text-sm font-medium text-foreground">
            AI runtime
          </p>
          <Select
            aria-label="AI runtime"
            className="w-full"
            disabled={disabled}
            onValueChange={(value) => {
              setRuntime(value as ModelSourceRuntime);
              // The runtime decides which API format is tried first.
              test.reset();
            }}
            value={runtime}
          >
            {byokRuntimes.map((item) => (
              <SelectItem key={item} value={item}>
                {modelSourceRuntimeLabels[item]}
              </SelectItem>
            ))}
          </Select>
        </div>
        <Field
          autoComplete="off"
          disabled={disabled}
          label="Base URL"
          onBlur={() =>
            setListed((current) =>
              current.baseUrl === input.base_url
                ? current
                : { ...current, baseUrl: input.base_url },
            )
          }
          onChange={(event) => setBaseUrl(event.target.value)}
          placeholder="https://api.example.com/v1"
          spellCheck={false}
          value={baseUrl}
        />
        <Field
          autoComplete="new-password"
          disabled={disabled}
          hint={
            saved.key_saved
              ? "A key is saved on this computer. Leave blank to keep it."
              : "Optional for an endpoint on this computer or your local network."
          }
          label="API key"
          onBlur={() => {
            if (!keyEdited) return;
            setKeyEdited(false);
            setListed((current) => ({
              ...current,
              keyRevision: current.keyRevision + 1,
            }));
          }}
          onChange={(event) => {
            setApiKey(event.target.value);
            setKeyEdited(true);
          }}
          type="password"
          value={apiKey}
        />
        <div>
          <label
            className="mb-1.5 block text-sm font-medium text-foreground"
            htmlFor={modelControlId}
          >
            Model
          </label>
          <div className="flex gap-2">
            <div className="min-w-0 flex-1">
              {listedModels.length ? (
                <Select
                  aria-describedby={modelHint ? modelHintId : undefined}
                  aria-label="Model"
                  className="w-full"
                  disabled={disabled}
                  id={modelControlId}
                  onValueChange={(value) => {
                    setModelId(value);
                    test.reset();
                  }}
                  placeholder="Choose a model"
                  value={input.model_id}
                >
                  {modelOptions.map((model) => (
                    <SelectItem key={model.id} value={model.id}>
                      <ByokModelOption model={model} />
                    </SelectItem>
                  ))}
                </Select>
              ) : (
                <input
                  aria-describedby={modelHint ? modelHintId : undefined}
                  autoComplete="off"
                  className={fieldControlClassName}
                  disabled={disabled}
                  id={modelControlId}
                  onChange={(event) => setModelId(event.target.value)}
                  placeholder="provider/model-name"
                  spellCheck={false}
                  value={modelId}
                />
              )}
            </div>
            <Button
              disabled={disabled || input.base_url === ""}
              loading={models.isFetching}
              onClick={listModels}
              size="large"
            >
              {models.isFetching ? null : <Icon icon={RefreshIcon} size={16} />}
              List models
            </Button>
          </div>
          {modelHint ? (
            <p
              className="mt-1.5 text-xs text-muted-foreground"
              id={modelHintId}
            >
              {modelHint}
            </p>
          ) : null}
        </div>
        {test.isSuccess ? (
          <FormFeedback tone="success">
            Connected to {test.data.base_url} through{" "}
            {byokProtocolLabels[test.data.protocol]}. {test.data.model_id} has{" "}
            {contextLabel(test.data.context_window)} of context.
          </FormFeedback>
        ) : null}
        {test.isError ? (
          <FormFeedback tone="danger">
            {modelSourceErrorCopy(
              test.error instanceof TeamHubError ? test.error.code : undefined,
            )}
          </FormFeedback>
        ) : null}
      </div>
      <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-border bg-muted/40 px-4 py-3">
        <Button
          disabled={disabled || !complete}
          loading={test.isPending}
          onClick={() => test.mutate({ byok: input, runtime })}
          size="large"
        >
          Test connection
        </Button>
        <Button
          disabled={disabled || !complete}
          loading={switcher.pending?.mode === "byok"}
          size="large"
          tone="primary"
          type="submit"
        >
          {active ? "Save" : "Save & Switch to BYOK"}
        </Button>
      </footer>
    </form>
  );
}
