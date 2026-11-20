import { act, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { settingsMessages } from "@/features/settings/settings.messages";

import { setLanguage } from "./language";
import zhCN from "./locales/zh-CN.json";
import { useT } from "./use-translation";

function Title() {
  const t = useT();
  return <h1>{t(settingsMessages.title)}</h1>;
}

describe("translated components", () => {
  it("render again in the new language when it changes", async () => {
    render(<Title />);
    expect(screen.getByRole("heading")).toHaveTextContent("Settings");
    await act(() => setLanguage("zh-CN"));
    expect(screen.getByRole("heading")).toHaveTextContent(zhCN.settings.title);
    await act(() => setLanguage("en"));
    expect(screen.getByRole("heading")).toHaveTextContent("Settings");
  });
});
