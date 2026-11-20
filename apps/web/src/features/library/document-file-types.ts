import { artifactFileKind } from "@/features/rooms/files/artifact-file-kind";
import {
  documentFileName,
  documentRepresentationFormat,
} from "./document-display-name";
import type { TeamHubDocumentTreeSummary } from "@/features/teamhub/teamhub-types";

const personalWikiIndexableFormats = new Set([
  "blocknote",
  "c",
  "cpp",
  "css",
  "csv",
  "doc",
  "docx",
  "dotx",
  "eml",
  "epub",
  "go",
  "h",
  "hpp",
  "htm",
  "html",
  "java",
  "js",
  "json",
  "jsx",
  "less",
  "log",
  "markdown",
  "md",
  "mht",
  "mhtml",
  "mmd",
  "odp",
  "ods",
  "odt",
  "pdf",
  "plain",
  "plain_text",
  "potx",
  "ppsx",
  "pptx",
  "py",
  "rs",
  "scss",
  "sh",
  "sql",
  "svg",
  "toml",
  "ts",
  "tsv",
  "tsx",
  "txt",
  "xlsx",
  "xltx",
  "xml",
  "yaml",
  "yml",
]);

export const documentFileTypes = [
  { value: "", label: "All types" },
  { value: "md", label: "Markdown" },
  { value: "pdf", label: "PDF" },
  { value: "word", label: "Word" },
  { value: "spreadsheet", label: "Spreadsheets (Excel / CSV)" },
  { value: "presentation", label: "PowerPoint" },
  { value: "html", label: "HTML" },
  { value: "text", label: "Plain text" },
  { value: "image", label: "Images" },
  { value: "audio", label: "Audio" },
  { value: "video", label: "Video" },
  { value: "archive", label: "Archives" },
  { value: "code", label: "Code" },
  { value: "others", label: "Others" },
] as const;

export function documentFileType(
  document: Pick<
    TeamHubDocumentTreeSummary,
    "format" | "representation_format" | "title"
  >,
): string {
  const format = documentRepresentationFormat(document);
  if (format === "markdown") return "md";
  if (format === "plain_text") return "text";
  if (format === "csv") return "spreadsheet";
  const name = documentFileName(document);
  if (/\.(txt|log)$/i.test(name)) return "text";
  if (/\.(doc|docx)$/i.test(name)) return "word";
  const kind = artifactFileKind(name);
  if (kind === "markdown") return "md";
  return kind === "document" || kind === "workflow" ? "others" : kind;
}

export function matchesDocumentFileType(
  document: Pick<
    TeamHubDocumentTreeSummary,
    "format" | "representation_format" | "title"
  >,
  type: string,
) {
  return !type || documentFileType(document) === type;
}

/**
 * Returns whether a Document's format is indexable by Personal Wiki admission.
 * Non-indexable binary uploads (such as archives, raster images, audio, and
 * video) are excluded even when stored under My pages with a wiki_source link.
 */
export function isPersonalWikiIndexableDocument(
  document: Pick<
    TeamHubDocumentTreeSummary,
    "can_edit_native_content" | "format" | "representation_format" | "title"
  >,
): boolean {
  if (document.format === "blocknote" || document.can_edit_native_content) {
    return true;
  }
  const format = documentRepresentationFormat(document).trim().toLowerCase();
  if (format && format !== "binary" && format !== "file") {
    return personalWikiIndexableFormats.has(format);
  }
  const name = documentFileName(document);
  const dot = name.lastIndexOf(".");
  const extension = dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
  return personalWikiIndexableFormats.has(extension);
}
