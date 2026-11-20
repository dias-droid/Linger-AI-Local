import {
  AlertCircleIcon,
  Cancel01Icon,
  CheckmarkCircle02Icon,
  RefreshIcon,
} from "@hugeicons/core-free-icons";
import { useMutation } from "@tanstack/react-query";
import {
  type CSSProperties,
  type FormEvent,
  type ReactNode,
  useEffect,
  useEffectEvent,
  useId,
  useRef,
  useState,
} from "react";

import { Button } from "@/components/ui/button";
import { fieldControlClassName } from "@/components/ui/field";
import { Icon } from "@/components/ui/icon";
import { Select, SelectItem } from "@/components/ui/select";
import { TeamHubError } from "@/features/teamhub/teamhub-error";
import { useTeamHubRuntime } from "@/features/teamhub/teamhub-runtime";
import { cn } from "@/lib/cn";

import { ByokCombobox } from "./byok-combobox";
import {
  byokContextLabel,
  byokEndpointSuggestions,
  byokPathSuggestions,
  byokProtocolFor,
  DEFAULT_BYOK_PATH,
  defaultByokEndpoint,
  normalizeByokBaseUrl,
  normalizeByokPath,
  validByokPath,
} from "./byok-endpoint";
import {
  byokFailureCopy,
  byokProtocolLabels,
  modelSourceRuntimeLabels,
} from "./local-models-copy";
import type { ModelSourceSwitcher } from "./model-source-panel";
import {
  type ByokEndpointInput,
  type ByokInput,
  type ByokTestRequest,
  listByokModels,
  type ModelSourceRuntime,
  type ModelSourceStatus,
  testByokEndpoint,
} from "./model-source-queries";

const byokRuntimes: readonly ModelSourceRuntime[] = ["claude", "codex", "pi"];

type ByokMenu = "endpoint" | "model" | "path";

function sameEndpointOrigin(savedUrl: string | undefined, nextUrl: string) {
  const trimmedSaved = savedUrl?.trim();
  const trimmedNext = nextUrl.trim();
  if (!trimmedSaved || !trimmedNext) return false;
  if (trimmedSaved === trimmedNext) return true;
  try {
    return new URL(trimmedSaved).origin === new URL(trimmedNext).origin;
  } catch {
    return false;
  }
}

/** A path or endpoint box sized to its value, at full width when stacked. */
function fittedWidth(value: string): CSSProperties {
  return {
    "--byok-fit": `${Math.max(value.length, 1) + 1}ch`,
  } as CSSProperties;
}

const failureCopy = (error: unknown) =>
  error instanceof TeamHubError
    ? byokFailureCopy(error.code, error.message)
    : byokFailureCopy(undefined, "");

