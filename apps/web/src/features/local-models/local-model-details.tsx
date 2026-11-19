import { useState, type ReactNode } from "react";
import {
  Copy01Icon,
  LinkSquare02Icon,
  Tick02Icon,
} from "@hugeicons/core-free-icons";

import { Button } from "@/components/ui/button";
import { FormFeedback } from "@/components/ui/form-feedback";
import { Icon } from "@/components/ui/icon";
import { ModalDialog } from "@/components/ui/modal-dialog";
import { cn } from "@/lib/cn";

import {
  capabilityCopy,
  modelErrorCopy,
  modelNoteCopy,
  unavailableCopy,
} from "./local-models-copy";
import type { LocalModelPool, LocalModelsView } from "./local-models-queries";
import {
  agentNames,
  contextLabel,
  downloadStopped,
  formatGigabytes,
  isModelOnComputer,
  modelCapabilities,
  modelSourceLabel,
  parametersLabel,
  placeName,
  poolFreeBytes,
  poolLabel,
  poolOf,
  poolOtherBytes,
  safeModelSourceUrl,
  speedLabel,
  type ModelEntry,
} from "./local-models-rules";

/** Category colors from the Nature palette, one per model holding memory. */
const segmentColors = ["bg-rain-500", "bg-lichen-500", "bg-sun-500"] as const;
/** Foundation components hold memory too, but are not models of the list. */
const componentColor = "bg-muted-foreground/40";

function Fact({
  bordered = true,
  children,
  className,
  label,
}: {
  bordered?: boolean;
  children: ReactNode;
  className?: string;
  label: string;
}) {
  return (
    <div
      className={cn(
        "flex min-h-9 items-center gap-3 py-1.5 text-sm",
        bordered && "border-t border-border/70",
        className,
      )}
    >
      <span className="w-28 shrink-0 text-muted-foreground">{label}</span>
      <span className="min-w-0 flex-1 tabular-nums text-foreground">
        {children}
      </span>
    </div>
  );
}

function CopyEndpoint({ endpoint, name }: { endpoint: string; name: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <span className="flex items-center gap-1">
      <code className="min-w-0 truncate font-mono text-xs">{endpoint}</code>
      <Button
        aria-label={`Copy ${name} endpoint`}
        onClick={() => {
          void navigator.clipboard
            ?.writeText(endpoint)
            .then(() => setCopied(true));
        }}
        size="compactIcon"
        tone="ghost"
      >
        <Icon icon={copied ? Tick02Icon : Copy01Icon} size={14} />
      </Button>
    </span>
  );
}

