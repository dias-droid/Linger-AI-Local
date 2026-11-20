// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { resetLanguageForTest, setLanguage } from "@/i18n/language";
import zhCN from "@/i18n/locales/zh-CN.json";

import { AgentStatus } from "./agent-status";

afterEach(() => {
  cleanup();
  resetLanguageForTest();
});

describe("AgentStatus", () => {
  it("words the online status and the task count in English", () => {
    render(
      <AgentStatus
        availability={{
          status: "online",
          label: "Online",
          active_task_count: 1,
        }}
        showDetails
      />,
    );
    expect(screen.getByText("Online")).toBeInTheDocument();
    expect(screen.getByText(/1 task in progress/)).toBeInTheDocument();
  });

  it("follows the interface language", async () => {
    await setLanguage("zh-CN");
    render(
      <AgentStatus
        availability={{
          status: "online",
          label: "Online",
          active_task_count: 2,
        }}
        showDetails
      />,
    );
    expect(screen.getByText(zhCN.agentInfo.online)).toBeInTheDocument();
    expect(
      screen.getByText(
        new RegExp(
          zhCN.agentInfo.tasksInProgress.other.replace("{count}", "2"),
        ),
      ),
    ).toBeInTheDocument();
  });

  it("shows the label TeamHub sent for any other status as it is", async () => {
    await setLanguage("zh-CN");
    render(
      <AgentStatus
        availability={{
          status: "unknown",
          label: "Status unavailable",
          active_task_count: 0,
        }}
      />,
    );
    expect(screen.getByText("Status unavailable")).toBeInTheDocument();
  });
});