/**
 * The person's own endpoint, addressed as base URL + path + endpoint. The API
 * key goes to the Computer, which keeps it private; Linger never shows it
 * again.
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
  const savedRuntime = status.mode === "byok" ? status.runtime : "claude";
  const [runtime, setRuntime] = useState<ModelSourceRuntime>(savedRuntime);
  const [baseUrl, setBaseUrl] = useState(saved.base_url ?? "");
  // A saved endpoint reports an empty path or endpoint by leaving it out.
  const [path, setPath] = useState(
    saved.configured ? (saved.path ?? "") : DEFAULT_BYOK_PATH,
  );
  // null follows the Runtime's default endpoint.
  const [endpoint, setEndpoint] = useState<string | null>(() => {
    const value = saved.configured ? (saved.endpoint ?? "") : null;
    return value === defaultByokEndpoint(savedRuntime) ? null : value;
  });
  const [apiKey, setApiKey] = useState("");
  const [modelId, setModelId] = useState(saved.model_id ?? "");
  const [menu, setMenu] = useState<ByokMenu | null>(null);
  const [toastShown, setToastShown] = useState(false);
  const ids = useId();

  const base = normalizeByokBaseUrl(baseUrl);
  const pathValue = normalizeByokPath(path);
  const runtimeEndpoint = defaultByokEndpoint(runtime);
  const endpointValue = normalizeByokPath(endpoint ?? runtimeEndpoint);
  const requestUrl = `${base}${pathValue}${endpointValue}`;
  const modelsUrl = `${base}${pathValue}/models`;
  const format = byokProtocolFor(requestUrl, runtime);
  const addressValid = validByokPath(pathValue) && validByokPath(endpointValue);
  // Never reuse a saved key when the owner points BYOK at a different host.
  const canReuseSavedKey =
    saved.key_saved &&
    (!saved.base_url || sameEndpointOrigin(saved.base_url, base));
  const address: ByokEndpointInput = {
    base_url: base,
    endpoint: endpointValue,
    path: pathValue,
    protocol: format.protocol,
    ...(apiKey
      ? { api_key: apiKey }
      : canReuseSavedKey
        ? { reuse_saved_key: true }
        : {}),
  };
  const input: ByokInput = { ...address, model_id: modelId.trim() };
  // The Computer decides whether the endpoint needs a key: one on this
  // computer or the local network may have none.
  const complete = base !== "" && input.model_id !== "" && addressValid;
  const active = status.mode === "byok";

  const models = useMutation({
    mutationFn: (body: ByokEndpointInput) =>
      listByokModels(client, tenantId, computerId, body),
  });
  const test = useMutation({
    mutationFn: (body: ByokTestRequest) =>
      testByokEndpoint(client, tenantId, computerId, body),
  });
  const listed = models.data?.models ?? [];
  const modelOptions = listed.map((model) => ({
    detail:
      [
        model.name,
        model.context_window
          ? byokContextLabel(model.context_window)
          : undefined,
      ]
        .filter(Boolean)
        .join(" · ") || undefined,
    value: model.id,
  }));
  const modelHint = models.isPending
    ? `Listing models from ${modelsUrl}…`
    : models.isError
      ? failureCopy(models.error)
      : models.data
        ? `${listed.length} ${listed.length === 1 ? "model" : "models"} listed from ${models.data.url}.`
        : "List the endpoint's models, or type an ID.";

  // Changing the address or key makes listed models and a test result stale;
  // changing only the endpoint, model or Runtime keeps the listed models.
  function resetTest() {
    test.reset();
    setToastShown(false);
  }
  function resetAll() {
    models.reset();
    resetTest();
  }

  function save(event: FormEvent) {
    event.preventDefault();
    switcher.request({ byok: input, mode: "byok", runtime });
  }

  const sendsHow = format.fromUrl
    ? byokProtocolLabels[format.protocol]
    : `${byokProtocolLabels[format.protocol]} (the ${modelSourceRuntimeLabels[runtime]} format)`;
  const addressHintId = `${ids}-address-hint`;
  const modelHintId = `${ids}-model-hint`;

  return (
    <form
      aria-label="BYOK"
      className="mt-6 rounded-xl border border-border"
      onSubmit={save}
    >
      <div className="grid grid-cols-1 gap-4 px-4 py-4">
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
              resetTest();
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
        <fieldset className="min-w-0">
          <legend className="mb-1.5 text-sm font-medium text-foreground">
            API address
          </legend>
          <div className="grid grid-cols-2 gap-x-1.5 gap-y-2 sm:grid-cols-[minmax(0,1fr)_auto_auto]">
            <div className="col-span-2 min-w-0 sm:col-span-1">
              <AddressLabel htmlFor={`${ids}-base`}>Base URL</AddressLabel>
              <input
                aria-describedby={addressHintId}
                autoComplete="off"
                className={fieldControlClassName}
                disabled={disabled}
                id={`${ids}-base`}
                onBlur={() => setBaseUrl(normalizeByokBaseUrl)}
                onChange={(event) => {
                  setBaseUrl(event.target.value);
                  resetAll();
                }}
                placeholder="https://api.example.com"
                inputMode="url"
                spellCheck={false}
                value={baseUrl}
              />
            </div>
            <div className="min-w-0">
              <AddressLabel htmlFor={`${ids}-path`}>Path</AddressLabel>
              <ByokCombobox
                aria-describedby={addressHintId}
                aria-invalid={!validByokPath(pathValue)}
                className="sm:w-max"
                disabled={disabled}
                filled={path === DEFAULT_BYOK_PATH}
                heading="Path · optional"
                menuClassName="-left-px sm:left-auto sm:-right-px"
                id={`${ids}-path`}
                inputClassName="font-mono text-[13px] sm:w-(--byok-fit) sm:flex-none"
                inputStyle={fittedWidth(path)}
                label="Path"
                onCommit={() => setPath(normalizeByokPath)}
                onOpenChange={(open) => setMenu(open ? "path" : null)}
                onValueChange={(value) => {
                  setPath(value);
                  resetAll();
                }}
                open={menu === "path"}
                options={byokPathSuggestions.map((option) => ({
                  detail:
                    option.value === DEFAULT_BYOK_PATH
                      ? `${option.label} · Default`
                      : option.label,
                  value: option.value,
                }))}
                placeholder="-"
                value={path}
              />
            </div>
            <div className="min-w-0">
              <AddressLabel htmlFor={`${ids}-endpoint`}>Endpoint</AddressLabel>
              <ByokCombobox
                aria-describedby={addressHintId}
                aria-invalid={!validByokPath(endpointValue)}
                className="sm:w-max"
                disabled={disabled}
                filled={endpoint === null}
                heading="Endpoint · optional"
                menuClassName="-right-px"
                id={`${ids}-endpoint`}
                inputClassName="font-mono text-[13px] sm:w-(--byok-fit) sm:flex-none"
                inputStyle={fittedWidth(endpoint ?? runtimeEndpoint)}
                label="Endpoint"
                onCommit={() =>
                  setEndpoint((current) => {
                    if (current === null) return null;
                    const value = normalizeByokPath(current);
                    return value === runtimeEndpoint ? null : value;
                  })
                }
                onOpenChange={(open) => setMenu(open ? "endpoint" : null)}
                onValueChange={(value) => {
                  setEndpoint(value === runtimeEndpoint ? null : value);
                  resetTest();
                }}
                open={menu === "endpoint"}
                options={byokEndpointSuggestions.map((option) => ({
                  detail: option.protocol
                    ? option.value === runtimeEndpoint
                      ? `${byokProtocolLabels[option.protocol]} · ${modelSourceRuntimeLabels[runtime]} default`
                      : byokProtocolLabels[option.protocol]
                    : "No endpoint. The base URL is the full address.",
                  value: option.value,
                }))}
                placeholder="-"
                value={endpoint ?? runtimeEndpoint}
              />
            </div>
          </div>
          <div
            className="mt-1.5 grid gap-0.5 text-xs text-muted-foreground"
            id={addressHintId}
          >
            <p>
              Base URL from your provider&apos;s docs. Path and endpoint are
              optional: pick one, type your own, or clear it.
            </p>
            {!addressValid ? (
              <p className="text-destructive">
                Path and endpoint take segments like /v1, without spaces, ?, #
                or \.
              </p>
            ) : base ? (
              <p>
                Sends {sendsHow} requests to <Url>{requestUrl}</Url>
              </p>
            ) : null}
          </div>
        </fieldset>
        <div>
          <label
            className="mb-1.5 block text-sm font-medium text-foreground"
            htmlFor={`${ids}-key`}
          >
            API key
          </label>
          <input
            aria-describedby={`${ids}-key-hint`}
            autoComplete="new-password"
            className={fieldControlClassName}
            disabled={disabled}
            id={`${ids}-key`}
            onChange={(event) => {
              setApiKey(event.target.value);
              resetAll();
            }}
            type="password"
            value={apiKey}
          />
          <p
            className="mt-1.5 text-xs text-muted-foreground"
            id={`${ids}-key-hint`}
          >
            {canReuseSavedKey
              ? "A key is saved on this computer. Leave blank to keep it."
              : "Optional for an endpoint on this computer or your local network."}
          </p>
        </div>
        <div>
          <label
            className="mb-1.5 block text-sm font-medium text-foreground"
            htmlFor={`${ids}-model`}
          >
            Model
          </label>
          <div className="relative flex gap-1.5">
            <ByokCombobox
              aria-describedby={modelHintId}
              className="min-w-0 flex-1"
              disabled={disabled}
              id={`${ids}-model`}
              label="Model"
              note={modelOptions.length ? undefined : modelHint}
              onCommit={() => setModelId((current) => current.trim())}
              onOpenChange={(open) => setMenu(open ? "model" : null)}
              onValueChange={(value) => {
                setModelId(value);
                resetTest();
              }}
              open={menu === "model"}
              options={modelOptions}
              placeholder="provider/model-name"
              value={modelId}
            />
            <Button
              aria-label="List models"
              disabled={disabled || base === "" || !addressValid}
              loading={models.isPending}
              onClick={() =>
                models.mutate(address, { onSuccess: () => setMenu("model") })
              }
              size="large"
              title="List models"
            >
              {models.isPending ? null : <Icon icon={RefreshIcon} size={16} />}
            </Button>
            <Button
              disabled={disabled || !complete}
              loading={test.isPending}
              onClick={() => {
                setToastShown(false);
                test.mutate(
                  { byok: input },
                  { onSettled: () => setToastShown(true) },
                );
              }}
              size="large"
            >
              Test
            </Button>
            {toastShown && test.isSuccess ? (
              <TestToast
                onDismiss={() => setToastShown(false)}
                title="Connected"
                tone="success"
              >
                {test.data.model_id} ·{" "}
                {byokContextLabel(test.data.context_window)} ·{" "}
                {byokProtocolLabels[test.data.protocol]}
                <br />
                <Url>{test.data.url}</Url>
              </TestToast>
            ) : null}
            {toastShown && test.isError ? (
              <TestToast
                onDismiss={() => setToastShown(false)}
                title="Couldn't connect"
                tone="danger"
              >
                {failureCopy(test.error)}
              </TestToast>
            ) : null}
          </div>
          <p
            className={cn(
              "mt-1.5 text-xs [overflow-wrap:anywhere]",
              models.isError ? "text-destructive" : "text-muted-foreground",
            )}
            id={modelHintId}
          >
            {modelHint}
          </p>
        </div>
      </div>
      <footer className="flex flex-wrap items-center justify-end gap-2 rounded-b-xl border-t border-border bg-muted/40 px-4 py-3">
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

function AddressLabel({
  children,
  htmlFor,
}: {
  children: ReactNode;
  htmlFor: string;
}) {
  return (
    <label
      className="mb-1 block text-xs font-medium text-muted-foreground"
      htmlFor={htmlFor}
    >
      {children}
    </label>
  );
}

function Url({ children }: { children: string }) {
  return (
    <span className="font-mono text-[0.95em] [overflow-wrap:anywhere]">
      {children}
    </span>
  );
}

/**
 * A test result floating under the Test button. A success fades on its own
 * unless the pointer rests on it; a failure stays until dismissed, a click
 * elsewhere, or a changed input. A click on Test replaces it.
 */