/** Everything about one model on one Computer, shown when its row expands. */
export function ModelFacts({
  entry,
  view,
}: {
  entry: ModelEntry;
  view: LocalModelsView;
}) {
  const { model, status } = entry;
  // A stopped download holds only a partial file, so it reads like a model
  // not yet on the Computer.
  const stopped = downloadStopped(model);
  const onComputer = isModelOnComputer(model, status);
  const pool = poolOf(view, model.pool);
  const plannedPlace =
    status === "available" || stopped ? placeName(view, model.pool) : undefined;
  const capabilities = modelCapabilities(model);
  const parameters = parametersLabel(model);
  const speed = speedLabel(model);
  const sourceUrl = safeModelSourceUrl(model.source_url);
  const externalBytes = view.pools.reduce(
    (sum, item) => sum + poolOtherBytes(item),
    0,
  );
  const maxHardware = Math.max(
    view.computer.host?.ram_total_bytes ?? 0,
    ...(view.computer.host?.gpus.map((gpu) => gpu.total_bytes) ?? [0]),
    ...view.pools.map((item) => item.total_bytes),
    0,
  );
  const reclaimable =
    externalBytes > 0 &&
    model.availability.reason?.code === "MEMORY_INSUFFICIENT" &&
    model.availability.reason.need_bytes !== undefined &&
    model.availability.reason.need_bytes <= maxHardware;
  const availableNeedsRoom =
    status === "available" &&
    pool !== undefined &&
    poolOtherBytes(pool) > 0 &&
    poolFreeBytes(pool) < model.memory_bytes;
  return (
    <div>
      {model.error || status === "unavailable" ? (
        <div className="my-1.5 rounded-lg border border-[var(--app-status-danger-border)] bg-[var(--app-status-danger-surface)] px-3 py-0.5">
          {model.error ? (
            <Fact
              bordered={false}
              label={stopped ? "Last download" : "Last load"}
            >
              <span className="text-app-danger">
                {modelErrorCopy(model.error.code)}
              </span>
            </Fact>
          ) : null}
          {status === "unavailable" ? (
            <Fact bordered={Boolean(model.error)} label="Why not">
              <span className="text-app-danger">
                {unavailableCopy(model.availability.reason, reclaimable)}
              </span>
            </Fact>
          ) : null}
        </div>
      ) : null}
      {model.note ? (
        <div className="my-1.5 rounded-lg border border-[var(--app-status-warning-border)] bg-[var(--app-status-warning-surface)] px-3 py-0.5">
          <Fact bordered={false} label="Note">
            <span className="text-app-warning">
              {modelNoteCopy(model.note.code, placeName(view, model.pool))}
            </span>
          </Fact>
        </div>
      ) : null}
      {availableNeedsRoom ? (
        <div className="my-1.5">
          <FormFeedback tone="warning">
            This model can download now, but only{" "}
            {formatGigabytes(poolFreeBytes(pool))} is free on{" "}
            {poolLabel(view, pool)}. Close memory-heavy apps and recheck memory
            before loading it.
          </FormFeedback>
        </div>
      ) : null}
      <div className="mt-1 grid grid-cols-1 gap-x-6 @xl:grid-cols-2">
        {capabilities.length ? (
          <Fact className="@xl:col-span-2" label="Capabilities">
            <span className="flex flex-wrap gap-1.5">
              {capabilities.map((capability) => (
                <span
                  className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-secondary-foreground"
                  key={capability}
                >
                  {capabilityCopy(capability)}
                </span>
              ))}
            </span>
          </Fact>
        ) : null}
        {model.publisher ? (
          <Fact label="Publisher">{model.publisher}</Fact>
        ) : null}
        {parameters ? <Fact label="Parameters">{parameters}</Fact> : null}
        <Fact label="Memory">
          {formatGigabytes(model.memory_bytes)}
          {onComputer && pool
            ? ` on ${poolLabel(view, pool)}`
            : plannedPlace
              ? ` on ${plannedPlace}`
              : ""}
        </Fact>
        <Fact label={onComputer ? "On disk" : "Download"}>
          {formatGigabytes(model.download_bytes)}
        </Fact>
        <Fact label="Context">{contextLabel(model.context_tokens)}</Fact>
        <Fact label="Version">
          <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-secondary-foreground">
            {model.quant}
          </code>
        </Fact>
        {speed ? <Fact label="Speed">{speed}</Fact> : null}
        {model.license ? <Fact label="License">{model.license}</Fact> : null}
        {onComputer ? (
          <Fact
            className={entry.used_by.length > 1 ? "@xl:col-span-2" : undefined}
            label="Used by"
          >
            {entry.used_by.length ? agentNames(entry) : "No Agent yet"}
          </Fact>
        ) : null}
        {sourceUrl ? (
          <Fact className="@xl:col-span-2" label="Source">
            <a
              className="inline-flex max-w-full items-center gap-1 text-foreground underline underline-offset-2"
              href={sourceUrl}
              rel="noopener noreferrer"
              target="_blank"
            >
              <span className="truncate">{modelSourceLabel(sourceUrl)}</span>
              <Icon className="shrink-0" icon={LinkSquare02Icon} size={14} />
            </a>
          </Fact>
        ) : null}
        {model.endpoint ? (
          <Fact className="@xl:col-span-2" label="Endpoint">
            <CopyEndpoint
              endpoint={model.endpoint.base_url}
              name={model.name}
            />
          </Fact>
        ) : null}
      </div>
    </div>
  );
}

