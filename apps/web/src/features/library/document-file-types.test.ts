import { describe, expect, it } from "vitest";
import {
  documentFileType,
  isPersonalWikiIndexableDocument,
} from "./document-file-types";

describe("Workspace file types", () => {
  it.each([
    ["report.DOCX", "word"],
    ["budget.xlsx", "spreadsheet"],
    ["data.csv", "spreadsheet"],
    ["slides.pptx", "presentation"],
    ["diagram.svg", "image"],
    ["assets.zip", "archive"],
    ["source.ts", "code"],
    ["unknown.custom", "others"],
  ])("classifies binary file %s as %s", (title, expected) => {
    expect(
      documentFileType({
        title,
        format: "binary",
        representation_format: "binary",
      }),
    ).toBe(expected);
  });
  it("includes native documents in Markdown", () => {
    expect(
      documentFileType({
        title: "Untitled",
        format: "blocknote",
        representation_format: "markdown",
      }),
    ).toBe("md");
  });

  it.each([
    ["bundle.zip", "file", "zip", false, false],
    ["archive.tar", "file", "binary", false, false],
    ["photo.png", "file", "png", false, false],
    ["recording.mp3", "file", "mp3", false, false],
    ["demo.mp4", "file", "mp4", false, false],
    ["installer.bin", "file", "binary", false, false],
    ["notes.md", "file", "markdown", false, true],
    ["spec.pdf", "file", "pdf", false, true],
    ["report.docx", "file", "docx", false, true],
    ["diagram.svg", "file", "svg", false, true],
    ["Untitled", "blocknote", "markdown", true, true],
  ])(
    "classifies Personal Wiki indexability for %s (%s / %s) as %s",
    (
      title,
      format,
      representation_format,
      can_edit_native_content,
      expected,
    ) => {
      expect(
        isPersonalWikiIndexableDocument({
          can_edit_native_content,
          format,
          representation_format,
          title,
        }),
      ).toBe(expected);
    },
  );
});
