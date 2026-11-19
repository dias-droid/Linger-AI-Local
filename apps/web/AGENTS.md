# Web: Vite React Product Client for TeamHub

React Router Data Mode and TanStack Query power the active Room-first UI.

## Common Commands

- `pnpm --filter @linger/web test <test-file>`: run one test. Use the script, not `exec vitest`: it disables Node's experimental Web Storage, which hides jsdom's `localStorage`.
- `pnpm --filter @linger/web typecheck`: typecheck Web.
- `pnpm --filter @linger/web test:build`: run real Vite build configuration tests (`*.build.test.ts`, also run by `make check-web-build`).
- `make check-web`: run Web types, tests, and React diagnostics. Run this
  before opening a pull request. If the change adds a static import on the
  Room or app initial graph, also run `pnpm --filter @linger/web run
build:assets` to check the initial JS budget.
  CI runs it as `make check-web-static` plus `make check-web-tests` in two
  shards (`SHARD=1/2` and `SHARD=2/2`).

## Structure

- Connector authorization uses the Web completion route or, when the desktop
  bridge is available, its one-time browser callback. The signed-in desktop
  page asks TeamHub to verify the return and refreshes its connector queries.

- `src/app`: routes, providers, route error boundaries, and global CSS.
- `src/features/teamhub`: Human API, Session, error, and realtime adapters.
- `src/features/rooms`: Room routes, Chat, Timeline, the right sidebar (Agent Info, Activity, Thread, Document) and membership UI.
- `src/features/local-models`: Settings › Models (`settings/models?computer=<id>`).
  Its tabs read and switch the Computer's model source (Local model,
  Subscription, BYOK) through TeamHub's `model-source` API, which asks the
  Computer live; the page never holds a saved API key, and a switch refused
  with `AGENT_HAS_ACTIVE_RUNS` retries with `force_terminate` only after the
  owner confirms. The Local model tab is one Computer's model library as
  TeamHub last stored it. The Computer decides
  fit, availability, placement, the recommendation and memory; the page only
  orders and labels them, picks the Make room default (including external-app
  cleanup & `Recheck memory` prompts when other apps occupy pool memory or
  unified memory is constrained), shows an explicit `Memory guidance` banner and
  `Recheck memory` button (`POST .../local-models`), lets owners pick among
  installed local models in `SwitchToLocalNotice` or click `Use for Agents` on a
  loaded row, renders tinted family
  icon tiles, Agent usage counts, structured capability/parameter badges (never
  matched against `name` or `description`), state-distinct cards (`loaded`,
  `recommended`, `failed`, `unavailable`), download speed/ETA, live Bifrost
  (`Pi`) `Gateway` readiness, and top
  diagnostic callouts with a two-column model-card facts grid from structured
  `LocalModel` fields in `local-models-rules.ts`, resolves Sponsor-owned Agent
  eligibility and `Pi` runtime switch payloads in `local-model-agents.ts`
  (`Use with <Another Me>`, `Open chat`, `Switch Agent…` in `Used by`, and
  `Make room` automatic Agent handoff once the replacement model loads when `Pi`
  is ready), and maps every code and enum
  label to English in `local-models-copy.ts`. Without `?computer=`
  the desktop app opens
  its own Computer. Only the Computer's owner can act; actions return at once
  and progress arrives as `local-models` invalidation hints. From the click
  until a snapshot with another status or observation time, or a refusal, the
  row shows a requested load or download as started, labels a cancel, unload
  or remove under way (Cancelling, Unloading, Removing), and spins that
  action's button, with the row's actions off; a download the Computer
  accepted can be cancelled before its first progress. Make room lists what
  else holds the pool (components, and other apps from `used_bytes` no holder
  accounts for) when unloading models cannot free enough, and says a model
  cannot fit only when it needs more than the pool's total. A Computer's
  detail on the Computers page links here and reads no model state itself.
- `src/test`: unit-test support, including the in-process TeamHub test server.
- `e2e`: Playwright product workflows; every spec runs on the real TeamHub and
  Document Runtime stack (`make check-e2e-room-document`).

## Important Conventions

- The first-visit Agent introduction uses its display name from TeamHub,
  including the default `Linger` name and any name the Human chooses.
