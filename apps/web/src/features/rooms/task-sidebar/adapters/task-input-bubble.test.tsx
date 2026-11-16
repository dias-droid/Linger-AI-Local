import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { TaskInputBubble } from "./task-input-bubble";

const heights = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  "scrollHeight",
);

afterEach(() => {
  if (heights)
    Object.defineProperty(HTMLElement.prototype, "scrollHeight", heights);
  else Reflect.deleteProperty(HTMLElement.prototype, "scrollHeight");
});

function contentOverflows() {
  Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
    configurable: true,
    get: () => 400,
  });
}

describe("TaskInputBubble", () => {
  it("shows a short input whole, without a fold", () => {
    render(<TaskInputBubble authorKind="agent" body="Add a closing letter." />);

    expect(screen.getByText("Add a closing letter.")).toBeVisible();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("folds a long input to its first lines and opens it in place", () => {
    contentOverflows();
    render(
      <TaskInputBubble
        authorKind="agent"
        body={"Write the report.\n\n1. Opening\n2. Events\n3. Finances"}
      />,
    );
    const content = screen
      .getByText("Write the report.")
      .closest(".message-markdown")!.parentElement!;

    const more = screen.getByRole("button", { name: "Show more" });
    expect(more).toHaveAttribute("aria-expanded", "false");
    expect(content).toHaveClass("max-h-[110px]", "overflow-hidden");

    fireEvent.click(more);

    const less = screen.getByRole("button", { name: "Show less" });
    expect(less).toHaveAttribute("aria-expanded", "true");
    expect(content).not.toHaveClass("max-h-[110px]");

    fireEvent.click(less);

    expect(screen.getByRole("button", { name: "Show more" })).toBeVisible();
    expect(content).toHaveClass("max-h-[110px]");
  });

  it("caps the width on a wrapper, since the bubble's own max-width outranks utilities", () => {
    render(<TaskInputBubble authorKind="human" body="Hi" />);
    const bubble = screen
      .getByText("Hi")
      .closest(".room-message-bubble") as HTMLElement;

    expect(bubble.className).not.toContain("max-w-");
    expect(bubble.parentElement).toHaveClass("max-w-[85%]");
  });
});
