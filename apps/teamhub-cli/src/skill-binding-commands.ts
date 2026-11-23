import type { CommandDefinition } from "./command-definition.js";
import { assertPositionals, requiredOption } from "./command-input.js";
import { CliError } from "./errors.js";
import { operationHeaders, teamHubData } from "./http-client.js";
import type { components } from "@linger/wire-contracts/teamhub-agent-api/types";

type Inventory = components["schemas"]["AgentSkillInventory"];

const list: CommandDefinition = {
  command: ["skill", "list"],
  toolName: "list_skill_bindings",
  description:
    "List your default Skills and explicit bindings, including disabled bindings.",
  readOnly: true,
  operationId: false,
  usage: ["teamhub skill list [--json]"],
  options: {},
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  outputSchema: {
    type: "object",
    required: ["binding_version", "items"],
    properties: {
      binding_version: { type: "integer", minimum: 1 },
      issues: {
        type: "array",
        items: {
          type: "object",
          required: ["path", "code", "message"],
          properties: {
            path: { type: "string" },
            code: { type: "string" },
            message: { type: "string" },
          },
        },
      },
      items: {
        type: "array",
        items: {
          type: "object",
          required: [
            "skill_id",
            "name",
            "manifest_version",
            "enabled",
            "is_default",
          ],
          properties: {
            skill_id: { type: "string" },
            name: { type: "string" },
            manifest_version: { type: "string" },
            enabled: { type: "boolean" },
            is_default: { type: "boolean" },
          },
        },
      },
    },
  },
  normalize: async (args) => {
    assertPositionals(args, 0);
    return { input: {} };
  },
  execute: async (_input, { client }) => ({
    ...(await teamHubData(client.api.GET("/api/agent/v1/skills/bindings"))),
  }),
  render: (result) => {
    const inventory = result as Inventory;
    return [
      `Binding version: ${inventory.binding_version}`,
      ...(inventory.issues ?? []).map(
        (issue) => `${issue.code}: ${issue.message} (${issue.path})`,
      ),
      ...inventory.items.map(
        (item) =>
          `${item.name} (${item.skill_id})  ${item.manifest_version}  ${item.is_default ? "default" : "explicit"}  ${item.enabled ? "enabled" : "disabled"}`,
      ),
    ].join("\n");
  },
};

const unbind: CommandDefinition = {
  command: ["skill", "unbind"],
  toolName: "request_skill_unbind",
  description:
    "Ask your Sponsor to remove an explicit Skill binding. Approval applies only to the selected revision.",
  readOnly: false,
  approval: "confirm",
  operationId: true,
  usage: ["teamhub skill unbind <skill-id> --binding-version <version>"],
  options: {
    "--binding-version": {
      description: "Binding version from teamhub skill list.",
    },
  },
  arguments: ["<skill-id>"],
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      skill_id: { type: "string" },
      expected_binding_version: { type: "integer", minimum: 1 },
    },
    required: ["skill_id", "expected_binding_version"],
  },
  outputSchema: {
    type: "object",
    properties: {
      status: { const: "submitted" },
      room_id: { type: "string" },
      message_id: { type: "string" },
      interaction_id: { type: "string" },
    },
    required: ["status", "room_id", "message_id", "interaction_id"],
  },
  normalize: async (args) => {
    assertPositionals(args, 1);
    const version = requiredOption(args, "--binding-version");
    if (!/^[1-9]\d*$/u.test(version) || !Number.isSafeInteger(Number(version)))
      throw new CliError(
        "usage",
        "Use the positive binding version from teamhub skill list.",
      );
    return {
      input: {
        skill_id: args.positionals[0],
        expected_binding_version: Number(version),
      },
    };
  },
  execute: async (input, { client, operationId }) => {
    const { agentOperationInvocationId } = await import("./business-routes.js");
    return {
      ...(await teamHubData(
        client.api.POST("/api/agent/v1/skills/unbind-requests", {
          body: {
            invocation_id: agentOperationInvocationId(operationId!),
            skill_id: String(input.skill_id),
            expected_binding_version: Number(input.expected_binding_version),
          },
          headers: operationHeaders(operationId),
        }),
      )),
    };
  },
  render: (result) =>
    `Skill removal request submitted. Check its decision in Room ${String(result.room_id)} (decision ${String(result.interaction_id)}).`,
};

export const skillBindingCommands: readonly CommandDefinition[] = [
  list,
  unbind,
];