- The login page keeps Linger's headline and day timeline on the left,
  and the sign-in form on the right. A faint white grid fades gently into the
  form's white background without a dark panel, colored glow, or blur. The
  timeline speaks in the first person and uses dark and muted text on white;
  reduced motion holds its first nudge still. Below 64rem the illustration is
  hidden, while the form keeps its visible labels and optional desktop account sign-in.
- Login body copy uses the Room font and chat body typography tokens. Times,
  dividers, and the footer use the chat metadata tokens. Its titles keep their
  own scale, with desktop content inset toward the middle on both sides and
  the left copy and timeline inset by two additional 40px grid cells. Linger
  uses the red panda portrait on its warm brown tile.
- The login header uses the transparent horizontal Linger wordmark in
  `public/linger-wordmark.svg`, with the proportions of `assets/logo-horizontal.svg`.
- Switching between Meeting and Voice Mode ends the previous session and
  releases its microphone before the new mode starts. Meeting saving can
  continue in the background. If browser activation expires during the
  switch, the new mode opens in the page and can be floated from there.
  During Live, the Meeting entry offers to start a new Meeting even while an
  earlier one is saving. Both in-page voice windows retain a visible, draggable
  title bar: dark in browsers, the window's own surface colour in the desktop
  app. Picture-in-picture keeps the browser title bar. The desktop app cannot
  open picture-in-picture, so there voice windows stay in the page, offer no
  float button, and on macOS stay out of the window drag strip.
- The compact primary rail reveals labels on hover and keyboard focus without
  moving link hit areas or neighbouring links. A stationary pointer at an edge
  must not trigger repeated hover enter/leave; sidebar expansion and Chat list
  collapse remain explicit button actions. Pointer movement only resizes during
  an active drag; keyboard resizing and double-click reset remain available.
- Recording picture-in-picture collapse remembers that window's actual
  expanded outer dimensions and restores both dimensions with an absolute
  resize inside the user's click, bounded by the current screen. A pending
  native resize must not replace the saved expanded size with collapsed
  metrics. Collapse never closes the window or stops the recording; native
  window placement remains under browser control.
- Recording and Voice Mode distinguish the native window's close action from
  back to tab through the shared PiP return detection. Back to tab keeps the
  session running in the page and exposes a Float action; close ends it.
  Recording moves one portal host between documents so paused state, Ask
  drafts and transcript scroll survive the move. Hide it while classifying a
  native close, and ignore a late result after unmount or a replacement window.
- Gmail and Outlook message approvals show the subject and recipients once.
  The subject row toggles the preview and owns its hover highlight; the
  recipient line stays outside the control. The shared AutoHeight transition
  and chevron rotation use the chat resize timing and reduced-motion setting.
  Expanding replaces the compact recipient line with read-only
  From/To/Cc/Bcc headers, followed by the full body and attachments. An empty
  Cc row reads None; Bcc appears only when populated. Email
  actions are Send and Don't send; declining does not request a reason.
- A gmail canvas message segment renders as its email card
  (`rooms/chat/message-mail-canvas.tsx`), laid out like a message approval:
  subject row with open-in-panel and expand controls, recipient line, then
  Send and Don't send, or one receipt line once decided; an unknown result
  keeps Send again and Don't send. Only members who can edit see the actions,
  and with several Gmail accounts a Send from picker chooses the sender.
  Expanding mounts the same collaborative editor as the side panel; Send waits
  until it is saved and posts the digest the card last loaded, refreshed after
  each durable save. Clicking Send is what uploads to Gmail; the side-panel
  canvas has no Send.
- Active product data comes from TeamHub, never retired Workspace APIs. Web has
  no fixture backend and no build mode that swaps TeamHub out.
- Unit tests that need TeamHub use `createTestTeamHubRuntime`
  (`src/test/teamhub-test-runtime.ts`): the real typed client against an
  in-process `TeamHubTestServer` that answers seeded reads. Declare every write a
  test depends on with `runtime.server.on(...)` or an `accept*` helper; an
  undeclared request fails with `TEST_ROUTE_MISSING`. Tests of one client call
  may inject `fetchRequest` (`fetchDouble`) instead.
