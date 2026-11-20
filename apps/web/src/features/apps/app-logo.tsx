import { PlugSocketIcon } from "@hugeicons/core-free-icons";
import { Icon } from "@/components/ui/icon";
import { useT } from "@/i18n/use-translation";
import { useState } from "react";

import { connectorMessages as m } from "./connectors.messages";

const SIZES = {
  md: { image: "size-6", icon: 20 },
  sm: { image: "size-3", icon: 12 },
  profile: { image: "size-4", icon: 15 },
} as const;

export function AppLogo({
  name,
  size = "md",
  url,
}: {
  name: string;
  size?: keyof typeof SIZES;
  url?: string;
}) {
  const [failedUrl, setFailedUrl] = useState<string>();
  const t = useT();
  return url && failedUrl !== url ? (
    <img
      alt=""
      className={`${SIZES[size].image} object-contain`}
      loading="lazy"
      referrerPolicy="no-referrer"
      src={url}
      onError={() => setFailedUrl(url)}
    />
  ) : (
    <span
      aria-label={t(m.appIcon, { name })}
      className="inline-flex"
      role="img"
    >
      <Icon icon={PlugSocketIcon} size={SIZES[size].icon} />
    </span>
  );
}

/**
 * A logo in the tile Connectors draws app logos in; `small` fits it beside a
 * dialog title. The name always sits beside it, so the tile is decorative.
 */
export function AppLogoTile({
  name,
  small = false,
  url,
}: {
  name: string;
  small?: boolean;
  url?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={`flex shrink-0 items-center justify-center rounded-lg bg-card text-foreground shadow-outline ${small ? "size-7" : "size-10"}`}
    >
      <AppLogo name={name} size={small ? "profile" : "md"} url={url} />
    </span>
  );
}
