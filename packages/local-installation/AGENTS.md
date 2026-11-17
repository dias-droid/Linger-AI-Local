# Local installation core

This package owns instance state, the Native service lifecycle, local account
provisioning and Computer enrollment. The installer service
(`apps/linger-installer`) adapts its structured inputs and redacted events;
the core must not import app source or depend on browser/terminal UI.

Keep instance mutations locked and private state owner-only. Never infer real
Room execution from readiness. Do not reset existing accounts or Computer IDs,
stop unrelated processes, pull mutable images, or delete volumes as recovery.
Every installation runs natively from a Linger source checkout; Docker is not
used.

The account file records provisioning history, not current database readiness
or a promise that its saved password is still current. On HTTP 401, the existing
idempotent owner command establishes whether this email owns the deployment and
can recreate a missing owner without resetting a password. Confirm login after
it: a provisioned owner whose password was deliberately changed remains ready
when the owner command succeeded and login still returns 401. This grants no
session and does not replace saved credentials. A failed owner command, other
login errors, or an unprovisioned account whose login fails must not be treated
as a changed password.

Each instance directory holds `user.env` (0600), the only file a person edits:
`COMPOSIO_API_KEY`, `SONIOX_API_KEY`, `XAI_API_KEY` and `TZ`
(`user-environment.ts`). Every mode merges it into the generated
`compose.env` / `native.env` over a developer checkout's `.env` and under the
installer's own values; other names are ignored with a warning, and the file
is created from a template once and never rewritten. The desktop source
package's `.env` is not read. Voice keys are normally saved in the app
(TeamHub); a key in `user.env` overrides it. Whenever the distribution has
voice tools for this computer, Native prepares them and runs LiveKit with
the key pair and ports in the instance's `livekit.env`, with or without a
voice key; without them, or when they fail to prepare, TeamHub gets
`TEAMHUB_VOICE_MEDIA=off` and the install continues. The services' `voice`
setting tracks only the tools, so a key change never restarts them through
it. A native process restarts when its generated environment changes.
Every update or recreate path stops node-services on its own, right before
TeamHub restarts (natively: for a changed configuration) and while TeamHub is
still up, so its graceful shutdown requeues in-flight Agent Runs.

The home is `LINGER_HOME`, else `~/.simplexai` (`home.ts`). Installs from
before the product was renamed Linger convert once in
`legacy-migration.ts`, which the installer runs before it opens the home and
the desktop runs through `installer.js --migrate`. Under each instance's lock
it stops the instance's Computer and native services, renames `SIMPLEX_*`
keys in the generated env files, and gives the instance its
`linger-<name>-<hash>` project name. The legacy project name in
`instance.json` marks an instance as not yet converted, so it is written last
and a rerun after a crash converges. A damaged record is skipped. An
instance that fails keeps its legacy names and is returned with its reason;
it does not stop the others or the installer, and the next start tries it
again. `loadInstance` refuses such an instance with an error that says so.
Only something still running keeps an instance unconverted: work its
Computer reports, or a native service that will not stop. A stop that fails
because its program or runtime left with the earlier app (an unreadable
Computer status, a failed idle stop, a recorded PID now owned by another
program, an old gateway's tools) counts as stopped. A Docker-mode record
(`mode` "source" or "release") is never converted or counted as pending:
`loadInstance` refuses it, and its compose project name removes its
containers. The
cache markers `.simplex-files.json` and `.simplex-model-package.json` keep
their names.

Native PostgreSQL runs `initdb` in `native/postgres-data.partial` and moves
it to `native/postgres-data` only once it succeeds, so a killed `initdb`
never leaves a directory that later attempts treat as initialized. A `postgres-data` with
`PG_VERSION` but no `postmaster.opts` (which only a started server writes)
never served a connection, holds no data, and is initialized again.

Every Linger release creates TeamHub's schema from the 852 baseline
migration, which refuses a database that already holds one. A database from
the desktop app before the rename has `public.accounts` but no applied 852
row in `goose_db_version`, so it can never migrate (`legacy-database.ts`).
Once the database is up, Native checks for that; for such a database it
stops PostgreSQL, marks `local-account.json` as not provisioned (so private
login/enrollment reads refuse it until the account step confirms the owner in
the replacement database) and
moves `data/agent`, `data/artifacts`, `computer-enrollment.token` and, last,
`native/postgres-data` into `simplex-backup-<UTC time>` in the instance,
deleting nothing. The database moves last so that a run stopped partway
still finds it and finishes the move, into the same folder when nothing
there would be overwritten. It then opens a
fresh cluster and logs where the data went. The desktop finds the newest backup folder
after the job, enrolls its Computer again once (the old Computer ID is
unknown to the fresh database) and shows the folder on its ready screen.

Move a freshly downloaded or unpacked file or folder into place with
`renameRetrying` from `fs-retry.ts`: on Windows antivirus and indexing hold
new files for a moment, and a plain rename then fails with EPERM.

Run `pnpm --filter @linger/local-installation check`; `make check-installer`
also runs its consumer, the installer, and applies to changes that affect its
public behavior.