- Unit tests must not depend on machine speed: rely on the global 5s async wait (Testing Library and `vi.waitFor`) instead of per-test `timeout` options, use fake timers for time-based behavior, and put real Vite/Rollup builds in `*.build.test.ts`.
- TanStack Query owns remote state; route loaders only ensure feature-owned queries.
- Components do not handwrite TeamHub endpoints or wire DTOs. Every TeamHub
  request names a generated contract path through the `openapi-fetch` client in
  `src/features/teamhub/teamhub-api.ts`; SSE, XHR upload, and download URLs use
  its `teamHubUrl`.
- Web never serves the Local Computer release. The Agent Service owns
  `/install/`: the production static host forwards `/install/`,
  `/v1/runner-gateway`, `/v1/local-mcp-relay/`, and `/v1/context-content/` to
  `TEAMHUB_NODE_SERVICES_URL` when it is set, and Vite
  development forwards `/install/` to the local Agent Service listener. Both
  hosts forward the Computer `teamhub` CLI's `/api/agent/` to
  `TEAMHUB_BASE_URL`, so a Computer needs only the Web origin.
  Never bundle installers or CLI releases into Web.
- Effects owning SSE, WebSocket, polling, timers, or subscriptions may depend only on resource identity; UI callbacks and presentation state must not recreate them. Lifecycle changes require a test proving unrelated rerenders do not resubscribe and identity changes clean up exactly once.
- Browser configuration for local Vite reads `import.meta.env.VITE_*`
  through the app config boundary. Production builds follow the page origin
  (same-origin TeamHub `/v0` and Document Runtime `/document-collaboration`)
  so one image works on every gateway, test environment, and deployed
  environment.
- Use Tailwind and local components; do not add a broad UI library. Render UI icons
  only through `Icon` from `src/components/ui/icon.tsx` with
  `@hugeicons/core-free-icons` (14px in rows and menus, 16px in buttons and the
  rail); `lucide-react` remains only in the Runtime activity views
  (`src/features/rooms/task-sidebar/adapters/runtime-history-view.tsx` and
  `src/features/rooms/runtime-status/runtime-tool-presentation.ts`).
- Styling: Tailwind utilities plus design tokens are the standard. Use token
  classes (Town semantic tokens such as `text-muted-foreground`, or
  `--color-app-*` roles such as `text-app-ink`) instead of hex arbitrary values;
  when no token fits, add one to `src/app/visual-theme.css` and the
  `@theme inline` block in `src/app/globals.css`.
- Input hints use `--app-placeholder` / `text-app-placeholder` across native
  fields, chat composers, select prompts, and editable empty states. Keep
  entered text and adjacent labels on their own text tokens.
- Room avatar stacks give each tile an opaque surface behind the member's
  portrait or initials so overlapping members never show through one another.
- Compose conditional class names with `cn` from `src/lib/cn.ts`.
- Do not add CSS Modules or feature-level `.css` files, and do not add new hex
  colors in TSX. Use inline `style` only for runtime-computed values.
- Keep element-level CSS resets (for example `button, input { font: inherit }`) inside
  `@layer base`; unlayered rules beat Tailwind utilities and silently disable `text-*`
  classes. Reference CSS variables for font families with
  `font-(family-name:--var)`, never `font-[var(--var)]`, which Tailwind reads as a
  font-weight.
- Two Tailwind utilities that set the same CSS property are resolved by their order
  in the generated stylesheet, not by their order in the `className` string. Writing
  the one you want last does nothing. Never stack competing `display` or `position`
  utilities on one element, and never pass such a utility to a component that already
  hardcodes one: `.relative` is emitted after `.absolute`, so an `absolute` handed to
  a component whose base classes include `relative` is dropped and the element falls
  back into normal flow; `.block` is emitted after `.line-clamp-*`, so adding `block`
  replaces the `display:-webkit-box` the clamp needs and the clamp stops truncating.
  Put the conflicting utility on a wrapper element instead. Neither typecheck nor
  React Doctor catches this and it renders fine in unit tests, so assert the outcome
  (the wrapper carries the positioning, the clamped node carries no `block`) in a test
  and confirm that test fails when the utility is put back on the same element.
