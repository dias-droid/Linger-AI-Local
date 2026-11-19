import { useState } from "react";

import { Button } from "@/components/ui/button";
import { FormFeedback } from "@/components/ui/form-feedback";
import { ModalDialog } from "@/components/ui/modal-dialog";
import { sourceCheckClassName } from "@/features/settings/provider-selection-picker";
import { cn } from "@/lib/cn";

import type { LocalModelsView } from "./local-models-queries";
import {
  agentNames,
  formatGigabytes,
  makeRoomSelection,
  makesRoom,
  poolLabel,
  poolOf,
  poolOtherBytes,
  type LoadCheck,
  type ModelEntry,
} from "./local-models-rules";

/** The amber notice naming the Agents that stop answering. */
function AffectedAgents({
  entry,
  until,
}: {
  entry: ModelEntry;
  until: string;
}) {
  const count = entry.used_by.length;
  return count ? (
    <FormFeedback tone="warning">
      {agentNames(entry)} {count === 1 ? "uses" : "use"} this model and
      can&apos;t answer until {until}.
    </FormFeedback>
  ) : (
    <p className="text-sm text-muted-foreground">No Agent uses this model.</p>
  );
}

/** Loading would overfill the pool: offer to unload loaded models or recheck memory. */
export function MakeRoomDialog({
  check,
  disabled,
  entry,
  onClose,
  onConfirm,
  onRecheck,
  rechecking = false,
  view,
}: {
  check: LoadCheck;
  /** The model can no longer be loaded, or its Computer took no actions. */
  disabled: boolean;
  entry: ModelEntry;
  onClose: () => void;
  onConfirm: (unloadIds: string[]) => void;
  onRecheck?: () => void;
  rechecking?: boolean;
  view: LocalModelsView;
}) {
  const [selected, setSelected] = useState(() => makeRoomSelection(check));
  const chosen = new Set(selected);
  const roomFreeNow = check.freeBytes >= check.needBytes;
  const enough = roomFreeNow || makesRoom(check, chosen);
  const otherBytes = poolOtherBytes(check.pool);
  const unifiedFitsHardware =
    check.pool.kind === "unified" &&
    (view.computer.host?.ram_total_bytes ?? 0) >= check.needBytes;
  const affected = check.loaded.flatMap((item) =>
    chosen.has(item.model.id) ? item.used_by.map((user) => user.name) : [],
  );

  return (
    <ModalDialog
      description={`${entry.model.name} needs ${formatGigabytes(check.needBytes)} on ${poolLabel(view, check.pool)}; ${formatGigabytes(check.freeBytes)} is free.`}
      footer={
        <>
          {onRecheck ? (
            <Button
              disabled={disabled}
              loading={rechecking}
              onClick={onRecheck}
            >
              Recheck memory
            </Button>
          ) : null}
          <Button onClick={onClose}>Cancel</Button>
          <Button
            disabled={disabled || !enough}
            onClick={() => onConfirm(selected)}
            tone="primary"
          >
            {selected.length ? "Unload and load" : "Load"}
          </Button>
        </>
      }
      onClose={onClose}
      size="md"
      title="Make room to load"
    >
      <div className="grid gap-3 px-5 py-4">
        {roomFreeNow ? (
          <FormFeedback tone="success">
            Enough memory is free now ({formatGigabytes(check.freeBytes)}{" "}
            available). Click Load to start.
          </FormFeedback>
        ) : check.loaded.length ? (
          <fieldset className="grid gap-0.5">
            <legend className="mb-1.5 text-sm text-muted-foreground">
              Unload these to free memory:
            </legend>
            {check.loaded.map((item) => (
              <label
                className={cn(
                  "flex min-h-10 cursor-pointer items-center gap-2 rounded-sm px-2 text-sm transition-colors duration-150 motion-reduce:transition-none",
                  chosen.has(item.model.id)
                    ? "bg-app-selected text-app-ink"
                    : "text-app-body hover:bg-app-hover",
                )}
                key={item.model.id}
              >
                <input
                  checked={chosen.has(item.model.id)}
                  className={sourceCheckClassName}
                  onChange={(event) =>
                    setSelected((current) =>
                      event.target.checked
                        ? [...current, item.model.id]
                        : current.filter((id) => id !== item.model.id),
                    )
                  }
                  type="checkbox"
                />
                <span className="min-w-0 flex-1 truncate">
                  {item.model.name}
                </span>
                <span className="text-xs text-muted-foreground">
                  {item.used_by.length
                    ? `Used by ${agentNames(item)}`
                    : "Not used"}
                </span>
                <span className="w-16 text-right text-xs tabular-nums text-muted-foreground">
                  {formatGigabytes(item.model.memory_bytes)}
                </span>
              </label>
            ))}
          </fieldset>
        ) : (
          <FormFeedback tone="danger">
            Nothing else is loaded there.
            {otherBytes > 0 || unifiedFitsHardware
              ? `${otherBytes > 0 ? ` Other apps are using ${formatGigabytes(otherBytes)}.` : ""} Close video players, games, or other memory-heavy apps, then click Recheck memory so loading won't overload your computer.`
              : " This model doesn't fit even when the memory is empty."}
          </FormFeedback>
        )}
        {check.loaded.length > 0 && !enough && otherBytes > 0 ? (
          <FormFeedback tone="warning">
            Other apps are using {formatGigabytes(otherBytes)} on{" "}
            {poolLabel(view, check.pool)}. Close unnecessary apps and click
            Recheck memory to free the remaining room.
          </FormFeedback>
        ) : null}
        {affected.length ? (
          <FormFeedback tone="warning">
            {affected.join(", ")} can&apos;t answer until their model is loaded
            again.
          </FormFeedback>
        ) : null}
      </div>
    </ModalDialog>
  );
}

