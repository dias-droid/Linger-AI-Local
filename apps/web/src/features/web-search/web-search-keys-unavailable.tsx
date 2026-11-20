/** Why no key field shows: the server has nothing to seal keys with. */
export function WebSearchKeysUnavailable() {
  return (
    <p className="text-app-muted">
      This server cannot store web search keys. Set{" "}
      <code className="font-mono">TEAMHUB_SECRET_ENCRYPTION_KEY</code> where it
      runs, then add the key here.
    </p>
  );
}
