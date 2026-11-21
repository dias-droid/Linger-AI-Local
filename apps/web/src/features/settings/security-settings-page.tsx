import { Tick02Icon } from "@hugeicons/core-free-icons";
import { Icon } from "@/components/ui/icon";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { teamHubDone } from "@/features/teamhub/teamhub-api";
import { useTeamHubRuntime } from "@/features/teamhub/teamhub-runtime";

import { ApiKeysSettings } from "./api-keys-settings";
import { ChangePasswordDialog } from "./change-password-dialog";
import { SettingsPageHeading } from "./settings-page-heading";

export function SecuritySettingsPage() {
  const { t } = useTranslation("settings");
  const { client } = useTeamHubRuntime();
  const [changePasswordOpen, setChangePasswordOpen] = useState(false);
  const [passwordChanged, setPasswordChanged] = useState(false);

  return (
    <div className="mx-auto flex w-full max-w-(--app-settings-width) flex-col gap-8 pb-4">
      <SettingsPageHeading
        description={t("security.description")}
        title={t("security.title")}
      />

      <section className="rounded-2xl border border-border bg-background p-6">
        <div className="flex flex-col justify-center gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm text-foreground">{t("security.password")}</p>
            <p className="text-sm text-muted-foreground">
              {t("security.passwordHint")}
            </p>
          </div>
          <Button
            onClick={() => {
              setPasswordChanged(false);
              setChangePasswordOpen(true);
            }}
          >
            {t("security.changePassword")}
          </Button>
        </div>
      </section>

      <ApiKeysSettings />

      {passwordChanged ? (
        <p
          className="flex items-center gap-2 text-sm text-app-success"
          role="status"
        >
          <Icon icon={Tick02Icon} size={16} />
          {t("security.changed")}
        </p>
      ) : null}

      {changePasswordOpen ? (
        <ChangePasswordDialog
          changePassword={({ currentPassword, newPassword }) =>
            teamHubDone(
              client.api.POST("/v0/account/password", {
                body: {
                  current_password: currentPassword,
                  new_password: newPassword,
                },
              }),
            )
          }
          onChanged={() => setPasswordChanged(true)}
          onClose={() => setChangePasswordOpen(false)}
        />
      ) : null}
    </div>
  );
}
