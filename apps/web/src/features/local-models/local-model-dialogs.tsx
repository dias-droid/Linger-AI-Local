import { useState } from "react";

import { Button } from "@/components/ui/button";
import { FormFeedback } from "@/components/ui/form-feedback";
import { ModalDialog } from "@/components/ui/modal-dialog";
import { sourceCheckClassName } from "@/features/settings/provider-selection-picker";
import { cn } from "@/lib/cn";

import {
  type AssignableLocalModelAgent,
  isAgentUsingModel,
} from "./local-model-agents";
import type { LocalModelsView } from "./local-models-queries";
import {
  agentNames,
  formatGigabytes,
  makeRoomSelection,
  makesRoom,
  poolLabel,
  poolOf,
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

/** Loading would overfill the pool: offer to unload loaded models first. */
export function MakeRoomDialog({
  assignableAgents = [],
  check,
  disabled,
  entry,
  onClose,
  onConfirm,
  view,
}: {
  assignableAgents?: readonly AssignableLocalModelAgent[];
  check: LoadCheck;
  /** The model can no longer be loaded, or its Computer took no actions. */
  disabled: boolean;
  entry: ModelEntry;
  onClose: () => void;
  onConfirm: (unloadIds: string[], switchAgentIds: string[]) => void;
  view: LocalModelsView;
}) {
  const [selected, setSelected] = useState(() => makeRoomSelection(check));
  const [switchAgents, setSwitchAgents] = useState(true);
  const chosen = new Set(selected);
  const enough = makesRoom(check, chosen);
  const chosenLoaded = check.loaded.filter((item) => chosen.has(item.model.id));
  const affected = chosenLoaded.flatMap((item) =>
    item.used_by.map((user) => user.name),
  );
  const affectedAssignable = assignableAgents.filter((agent) =>
    chosenLoaded.some((item) =>
      isAgentUsingModel(item, agent, view.computer.computer_id),
    ),
  );
  const canSwitchOnLoad =
    Boolean(entry.model.pi_model) && affectedAssignable.length > 0;

  return (
    <ModalDialog
      description={`${entry.model.name} needs ${formatGigabytes(check.needBytes)} on ${poolLabel(view, check.pool)}; ${formatGigabytes(check.freeBytes)} is free.`}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            disabled={disabled || !enough}
            onClick={() =>
              onConfirm(
                selected,
                canSwitchOnLoad && switchAgents
                  ? affectedAssignable.map((agent) => agent.actorId)
                  : [],
              )
            }
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
        {check.loaded.length ? (
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
            Nothing else is loaded there. This model doesn&apos;t fit even when
            the memory is empty.
          </FormFeedback>
        )}
        {affected.length ? (
          <FormFeedback tone="warning">
            {affected.join(", ")} can&apos;t answer until their model is loaded
            again.
          </FormFeedback>
        ) : null}
        {canSwitchOnLoad ? (
          <label className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm text-app-ink">
            <input
              checked={switchAgents}
              className={sourceCheckClassName}
              onChange={(event) => setSwitchAgents(event.target.checked)}
              type="checkbox"
            />
            <span>
              Switch {affectedAssignable.map((agent) => agent.name).join(", ")}{" "}
              to {entry.model.name} once loaded
            </span>
          </label>
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
