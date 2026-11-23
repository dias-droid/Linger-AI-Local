# Local Computer

The Local Computer is the resident Daemon on a user's machine, its
`linger-computer` control CLI, the outbound Runner Gateway transport, and the
workspace grants. Both programs are Go binaries built from `local-daemon/`; the
release bundle also ships a pinned Node runtime for the `teamhub` CLI and the
managed Computer tools.

## Install

Install from the Computers page of the Linger Web app, or run the installer
the Web origin serves. On macOS and Linux:

```bash
curl -fsSL "http://localhost:3000/install/linger-computer.sh" | bash
linger-computer login
```

On Windows, in an ordinary (non-elevated) PowerShell:

```powershell
irm "http://localhost:3000/install/linger-computer.ps1" | iex
linger-computer login
```

`linger-computer login` authorizes the computer in the browser and starts the
Daemon. A server connection token from the Web app works too:
`linger-computer login --token-stdin`. Then use `linger-computer daemon status`,
`linger-computer runtime check <codex|claude|pi|antigravity>`, and `linger-computer doctor`;
`linger-computer --help` lists every command.

## Runtimes

The Daemon and the CLI share one Runtime environment and launcher path, so
`linger-computer runtime check` reports what the Daemon will run.
`AUTH_REQUIRED` means the Runtime runs but has no provider yet.
`linger-computer runtime login <type>` opens the Runtime the way the Daemon
starts it and works on every platform, for example:

```bash
linger-computer runtime login pi
```

In Pi, enter `/login`. On Windows this is the way to sign in, because a bare
Runtime command may start on a different Node and launcher. On macOS and Linux
the Runtime's own sign-in command (`codex login`, `claude auth login`, or `pi`
then `/login`) works too. Leaving the Runtime prints the check again; a
configured provider reads `READY`, and the Daemon reports the same state on its
next probe.

On Windows, an npm-installed Codex, Claude Code or Pi starts on the Node the
bundle ships in `<install>/runtime/bin`, so a machine Node below a Runtime's
engine requirement cannot fail its startup. `PATH` is unchanged, so the tools a
Runtime runs still resolve through the user's environment. Pi starts through
its `cli.js` instead of its PowerShell launcher, which drops the empty
`--system-prompt` value the Daemon's probe sends.

### Antigravity

`agy` runs through its Agent Client Protocol server, `agy acp`, and signs in to
its own account instead of taking models from the local gateway or a BYOK
endpoint. Install it on the computer the Agent runs on:

```bash
# Linux and macOS
curl -fsSL https://antigravity.google/cli/install.sh | bash
# Windows PowerShell
irm https://antigravity.google/cli/install.ps1 | iex
```

Sign in with Google, or export `GEMINI_API_KEY` in the environment the Daemon
starts in, then check it:

```bash
linger-computer runtime login antigravity   # persists runtime_paths when given --antigravity-path
linger-computer runtime check antigravity
```

`runtime check antigravity` answers `READY`, `AUTH_REQUIRED` (exit 11) when the
Runtime runs but is signed out — the first state a new install shows —
`INCOMPATIBLE` below 1.5.12, `NOT_INSTALLED` with the platform's install
command, or `ERROR`. An `agy` outside `PATH` goes in with
`--antigravity-path <path>`, which persists into `runtime_paths` when it is
passed to `runtime login` (on `runtime check` it applies to that check only).
A Desktop installation cannot choose the runtime from its setup page; the
embedded Web Computer page shows it.

What Antigravity shares with the other ACP runtimes and what it does not is in
[local-daemon/README.md](./local-daemon/README.md#antigravity): it loads the
user's own rules, skills and MCP config, it gets no `teamhub` command checks,
model errors arrive as reply text, and it runs no local models. It also has no
`model.invoke`, so background Memory and Wiki calls fall back to Claude Code on
the same computer, or to Codex when only Codex is ready, and a computer with
only `agy` installed sees those calls fail.

Conventions and boundaries are in [AGENTS.md](./AGENTS.md).