/** Unloading a model an Agent uses stops that Agent, so it asks first. */
export function UnloadModelDialog({
  disabled,
  entry,
  onClose,
  onConfirm,
  view,
}: {
  /** The action no longer applies, or its Computer takes no actions. */
  disabled: boolean;
  entry: ModelEntry;
  onClose: () => void;
  onConfirm: () => void;
  view: LocalModelsView;
}) {
  const pool = poolOf(view, entry.model.pool);
  return (
    <ModalDialog
      description={`Frees ${formatGigabytes(entry.model.memory_bytes)} of ${
        pool ? poolLabel(view, pool) : "memory"
      }. It stays on disk, so you can load it again later.`}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button disabled={disabled} onClick={onConfirm} tone="primary">
            Unload
          </Button>
        </>
      }
      onClose={onClose}
      size="sm"
      title={`Unload ${entry.model.name}?`}
    >
      <div className="px-5 py-4">
        <AffectedAgents entry={entry} until="it is loaded again" />
      </div>
    </ModalDialog>
  );
}

export function RemoveModelDialog({
  disabled,
  entry,
  onClose,
  onConfirm,
  view,
}: {
  /** The action no longer applies, or its Computer takes no actions. */
  disabled: boolean;
  entry: ModelEntry;
  onClose: () => void;
  onConfirm: () => void;
  view: LocalModelsView;
}) {
  return (
    <ModalDialog
      description={`${
        entry.status === "loaded"
          ? "Unloads it, deletes its files"
          : "Deletes its files"
      } and frees ${formatGigabytes(entry.model.download_bytes)} of disk on ${view.computer.display_name}. You can download it again later.`}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button disabled={disabled} onClick={onConfirm} tone="danger">
            Remove
          </Button>
        </>
      }
      onClose={onClose}
      size="sm"
      title={`Remove ${entry.model.name}?`}
    >
      <div className="px-5 py-4">
        <AffectedAgents
          entry={entry}
          until={`you choose another model for ${entry.used_by.length === 1 ? "it" : "them"}`}
        />
      </div>
    </ModalDialog>
  );
}