function TestToast({
  children,
  onDismiss,
  title,
  tone,
}: {
  children: ReactNode;
  onDismiss: () => void;
  title: string;
  tone: "danger" | "success";
}) {
  const toastRef = useRef<HTMLDivElement>(null);
  const [leaving, setLeaving] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [fadeAfter, setFadeAfter] = useState(3500);
  const dismiss = useEffectEvent(onDismiss);

  useEffect(() => {
    if (leaving) {
      const timer = setTimeout(dismiss, 200);
      return () => clearTimeout(timer);
    }
    if (tone !== "success" || hovered) return undefined;
    const timer = setTimeout(() => setLeaving(true), fadeAfter);
    return () => clearTimeout(timer);
  }, [fadeAfter, hovered, leaving, tone]);

  useEffect(() => {
    const leaveOnOutsideClick = (event: PointerEvent) => {
      if (!toastRef.current?.contains(event.target as Node)) setLeaving(true);
    };
    document.addEventListener("pointerdown", leaveOnOutsideClick);
    return () =>
      document.removeEventListener("pointerdown", leaveOnOutsideClick);
  }, []);

  return (
    <div
      className={cn(
        "absolute right-0 top-full z-40 mt-2 grid w-[min(22rem,100%)] grid-cols-[16px_minmax(0,1fr)_20px] items-start gap-2 rounded-lg bg-primary py-2.5 pl-3 pr-2 text-left text-xs text-primary-foreground/80 shadow-lg before:absolute before:-top-1 before:right-6 before:size-2.5 before:rotate-45 before:rounded-[2px] before:bg-primary before:content-[''] motion-reduce:animate-none",
        leaving
          ? "animate-[town-dropdown-out_200ms_ease_both]"
          : "animate-[town-dropdown-in_var(--app-floating-duration)_ease_both]",
      )}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => {
        setHovered(false);
        setFadeAfter(1500);
      }}
      ref={toastRef}
      role={tone === "success" ? "status" : "alert"}
    >
      <Icon
        className={cn(
          "mt-px",
          tone === "success" ? "text-app-success" : "text-destructive",
        )}
        icon={tone === "success" ? CheckmarkCircle02Icon : AlertCircleIcon}
        size={16}
      />
      <div className="min-w-0">
        <p className="text-[13px] font-medium text-primary-foreground">
          {title}
        </p>
        <p className="mt-0.5 [overflow-wrap:anywhere]">{children}</p>
      </div>
      <button
        aria-label="Dismiss"
        className="grid size-5 place-items-center rounded-sm text-primary-foreground/60 transition-colors hover:bg-primary-foreground/10 hover:text-primary-foreground"
        onClick={() => setLeaving(true)}
        type="button"
      >
        <Icon icon={Cancel01Icon} size={14} />
      </button>
    </div>
  );
}
