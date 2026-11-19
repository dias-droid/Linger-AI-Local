/**
 * Names the catalog apps the Human can connect and routes a request about one
 * of them to the connected app commands, so an unconnected app gets an
 * authorization card instead of a browser session.
 */
export function connectableAppsRule(keys: readonly string[]): string {
  return keys.length === 0
    ? ""
    : ` Apps the Human can connect: ${keys.join(", ")}. When a request involves one of these apps, including a link to it, use teamhub apps, not the browser: with no account, run teamhub apps connect <app-key> to post an authorization card instead of asking for credentials, and end your turn; the card result wakes you. Then find the tool with teamhub apps search and run it with teamhub apps execute.`;
}

/** Names the apps the Agent could use when the Run started, by app key. */
export function connectedAppsAtRunStart(keys: readonly string[]): string {
  return keys.length === 0
    ? "no app had an account you can use"
    : `these apps had an account you can use: ${keys.join(", ")}`;
}
