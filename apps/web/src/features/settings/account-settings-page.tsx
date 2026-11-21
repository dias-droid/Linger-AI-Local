import { useTranslation } from "react-i18next";
import { useParams } from "react-router";

import { requireRoomRouteParam } from "@/features/rooms/room-route-params";
import { useTeamHubRuntime } from "@/features/teamhub/teamhub-runtime";

import { AccountProfileSettings } from "./account-profile-settings";
import { SettingsPageHeading } from "./settings-page-heading";

export function AccountSettingsPage() {
  const { t } = useTranslation("settings");
  const { client } = useTeamHubRuntime();
  const tenantId = requireRoomRouteParam(useParams().tenantId, "Tenant");

  return (
    <div className="mx-auto flex w-full max-w-(--app-settings-width) flex-col gap-8 pb-4">
      <SettingsPageHeading
        description={t("accountPage.description")}
        title={t("accountPage.title")}
      />

      <AccountProfileSettings client={client} tenantId={tenantId} />
    </div>
  );
}
