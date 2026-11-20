import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import type { components } from "@linger/wire-contracts/teamhub-internal/types";
import { expect, it } from "vitest";
import { createTeamHubAgentResourcesResolver } from "../../../src/agent/executor/teamhub-context-resolvers.js";
import { createTeamHubRuntimeStateClient } from "../../../src/agent/executor/teamhub-runtime-state-client.js";
import { createTeamHubLocalComputerRegistry } from "../../../src/agent/runner-gateway/local-computer-registry.js";
import { hello as runnerHello } from "../runner-gateway/runner-gateway-fixtures.js";

type RuntimeStateSchemas = components["schemas"];

// TeamHub is deterministic HTTP state here; these assertions do not prove PG.
it("queues a Run for a mentioning Message and keeps session heartbeat read-only", async () => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "direct-inbox-fixture-"),
  );
  const reservation = createServer();
  reservation.listen(0, "127.0.0.1");
  await once(reservation, "listening");
  const port = (reservation.address() as { port: number }).port;
  await new Promise<void>((resolve) => reservation.close(() => resolve()));
  const stateFile = path.join(directory, "inbox-state.json");
  const readyFile = path.join(directory, "ready");
  await writeFile(
    stateFile,
    JSON.stringify({
      tenant_id: "tenant-fixture",
      inboxes: [
        {
          inbox_id: "room:room-fixture",
          kind: "room",
          room_id: "room-fixture",
          actor_ids: ["actor-agent-fixture"],
          messages: [
            {
              message_id: "message-fixture",
              sequence: 1,
              sender: { actor_id: "human-fixture", type: "user" },
              segments: [
                { type: "reference", target: "actor-agent-fixture" },
                { type: "text", content: "direct Inbox message" },
              ],
            },
          ],
        },
      ],
    }),
  );
  const child = spawn(
    process.execPath,
    [
      path.join(import.meta.dirname, "teamhub-callback-fixture.mjs"),
      "--port",
      String(port),
      "--ready-file",
      readyFile,
      "--output-file",
      path.join(directory, "events"),
      "--service-token",
      "fixture-service",
      "--tenant-id",
      "tenant-fixture",
      "--inbox-state-file",
      stateFile,
    ],
    { stdio: ["ignore", "ignore", "pipe"] },
  );
  let stderr = "";
  child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
    stderr += chunk;
  });
  const origin = `http://127.0.0.1:${port}`;
  const post = async (route: string, body: unknown) =>
    fetch(origin + "/v0/agent-runtime/" + route, {
      method: "POST",
      headers: {
        authorization: "Bearer fixture-service",
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });
  try {
    await expect
      .poll(async () => {
        if (child.exitCode !== null) throw new Error(stderr);
        return readFile(readyFile).then(
          () => true,
          () => false,
        );
      })
      .toBe(true);
    const resources = await createTeamHubAgentResourcesResolver({
      baseUrl: origin,
      serviceToken: "fixture-service",
    }).resolve({
      agentId: "agent-fixture",
      signal: new AbortController().signal,
    });
    expect(resources).toMatchObject({ skills: [] });
    expect(
      (await post("runner-receipts/query", { query: "recent" })).status,
    ).toBe(200);
    const epochResponse = await post("epochs", { epoch: "epoch-a" });
    expect(epochResponse.status).toBe(200);
    await fetch(origin + "/__test__/runtime-configs", {
      method: "POST",
      headers: {
        authorization: "Bearer fixture-service",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        registration: {
          agentId: "agent-fixture",
          tenantId: "tenant-fixture",
          revision: 1,
          agent: { type: "general", name: "Fixture" },
          runtime: {
            model: "fixture",
            placement: {
              computerId: "computer-fixture",
              tenantId: "tenant-fixture",
              ownerActorId: "human-fixture",
              runtimeType: "codex",
              workspaceGrantId: "grant-fixture",
            },
          },
          resources: { skills: [], mcpServers: [] },
        },
      }),
    });
    const created = (await (
      await post("contexts", {
        ref: {
          kind: "meta",
          agent_id: "agent-fixture",
          room_id: "room-fixture",
        },
        target_residency: "active",
      })
    ).json()) as RuntimeStateSchemas["EnsureAgentExecutionContextResult"];
    const key = created.context.context_key;
    const workState = async () =>
      (await (
        await fetch(
          origin +
            "/v0/agent-runtime/work-state?context_key=" +
            encodeURIComponent(key),
          { headers: { authorization: "Bearer fixture-service" } },
        )
      ).json()) as RuntimeStateSchemas["AgentRuntimeWorkState"];
    expect(await workState()).toMatchObject({
      has_pending_work: false,
      has_queued_runs: false,
    });
    // Publishing the Message queues its Run, as TeamHub's Message write does.
    const published = await fetch(origin + "/__test__/inbox-wake", {
      method: "POST",
      headers: {
        authorization: "Bearer fixture-service",
        "content-type": "application/json",
      },
      body: "{}",
    });
    expect(published.status).toBe(200);
    expect(await workState()).toMatchObject({
      has_pending_work: true,
      has_queued_runs: true,
      next_run_origins: [
        {
          notification: true,
          task_inbox: false,
          author_type: "user",
          message_kind: "message",
          fired_routine: false,
        },
      ],
    });
    const waiting = (await (
      await fetch(origin + "/v0/agent-runtime/runs/waiting", {
        headers: { authorization: "Bearer fixture-service" },
      })
    ).json()) as RuntimeStateSchemas["AgentRuntimeWaitingContexts"];
    expect(waiting.context_keys).toEqual([key]);

    const client = createTeamHubRuntimeStateClient({
      baseUrl: origin,
      serviceToken: "fixture-service",
      epoch: "epoch-a",
    });
    const registry = createTeamHubLocalComputerRegistry(client);
    const owner = { tenantId: "tenant-fixture", ownerActorId: "human-fixture" };
    await fetch(origin + "/__test__/local-computers", {
      method: "POST",
      headers: {
        authorization: "Bearer fixture-service",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        computer_id: "computer-fixture",
        display_name: "Fixture Computer",
        owner: {
          tenant_id: owner.tenantId,
          owner_actor_id: owner.ownerActorId,
        },
      }),
    });
    await expect(
      registry.credentialGeneration("computer-fixture", owner),
    ).resolves.toBe(0);
    await expect(
      registry.credentialGeneration("computer-fixture", {
        tenantId: "tenant-fixture",
        ownerActorId: "other-human",
      }),
    ).resolves.toBeNull();
    const hello = {
      ...runnerHello(),
      runner_id: "computer-fixture",
      display_name: "Fixture Computer",
      platform: "linux" as const,
      workspace_grants: [],
    };
    const placements = await registry.connect({
      computerId: "computer-fixture",
      owner,
      credentialGeneration: 0,
      hello,
      status: "offline",
    });
    expect(placements).toEqual([
      {
        agentId: "agent-fixture",
        tenantId: "tenant-fixture",
        ownerActorId: "human-fixture",
        runtimeType: "codex",
        model: "fixture",
        workspaceGrantId: "grant-fixture",
        assignmentRevision: 1,
      },
    ]);
    await expect(
      registry.touch("computer-fixture", {
        status: "online",
        seenAt: new Date().toISOString(),
        activeOperations: 0,
      }),
    ).resolves.toBeUndefined();
    await expect(
      registry.recordLocalModels("computer-fixture", {
        available: false,
        reason: { code: "TOOL_NOT_INSTALLED" },
        observed_at: new Date().toISOString(),
        pools: [],
        models: [],
      }),
    ).resolves.toBeUndefined();
    const claimed = await client.claimRun({
      context_key: key,
      epoch: "epoch-a",
      claim_id: "claim-fixture",
    });
    expect(claimed.claimed).toBe(true);
    await expect(
      client.recordRunOperation({
        context_key: key,
        epoch: "epoch-a",
        run_id: claimed.run!.run_id,
        operation_id: "op-fixture-1",
        runtime_type: "codex",
      }),
    ).resolves.toEqual({ success: true });
    const runtimeState = (await (
      await fetch(origin + "/__test__/runtime-state", {
        headers: { authorization: "Bearer fixture-service" },
      })
    ).json()) as {
      operation_receipts: {
        operation_id: string;
        agent_id: string;
        connection_epoch: number;
        run_id: string;
      }[];
    };
    expect(runtimeState.operation_receipts).toEqual([
      {
        operation_id: "op-fixture-1",
        agent_id: "agent-fixture",
        connection_epoch: 1,
        run_id: claimed.run!.run_id,
      },
    ]);
    await expect(
      registry.remove({ computerId: "computer-fixture", ...owner }),
    ).resolves.toBe("has-agents");
    const revoked = await fetch(
      origin + "/__test__/runtime-configs/agent-fixture",
      {
        method: "DELETE",
        headers: { authorization: "Bearer fixture-service" },
      },
    );
    expect(revoked.status).toBe(204);
    await expect(
      client.getDeletionSnapshot("agent-fixture"),
    ).resolves.toMatchObject({
      agent_id: "agent-fixture",
      tenant_id: "tenant-fixture",
    });
    await expect(
      registry.connect({
        computerId: "computer-fixture",
        owner,
        credentialGeneration: 0,
        hello,
        status: "online",
      }),
    ).resolves.toEqual([]);
    await expect(
      registry.remove({ computerId: "computer-fixture", ...owner }),
    ).resolves.toBe("removed");
    await expect(
      registry.credentialGeneration("computer-fixture", owner),
    ).resolves.toBeNull();
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGTERM");
      await once(child, "exit");
    }
    await rm(directory, { recursive: true, force: true });
  }
});
