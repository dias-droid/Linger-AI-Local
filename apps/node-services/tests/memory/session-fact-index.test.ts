import { describe, expect, it } from "vitest";
import {
  factChunk,
  factContext,
  messageAt,
  sessionFactText,
} from "../../src/memory/session-fact-index.js";

describe("Session fact binding", () => {
  it("takes the mention time and speaker from the enclosing Room message", () => {
    const content = [
      "## 2026-09-29T01:00:00.000Z · Ann",
      "",
      "Morning.",
      "",
      "## 2026-09-29T07:00:00.000Z · Bob",
      "",
      "Max turned three today.",
    ].join("\n");
    expect(messageAt(content, content.indexOf("Max turned"))).toEqual({
      mentionedAt: "2026-09-29T07:00:00.000Z",
      speaker: "Bob",
    });
    expect(
      messageAt("Recording transcript without headings", 5),
    ).toBeUndefined();
  });
});

describe("Session fact context", () => {
  it("tells the extraction what kind of text each origin is", () => {
    const at = { date: "2026-09-29", mail_class: null, replied: false };
    expect(factContext({ ...at, origin_kind: "room" })).toBe(
      "Conversation session on 2026-09-29",
    );
    expect(factContext({ ...at, origin_kind: "recording" })).toMatch(
      /^Meeting recording transcript on 2026-09-29.*Speakers may be unlabeled/u,
    );
    expect(factContext({ ...at, origin_kind: "pocket_note" })).toBe(
      "The user's own Pocket Note on 2026-09-29.",
    );
    const mail = { ...at, origin_kind: "mail" };
    expect(factContext({ ...mail, mail_class: "direct_inbound" })).toMatch(
      /^Email on 2026-09-29.*Attribute each fact/u,
    );
    // A notification may hold nothing worth keeping, unless the Human replied.
    expect(factContext({ ...mail, mail_class: "system_notification" })).toMatch(
      /^Automated email.*return none\.$/u,
    );
    expect(
      factContext({
        ...mail,
        mail_class: "system_notification",
        replied: true,
      }),
    ).toMatch(/^Email on/u);
  });
});

describe("Session fact chunk", () => {
  it("binds a fact to the window chunk sharing the most terms", () => {
    const chunk = (id: string, content: string) => ({
      id,
      content,
      start: 0,
      end: content.length,
      heading: "",
      headingPath: [],
      lineStart: 1,
      lineEnd: 1,
      level: 2,
    });
    const chunks = [
      chunk("a", "We talked about packing for the trip."),
      chunk("b", "Max the Golden Retriever turned three."),
    ];
    expect(
      factChunk(
        { what: "Max is a Golden Retriever", entities: ["Max"] },
        chunks as never,
      ).id,
    ).toBe("b");
  });
});

describe("Session fact text", () => {
  it("joins what, when, who and why as Hindsight stores them, skipping N/A", () => {
    expect(
      sessionFactText({
        what: "User started cello lessons",
        when: "February 2024",
        where: "Home",
        who: "user",
        why: "N/A",
        fact_type: "world",
      }),
    ).toBe(
      "User started cello lessons | When: February 2024 | Involving: user",
    );
    expect(
      sessionFactText({
        what: "Mia opened a bakery",
        when: "n/a",
        who: "Mia (user's sister)",
        why: "She wanted her own shop",
        fact_type: "world",
      }),
    ).toBe(
      "Mia opened a bakery | Involving: Mia (user's sister) | She wanted her own shop",
    );
  });
});

describe("temporal window coverage", () => {
  it("spreads entry points across the window instead of one busy day", async () => {
    const { selectWithTemporalCoverage } =
      await import("../../src/memory/search/temporal-window.js");
    const busy = Array.from({ length: 20 }, (_, i) => ({
      id: `busy-${i}`,
      date: "2026-04-02",
    }));
    const late = { id: "late", date: "2026-04-28" };
    const selected = selectWithTemporalCoverage(
      [...busy, late],
      (row) => row.date,
      {
        from: "2026-04-01",
        to: "2026-04-30",
      },
    );
    expect(selected).toHaveLength(10);
    expect(selected.map((row) => row.id)).toContain("late");
    // Similarity order (input order) is kept among the selected rows.
    expect(selected.at(-1)!.id).toBe("late");
  });

  it("nudges the fused order toward records near the as-of day", async () => {
    const { boostByRecency, recencyOnOrBefore } =
      await import("../../src/memory/search/temporal-window.js");
    expect(recencyOnOrBefore("2026-11-13", "2026-11-13")).toBe(1);
    expect(recencyOnOrBefore("2026-10-14", "2026-11-13")).toBe(0.5);
    expect(recencyOnOrBefore("2026-08-01", "2026-11-13")).toBe(0.1);
    // Not yet said on the day: the floor. Undated: neutral.
    expect(recencyOnOrBefore("2026-11-14", "2026-11-13")).toBe(0.1);
    expect(recencyOnOrBefore(undefined, "2026-11-13")).toBe(0.5);
    // Best-ranked first: a year-old best match, a fresh second, then filler.
    const rows = [
      { id: "old", date: "2025-11-01" },
      { id: "fresh", date: "2026-11-10" },
      ...Array.from({ length: 8 }, (_, i) => ({
        id: `filler${i}`,
        date: "2025-06-01",
      })),
      { id: "fresh-weak", date: "2026-11-13" },
    ];
    const order = (asOf: string) =>
      boostByRecency(rows, (row) => row.date, asOf).map((row) => row.id);
    expect(order("2026-11-13").slice(0, 2)).toEqual(["fresh", "old"]);
    // A fresh but weak match stays near the end.
    expect(order("2026-11-13").indexOf("fresh-weak")).toBeGreaterThan(5);
    // Before the fresh record existed, the relevance order stands.
    expect(order("2025-11-02").slice(0, 2)).toEqual(["old", "fresh"]);
  });
});