function PoolBar({
  colorOf,
  pool,
  view,
}: {
  colorOf: (holderId: string) => string;
  pool: LocalModelPool;
  view: LocalModelsView;
}) {
  const label = poolLabel(view, pool);
  // used_bytes is the device's real use; on a shared card other processes
  // hold memory that no holder accounts for.
  const otherBytes = poolOtherBytes(pool);
  const width = (bytes: number) =>
    `${pool.total_bytes ? Math.min(100, (bytes / pool.total_bytes) * 100) : 0}%`;
  return (
    <div className="flex min-h-10 items-center gap-3 py-1.5 text-sm">
      <span className="w-28 shrink-0 text-muted-foreground">
        {pool.kind === "gpu" ? `GPU ${pool.gpu_index}` : label}
      </span>
      <span
        aria-label={`${label}: ${formatGigabytes(pool.used_bytes)} of ${formatGigabytes(pool.total_bytes)} in use`}
        className="flex h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-muted"
        role="img"
      >
        {pool.holders.map((holder) => (
          <span
            className={cn(
              "h-full border-r-2 border-card last:border-r-0",
              colorOf(holder.id),
            )}
            key={holder.id}
            style={{ width: width(holder.bytes) }}
            title={`${holder.name} · ${formatGigabytes(holder.bytes)}`}
          />
        ))}
        {otherBytes ? (
          <span
            className="h-full bg-muted-foreground/30"
            style={{ width: width(otherBytes) }}
            title={`Other apps · ${formatGigabytes(otherBytes)}`}
          />
        ) : null}
      </span>
      <span className="w-24 shrink-0 text-right text-xs whitespace-nowrap tabular-nums text-muted-foreground">
        {formatGigabytes(poolFreeBytes(pool))} free
      </span>
    </div>
  );
}

/** Memory and hardware of one Computer, for people who want the numbers. */
export function AdvancedDialog({
  onClose,
  view,
}: {
  onClose: () => void;
  view: LocalModelsView;
}) {
  const host = view.computer.host;
  const holders = view.pools.flatMap((pool) => pool.holders);
  const models = holders.filter((holder) => holder.kind === "model");
  const components = holders.filter((holder) => holder.kind === "component");
  const colorOf = (holderId: string) => {
    const index = models.findIndex((holder) => holder.id === holderId);
    return index < 0
      ? componentColor
      : segmentColors[index % segmentColors.length]!;
  };

  return (
    <ModalDialog
      closeOnBackdrop
      description={
        host
          ? [host.os_label, host.engine_label].filter(Boolean).join(" · ")
          : undefined
      }
      onClose={onClose}
      size="md"
      title={`${view.computer.display_name} details`}
    >
      <div className="px-5 py-4">
        <h3 className="mb-1 text-sm font-medium text-muted-foreground">
          Memory
        </h3>
        <div className="divide-y divide-border">
          {view.pools.map((pool) => (
            <PoolBar colorOf={colorOf} key={pool.id} pool={pool} view={view} />
          ))}
        </div>
        {holders.length ? (
          <p className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
            {[...models, ...components].map((holder) => (
              <span className="flex items-center gap-1.5" key={holder.id}>
                <span
                  aria-hidden
                  className={cn("size-1.5 rounded-full", colorOf(holder.id))}
                />
                {holder.name}
              </span>
            ))}
          </p>
        ) : null}
        {host ? (
          <>
            <h3 className="mt-5 mb-1 text-sm font-medium text-muted-foreground">
              Hardware
            </h3>
            <div>
              <Fact bordered={false} label="Memory">
                {formatGigabytes(host.ram_total_bytes)}
              </Fact>
              {host.gpus.map((gpu) => (
                <Fact key={gpu.index} label={`GPU ${gpu.index}`}>
                  {gpu.name} · {formatGigabytes(gpu.total_bytes)}
                </Fact>
              ))}
              <Fact label="Free disk">
                {formatGigabytes(host.disk_free_bytes)}
              </Fact>
            </div>
          </>
        ) : null}
      </div>
    </ModalDialog>
  );
}
