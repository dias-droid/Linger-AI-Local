import { afterEach, describe, expect, it, vi } from "vitest";

import { createBuiltinAgentFeatures } from "../../../src/agent/agent-features/builtin.js";
import type { ContextRuntimeActivator } from "../../../src/agent/executor/activation.js";
import type { ExecutionContextRecord } from "../../../src/agent/executor/context-ref.js";
import { createTeamHubContextRuntimeState } from "../../../src/agent/executor/context-runtime-state.js";
import { TeamHubExecutionContextStore } from "../../../src/agent/executor/context-store.js";
import type { AgentProvider } from "../../../src/agent/executor/provider.js";
import { ExecutorRegistry } from "../../../src/agent/executor/registry.js";
import {
  TeamHubRuntimeStateError,
  type RuntimeContext,
} from "../../../src/agent/executor/teamhub-runtime-state-client.js";
import type { AgentLogger } from "../../../src/agent/observability/agent-log.js";
import type { LocalRuntimeSettings } from "../../../src/agent/runtime-settings.js";
import { createInMemoryGhostStore } from "../test-support/in-memory-ghost-store.js";
import {
  createInMemoryTeamHubRuntimeState,
  createTeamHubRuntimeStateClientFake,
} from "../test-support/teamhub-runtime-state-client.js";

