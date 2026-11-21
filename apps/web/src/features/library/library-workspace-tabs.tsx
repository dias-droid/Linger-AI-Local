import { useTranslation } from "react-i18next";

import { UnderlineTabs } from "@/components/ui/underline-tabs";

// Labels and empty lines are catalog keys; render sites translate them.
export const workspaceTabs = [
  {
    empty: "noDocumentsCreatedByYou",
    id: "owned",
    label: "myPages",
  },
  {
    empty: "noDocumentsSharedWithYou",
    id: "shared",
    label: "sharedWithMe",
  },
  { empty: "", id: "meetings", label: "meetingsLabel" },
] as const;
export type WorkspaceTab = (typeof workspaceTabs)[number]["id"];

export function WorkspaceTabs({
  onChange,
  value,
}: {
  onChange: (tab: WorkspaceTab) => void;
  value: WorkspaceTab;
}) {
  const { t } = useTranslation("library");
  return (
    <UnderlineTabs
      items={workspaceTabs.map((tab) => ({ ...tab, label: t(tab.label) }))}
      label={t("libraryViews")}
      onChange={onChange}
      value={value}
    />
  );
}
