import { useState } from "react";
import { useTranslation } from "react-i18next";

import { SettingsGroup } from "@/components/ui/settings-group";
import { cn } from "@/lib/cn";
import { applyLanguageChoice } from "@/i18n/i18n";
import {
  readStoredLanguageChoice,
  resolveLanguageFromChoice,
  uiLanguageNames,
  type LanguageChoice,
} from "@/i18n/languages";

import { syncDesktopLanguage } from "./desktop-language";
import { SettingsPageHeading } from "./settings-page-heading";

const languageOptions = [
  "system",
  "en",
  "zh-CN",
] as const satisfies readonly LanguageChoice[];

export function LanguageSettingsPage() {
  const { t } = useTranslation();
  const [choice, setChoice] = useState<LanguageChoice>(
    readStoredLanguageChoice,
  );
  const deviceLanguages =
    typeof navigator === "undefined" ? [] : (navigator.languages ?? []);
  const deviceLanguage = resolveLanguageFromChoice("system", deviceLanguages);

  function choose(option: LanguageChoice) {
    setChoice(option);
    applyLanguageChoice(option, deviceLanguages);
    syncDesktopLanguage(option);
  }

  return (
    <div className="mx-auto flex w-full max-w-(--app-settings-width) flex-col gap-8 pb-4">
      <SettingsPageHeading
        description={t("language.description")}
        title={t("language.title")}
      />
      <SettingsGroup footer={t("language.savedToThisDevice")}>
        <div aria-label={t("language.title")} role="radiogroup">
          {languageOptions.map((option) => (
            <LanguageOption
              checked={choice === option}
              description={
                option === "system"
                  ? t("language.option.systemDetail", {
                      language: uiLanguageNames[deviceLanguage],
                    })
                  : undefined
              }
              key={option}
              label={
                option === "system"
                  ? t("language.option.system")
                  : uiLanguageNames[option]
              }
              onSelect={() => choose(option)}
            />
          ))}
        </div>
      </SettingsGroup>
    </div>
  );
}

function LanguageOption({
  checked,
  description,
  label,
  onSelect,
}: {
  checked: boolean;
  description?: string;
  label: string;
  onSelect: () => void;
}) {
  return (
    <button
      aria-checked={checked}
      className="flex w-full items-center gap-3 border-t border-border px-3.5 py-2.5 text-left transition-colors duration-150 first:border-t-0 hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none motion-reduce:transition-none"
      onClick={onSelect}
      role="radio"
      type="button"
    >
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[14px] font-medium leading-[18px] text-foreground">
          {label}
        </span>
        {description ? (
          <span className="mt-px block truncate text-xs leading-[17px] text-muted-foreground">
            {description}
          </span>
        ) : null}
      </span>
      <span aria-hidden="true" className="flex shrink-0 items-center pr-1">
        <span
          className={cn(
            "flex size-4 items-center justify-center rounded-full border transition-colors duration-150 motion-reduce:transition-none",
            checked ? "border-foreground" : "border-border",
          )}
        >
          {checked ? (
            <span className="size-2 rounded-full bg-foreground" />
          ) : null}
        </span>
      </span>
    </button>
  );
}