// Native Promise timers do not follow Vitest's global fake clock.
vi.mock("node:timers/promises", async (importOriginal) => {
  const timers = await importOriginal<typeof import("node:timers/promises")>();
  const { fakeTimerDelay } =
    await import("../test-support/fake-timer-delay.js");
  return {
    ...timers,
    setTimeout: fakeTimerDelay,
  };
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("TeamHub Execution Context store", () => {
  it("opens the epoch, reconciles and returns the Contexts with queued work", async () => {
    const calls: string[] = [];
    const client = createTeamHubRuntimeStateClientFake({
      startEpoch: async () => {
        calls.push("epoch");
        return {
          interrupted_run_ids: ["run-interrupted"],
          waiting_context_keys: [runtimeContext("suspended").context_key],
        };
      },
      reconcileContexts: async () => {
        calls.push("reconcile");
        return emptyReconciliation();
      },
    });
    const store = new TeamHubExecutionContextStore({ client });
    try {
      const startup = await store.start();
      expect(calls).toEqual(["epoch", "reconcile"]);
      expect(startup.waitingContextKeys).toEqual([
        runtimeContext("suspended").context_key,
      ]);
      expect(store.epoch).toBe(client.epoch);
      // Startup binds nothing: queued work binds through its wake.
      expect(await store.list()).toEqual([]);
    } finally {
      await store.close();
    }
  });

  it("retries temporary startup failures with a bounded budget", async () => {
    vi.useFakeTimers();
    let attempts = 0;
    const client = createTeamHubRuntimeStateClientFake({
      startEpoch: async () => {
        attempts += 1;
        if (attempts < 3)
          throw new TeamHubRuntimeStateError(503, "unavailable", undefined);
        return { interrupted_run_ids: [], waiting_context_keys: [] };
      },
      reconcileContexts: emptyReconciliation,
    });
    const store = new TeamHubExecutionContextStore({ client });
    try {
      const started = store.start();
      await vi.advanceTimersByTimeAsync(3_000);
      await started;
      expect(attempts).toBe(3);
    } finally {
      await store.close();
    }
  });

  it("does not retry a permanent startup error", async () => {
    const startEpoch = vi.fn(async () => {
      throw new TeamHubRuntimeStateError(400, "invalid", "INVALID_REQUEST");
    });
    const store = new TeamHubExecutionContextStore({
      client: createTeamHubRuntimeStateClientFake({ startEpoch }),
    });
    try {
      await expect(store.start()).rejects.toThrow("invalid");
      expect(startEpoch).toHaveBeenCalledOnce();
    } finally {
      await store.close();
    }
  });

  it("binds a Context for queued work and enumerates unheld ones without binding them", async () => {
    const context = runtimeContext("suspended");
    const getContext = vi.fn(async () => context);
    const store = await startedStore({
      getContext,
      listContexts: async () => [context],
    });
    const published: ExecutionContextRecord[] = [];
    store.subscribe((record) => published.push(record));
    try {
      expect(await store.listByAgent(roomRef.agentId)).toEqual([record()]);
      expect(await store.list()).toEqual([]);
      expect(await store.claimByKey(context.context_key)).toEqual(record());
      expect(await store.list()).toEqual([record()]);
      expect(published).toEqual([record()]);
      // A held record answers a work hint without another read.
      expect(await store.claimByKey(context.context_key)).toEqual(record());
      expect(getContext).toHaveBeenCalledOnce();
    } finally {
      await store.close();
    }
  });

  it("binds an unheld Context on a change hint only when its Room Meta Context never ran", async () => {
    let context = runtimeContext("suspended");
    const store = await startedStore({ getContext: async () => context });
    try {
      expect(store.isUnusedContext(roomRef)).toBe(false);
      expect(
        await store.claimByKey(context.context_key, true, "changed"),
      ).toEqual(record());
      expect(store.isUnusedContext(roomRef)).toBe(true);
      await store.releaseIfIdle(roomRef);
      context = {
        ...context,
        state_revision: "2",
        next_input_sequence: "4",
      };
      expect(
        await store.claimByKey(context.context_key, true, "changed"),
      ).toBeNull();
      expect(await store.list()).toEqual([]);
    } finally {
      await store.close();
    }
  });

  it("binds an unheld active Document Context on a change hint without breaking release invariants", async () => {
    let context = documentRuntimeContext("suspended", "1", "0");
    const store = await startedStore({ getContext: async () => context });
    const published: ExecutionContextRecord[] = [];
    store.subscribe((value) => published.push(value));
    try {
      // Suspended Document Contexts (for example while an anchor is pending) stay unheld.
      expect(
        await store.claimByKey(context.context_key, true, "changed", "1"),
      ).toBeNull();
      expect(await store.list()).toEqual([]);

      context = documentRuntimeContext("suspended", "2", "1");
      expect(
        await store.claimByKey(context.context_key, true, "changed", "2"),
      ).toBeNull();
      expect(await store.list()).toEqual([]);

      // TeamHub activates the Document Context when its comment Run is claimable.
      context = documentRuntimeContext("active", "3", "1");
      expect(
        await store.claimByKey(context.context_key, true, "changed", "3"),
      ).toEqual(documentRecord("active"));
      expect(store.isUnusedContext(documentRef)).toBe(false);
      expect(await store.list()).toEqual([documentRecord("active")]);
      expect(published).toEqual([documentRecord("active")]);

      // After idle suspension and local release, suspended hints do not re-bind it.
      context = documentRuntimeContext("suspended", "4", "1");
      expect(
        await store.claimByKey(context.context_key, true, "changed", "4"),
      ).toEqual(documentRecord("suspended"));
      expect(await store.releaseIfIdle(documentRef)).toBe(true);
      expect(await store.list()).toEqual([]);
      expect(
        await store.claimByKey(context.context_key, true, "changed", "4"),
      ).toBeNull();
      expect(await store.list()).toEqual([]);

      // A later comment activation re-binds the previously released Document Context.
      context = documentRuntimeContext("active", "5", "2");
      expect(
        await store.claimByKey(context.context_key, true, "changed", "5"),
      ).toEqual(documentRecord("active"));
      expect(await store.list()).toEqual([documentRecord("active")]);

      // Terminal Document Contexts never bind on a change hint.
      await store.releaseIfIdle(documentRef);
      context = {
        ...documentRuntimeContext("active", "6", "2"),
        terminal_reason: "context_deleted",
        terminated_at: "2026-11-03T00:00:00.000Z",
      };
      expect(
        await store.claimByKey(context.context_key, true, "changed", "6"),
      ).toBeNull();
      expect(await store.list()).toEqual([]);
    } finally {
      await store.close();
    }
  });

  it("does not bind unheld used Meta or active alter_ego Contexts on a change hint", async () => {
    const usedMeta: RuntimeContext = {
      ...runtimeContext("active"),
      state_revision: "2",
      next_input_sequence: "4",
    };
    const activeAlterEgo: RuntimeContext = {
      context_key: '["alter_ego","agent-reviewer","task-1"]',
      ref: { kind: "alter_ego", agent_id: "agent-reviewer", task_id: "task-1" },
      tenant_id: "tenant-acme",
      agent_actor_id: "actor-reviewer",
      target_residency: "active",
      state_revision: "2",
      next_input_sequence: "1",
    };
    const contexts = new Map<string, RuntimeContext>([
      [usedMeta.context_key, usedMeta],
      [activeAlterEgo.context_key, activeAlterEgo],
    ]);
    const store = await startedStore({
      getContext: async (key) => contexts.get(key)!,
    });
    try {
      expect(
        await store.claimByKey(usedMeta.context_key, true, "changed", "2"),
      ).toBeNull();
      expect(
        await store.claimByKey(
          activeAlterEgo.context_key,
          true,
          "changed",
          "2",
        ),
      ).toBeNull();
      expect(await store.list()).toEqual([]);
    } finally {
      await store.close();
    }
  });

  it("wakes, binds, activates, and claims an unheld Document Context on context.changed without periodic sweep", async () => {
    const memory = createInMemoryTeamHubRuntimeState();
    const wireDocumentRef = {
      kind: "document" as const,
      agent_id: documentRef.agentId,
      document_id: documentRef.documentId,
    };
    memory.putConfig({
      agent_id: documentRef.agentId,
      tenant_id: "tenant-acme",
      actor_id: "actor-reviewer",
      configuration_revision: "1",
      runtime_configuration_revision: "1",
      content_hash: "doc-wake-test",
      permission_review: false,
      agent: { name: "Reviewer", instructions: "Reply to comments." },
      runtime: {
        type: "local",
        model: "test-model",
        placement: {
          tenant_id: "tenant-acme",
          owner_actor_id: "owner-1",
          computer_id: "computer-1",
          runtime_type: "codex",
          workspace_grant_id: "grant-1",
          assignment_revision: "1",
        },
      },
      resources: { skills: [], mcp_servers: [] },
    });
    const listWaitingContexts = vi.fn(async () => {
      throw new Error("periodic waiting sweep should not be called");
    });
    const claimRun = vi.fn(async () => {
      memory.putWorkState(wireDocumentRef, {
        has_pending_work: false,
        has_queued_runs: false,
      });
      return { claimed: false as const };
    });
    memory.client.listWaitingContexts = listWaitingContexts;
    memory.client.claimRun = claimRun;

    const store = new TeamHubExecutionContextStore({ client: memory.client });
    const startup = await store.start();
    expect(startup.waitingContextKeys).toEqual([]);

    const ghostStore = createInMemoryGhostStore<LocalRuntimeSettings>();
    await ghostStore.insert({
      agentId: documentRef.agentId,
      actorId: "actor-reviewer",
      tenantId: "tenant-acme",
      revision: "1",
      agent: { name: "Reviewer", instructions: "Reply to comments." },
      runtime: {
        type: "local",
        model: "test-model",
        placement: {
          type: "local",
          tenantId: "tenant-acme",
          ownerActorId: "owner-1",
          computerId: "computer-1",
          runtimeType: "codex",
          workspaceGrantId: "grant-1",
          assignmentRevision: 1,
        },
      },
      resources: { skills: [], mcpServers: [] },
    });
    const provider: AgentProvider = {
      async createSession() {
        throw new Error("unexpected createSession");
      },
      async resumeSession() {
        throw new Error("unexpected resumeSession");
      },
      async startRun() {
        throw new Error("unexpected startRun");
      },
      async steer() {
        throw new Error("unexpected steer");
      },
      async close() {},
    };
    const activate = vi.fn(async (request) => ({
      ref: request.ref,
      provider,
      runtimeName: "test",
      runtimeSession: { threadId: "doc-thread-1" },
      sessionSpec: {
        workingDirectory: "/workspace",
        threadName: "Doc",
        sandboxMode: "workspace-write" as const,
        resources: { mcpServers: [] },
      },
      setActiveRunContext() {},
      async deactivate() {
        await provider.close();
      },
    }));
    const activator: ContextRuntimeActivator<LocalRuntimeSettings> = {
      activate,
    };
    const silentLogger: AgentLogger = {
      log: () => undefined,
      child: () => silentLogger,
    };
    const manager = new ExecutorRegistry<LocalRuntimeSettings>({
      ghostStore,
      contextStore: store,
      identityResolver: {
        async resolveIdentity() {
          return {
            actorId: "actor-reviewer",
            agentType: "general",
            sponsor: { actorId: "human-1", displayName: "Human" },
          };
        },
      },
      executorServices: {
        activator,
        stateFactory: (input) =>
          createTeamHubContextRuntimeState({
            client: memory.client,
            ref: input.ref,
            configurationRevision: input.configurationRevision,
            providerKind: "codex",
          }),
      },
      features: createBuiltinAgentFeatures({
        services: { logger: silentLogger },
      }),
    });
    try {
      await manager.restore();
      const created = await memory.client.ensureContext({
        ref: wireDocumentRef,
        target_residency: "suspended",
      });
      const contextKey = created.context.context_key;
      memory.putWorkState(wireDocumentRef, {
        has_pending_work: true,
        has_queued_runs: true,
      });

      // Suspended change hint does not bind or activate.
      expect(
        await store.claimByKey(
          contextKey,
          true,
          "changed",
          created.context.state_revision,
        ),
      ).toBeNull();
      expect(activate).not.toHaveBeenCalled();

      // TeamHub activates the Document Context and emits context.changed.
      const activated = await memory.client.setContextResidency({
        context_key: contextKey,
        expected_revision: created.context.state_revision,
        target_residency: "active",
      });
      const bound = await store.claimByKey(
        contextKey,
        true,
        "changed",
        activated.state_revision,
      );
      expect(bound).toEqual(documentRecord("active"));
      await vi.waitFor(() => expect(claimRun).toHaveBeenCalled());
      expect(activate).toHaveBeenCalledOnce();
      expect(listWaitingContexts).not.toHaveBeenCalled();
    } finally {
      await manager.close();
      await store.close();
    }
  });

  it("refreshes a held record only for a revision it has not seen", async () => {
    let context = runtimeContext("active");
    const getContext = vi.fn(async () => context);
    const store = await startedStore({ getContext });
    try {
      await store.claimByKey(context.context_key);
      await store.claimByKey(context.context_key, true, "changed", "1");
      expect(getContext).toHaveBeenCalledOnce();
      context = {
        ...context,
        state_revision: "2",
        target_residency: "suspended",
      };
      expect(
        (await store.claimByKey(context.context_key, true, "changed", "2"))
          ?.targetResidency,
      ).toBe("suspended");
      expect(getContext).toHaveBeenCalledTimes(2);
    } finally {
      await store.close();
    }
  });

  it("releases a suspended Context locally and notifies its unbind", async () => {
    let context = runtimeContext("active");
    const store = await startedStore({ getContext: async () => context });
    const unbound: unknown[] = [];
    store.subscribeUnbind((ref) => unbound.push(ref));
    try {
      await store.claimByKey(context.context_key);
      expect(await store.releaseIfIdle(roomRef)).toBe(false);
      context = {
        ...context,
        state_revision: "2",
        target_residency: "suspended",
      };
      await store.claimByKey(context.context_key, true);
      expect(await store.releaseIfIdle(roomRef)).toBe(true);
      expect(unbound).toEqual([roomRef]);
      expect(await store.list()).toEqual([]);
    } finally {
      await store.close();
    }
  });

  it("unbinds a held Context TeamHub rebinds to a new Room membership", async () => {
    let context: RuntimeContext = {
      ...runtimeContext("active"),
      membership_epoch_id: "membership-1",
    };
    const store = await startedStore({ getContext: async () => context });
    const events: string[] = [];
    store.subscribeUnbind(() => events.push("unbind"));
    store.subscribe(() => events.push("publish"));
    try {
      await store.claimByKey(context.context_key);
      context = {
        ...context,
        state_revision: "3",
        membership_epoch_id: "membership-2",
      };
      await store.claimByKey(context.context_key, true);
      // What was prepared stops before the rebound record applies.
      expect(events).toEqual(["publish", "unbind", "publish"]);
      expect(await store.list()).toEqual([
        { ...record(), targetResidency: "active" },
      ]);
    } finally {
      await store.close();
    }
  });

  it("publishes a terminal Context once and stops holding it", async () => {
    let context = runtimeContext("active");
    const store = await startedStore({ getContext: async () => context });
    const published: ExecutionContextRecord[] = [];
    store.subscribe((value) => published.push(value));
    try {
      await store.claimByKey(context.context_key);
      context = {
        ...context,
        state_revision: "2",
        target_residency: "suspended",
        terminal_reason: "context_deleted",
        terminated_at: "2026-11-03T00:00:00.000Z",
      };
      expect(await store.claimByKey(context.context_key, true)).toBeNull();
      expect(await store.claimByKey(context.context_key, true)).toBeNull();
      expect(published.map((value) => value.terminalReason)).toEqual([
        undefined,
        "context_deleted",
      ]);
      expect(await store.list()).toEqual([]);
    } finally {
      await store.close();
    }
  });

  it("re-reads every held Context after hints may have been lost", async () => {
    const contexts = new Map(
      ["room-a", "room-b"].map((roomId) => {
        const context = runtimeContext("active", roomId);
        return [context.context_key, context] as const;
      }),
    );
    const getContext = vi.fn(async (key: string) => contexts.get(key)!);
    const store = await startedStore({ getContext });
    try {
      for (const key of contexts.keys()) await store.claimByKey(key);
      getContext.mockClear();
      await store.refreshAvailableContexts();
      expect(getContext).toHaveBeenCalledTimes(2);
    } finally {
      await store.close();
    }
  });

  it("applies an acceptance's committed state and follows its own Run claim revision", async () => {
    const context = runtimeContext("suspended");
    const getContext = vi.fn(async () => context);
    const store = await startedStore({ getContext });
    try {
      await store.claimByKey(context.context_key);
      store.observeCommittedState(roomRef, {
        state_revision: "4",
        target_residency: "active",
        next_input_sequence: "9",
      });
      expect(store.cached(roomRef)?.targetResidency).toBe("active");
      const advanced = store.trackOwnRevisionAdvance(roomRef);
      advanced();
      // The claim's own context.changed hint at revision 5 reads nothing.
      await store.claimByKey(context.context_key, true, "changed", "5");
      expect(getContext).toHaveBeenCalledOnce();
    } finally {
      await store.close();
    }
  });

  it("carries a trusted shared Task scope and rejects one for another Context", async () => {
    const scope = {
      version: 1 as const,
      tenant_id: "tenant-acme",
      agent_id: "agent-reviewer",
      origin_room_id: "room-review",
      role: "meta" as const,
    };
    let current: RuntimeContext = {
      ...runtimeContext("active"),
      shared_task_scope: scope,
    };
    const store = await startedStore({ getContext: async () => current });
    try {
      expect(
        (await store.claimByKey(current.context_key))?.sharedTaskScope,
      ).toEqual({
        version: 1,
        tenantId: "tenant-acme",
        agentId: "agent-reviewer",
        originRoomId: "room-review",
        role: "meta",
      });
      for (const forged of [
        { ...scope, origin_room_id: "room-other" },
        { ...scope, agent_id: "agent-other" },
        { ...scope, tenant_id: "tenant-other" },
        { ...scope, role: "alter_ego" as const, task_id: "task-1" },
      ]) {
        current = {
          ...current,
          state_revision: String(Number(current.state_revision) + 1),
          shared_task_scope: forged,
        };
        await expect(
          store.claimByKey(current.context_key, true),
        ).rejects.toThrow("Shared Task scope does not match its Context");
      }
    } finally {
      await store.close();
    }
  });

  it("holds an ensured Context and keeps its existing suspended residency", async () => {
    const existing = runtimeContext("suspended");
    const ensureContext = vi.fn(async () => ({
      created: false,
      context: existing,
    }));
    const store = await startedStore({ ensureContext });
    try {
      const ensured = await store.ensure(roomRef);
      expect(ensured).toEqual({ created: false, record: record() });
      expect(ensureContext).toHaveBeenCalledWith({
        ref: {
          kind: "meta",
          agent_id: "agent-reviewer",
          room_id: "room-review",
        },
        target_residency: "active",
      });
      expect(await store.list()).toEqual([record()]);
    } finally {
      await store.close();
    }
  });

  it("holds a Context whose residency it activates", async () => {
    let context = runtimeContext("suspended");
    const setContextResidency = vi.fn(async () => {
      context = {
        ...context,
        state_revision: "2",
        target_residency: "active",
      };
      return context;
    });
    const store = await startedStore({
      getContext: async () => context,
      setContextResidency,
    });
    try {
      expect(await store.setTargetResidency(roomRef, "active")).toBe("updated");
      expect(setContextResidency).toHaveBeenCalledWith({
        context_key: context.context_key,
        expected_revision: "1",
        target_residency: "active",
      });
      expect(await store.list()).toEqual([
        { ...record(), targetResidency: "active" },
      ]);
    } finally {
      await store.close();
    }
  });
});

const startedStore = async (
  overrides: Parameters<typeof createTeamHubRuntimeStateClientFake>[0],
): Promise<TeamHubExecutionContextStore> => {
  const store = new TeamHubExecutionContextStore({
    client: createTeamHubRuntimeStateClientFake({
      reconcileContexts: emptyReconciliation,
      ...overrides,
    }),
  });
  await store.start();
  return store;
};

const emptyReconciliation = async () => ({
  examined_count: 0,
  existing_count: 0,
  created_count: 0,
  created_context_keys: [],
});

const roomRef = {
  kind: "meta" as const,
  agentId: "agent-reviewer",
  roomId: "room-review",
};

const documentRef = {
  kind: "document" as const,
  agentId: "agent-reviewer",
  documentId: "doc-standalone",
};

const record = (): ExecutionContextRecord => ({
  ref: roomRef,
  roomKind: "collaboration",
  targetResidency: "suspended",
});

const documentRecord = (
  targetResidency: ExecutionContextRecord["targetResidency"],
): ExecutionContextRecord => ({
  ref: documentRef,
  targetResidency,
});

const runtimeContext = (
  targetResidency: RuntimeContext["target_residency"],
  roomId = "room-review",
): RuntimeContext => ({
  context_key: `["meta","agent-reviewer","room","${roomId}"]`,
  ref: { kind: "meta", agent_id: "agent-reviewer", room_id: roomId },
  tenant_id: "tenant-acme",
  agent_actor_id: "actor-reviewer",
  room_kind: "collaboration",
  target_residency: targetResidency,
  state_revision: "1",
  next_input_sequence: "0",
});

const documentRuntimeContext = (
  targetResidency: RuntimeContext["target_residency"],
  stateRevision = "1",
  nextInputSequence = "0",
): RuntimeContext => ({
  context_key: `["document","agent-reviewer","${documentRef.documentId}"]`,
  ref: {
    kind: "document",
    agent_id: "agent-reviewer",
    document_id: documentRef.documentId,
  },
  tenant_id: "tenant-acme",
  agent_actor_id: "actor-reviewer",
  target_residency: targetResidency,
  state_revision: stateRevision,
  next_input_sequence: nextInputSequence,
});
