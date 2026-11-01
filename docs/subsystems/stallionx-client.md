# StallionX client

This checkout is the StallionX desktop client, based on magpie under MIT.
The original copyright and license are preserved in LICENSE. Internal Go
module paths, gateway protocol identifiers and agent configuration IDs remain
upstream-compatible; this is not a wholesale rename of every `magpie` token.

## Independent desktop releases

[Release guide](../releases.md) owns the Mac/Windows packaging contract,
GitHub environment and signing setup, manual draft-release procedure, and
verification limits. `.github/workflows/release.yml` builds only an explicitly
selected `stallionx-vX.Y.Z` commit, never dispatches upstream releases, and
never automatically publishes a draft. Automatic updates remain separate.

## Upstream integration

On 2026-11-01, main fast-forwarded 127 upstream commits from `da0005df8`
to `d1a94f579`. Uncommitted fork changes were restored without creating a
branch or committing them. The provider rendering merge preserves upstream's
`providersBehind` state and the StallionX account card. Windows' new DPI-specific
ICO and 20/24/40px executable resources are generated from StallionX artwork
by `build/icon/stallionx-icons.sh` and `stallionx-ico.py`.

The missing console bridge functions are now implemented. Both the isolated Web
bundle and native developer binary build. The current console architecture and
verification are described below; this is not a release-acceptance record.

## Embedded Web account console

The current account UI replaces the single tabbed wallet with independent native
sidebar destinations for overview, API keys, request logs, recharge, orders,
balance history, profile and team management. Playground, models/pricing, plans
and subscription usage are temporarily hidden in personal/team menus and global
search; their routes and implementations are retained.
Collapsing the sidebar hides its group labels and retains the shell's single-row
top navigation. The account adapter refits the strip after asynchronous menus,
workspace changes and resize, preserves readable tab labels, and scrolls overflow
with the wheel/trackpad or keyboard focus. Selection highlighting and visibility
follow the actual account route, not the shared `stallion-wallet` view ID.
During account-console startup, a native loading placeholder replaces the legacy
Extend/User center entry. The old group/entry never paints, and the temporary
account breadcrumb is withheld until an authenticated navigation manifest arrives.
Menus replace the placeholder together. A failed session/bootstrap or a 20-second
startup deadline offers a retry in navigation and the account page; stale frame
completion cannot restore a prior attempt. No account/team navigation is persisted
or trusted as a substitute for current server authorization.
The retained `stallionx-wallet.js` renderer and wallet APIs are legacy compatibility
paths, not the production account entry. Table-only descriptions and historical
test records later in this document describe that retained implementation.

`desktop-console/build.mjs` stages the actual sibling StallionX Web components,
applies explicit checked overlays and generates bundled assets. It never edits
the Web repository. `desktop-console/source-manifest.json` records source-tree,
public-tree, dependency and seam hashes; a changed seam stops the build. Run
`make console` after synchronizing Web. Normal Go builds use the generated bundle
without needing a Node environment. See [console build/boundaries](../../desktop-console/README.md).

`internal/gui/stallionx_console.go` boots a separate ephemeral TCP4 loopback origin
after native account verification. Its random capability is bound to the saved
login's timestamp, service and identity, not its rotating JWT or managed key.
The renderer receives no JWT or refresh credential. Exact Host, request Origin,
bearer capability, canonical path and CSP checks protect the local bridge.
The iframe cannot navigate the parent, create popups, read native DOM/storage or
call native APIs; the existing `noFramedAPI` boundary is unchanged.

`internal/stallionx/console*.go` owns the fixed customer BFF. It pins each operation
to one account, allowlists method/path/query/body fields, validates personal-key
ownership and real team membership, masks list keys, strips internal log costs,
and refuses platform operations even when the account has a platform role.
Personal logs/usage are personal-wallet-only, unlike the old wallet API's
all-account request list. Team membership/role/status is rechecked around team
reads so an in-flight privileged response cannot survive a local observed role
change. Platform-admin members cannot use aggregate/member endpoints whose
upstream authorization cannot be safely narrowed; these fail closed explicitly.

Team keys use membership-authorized lists for explicit reveal and map mutations
to upstream transactional team checks. Only their owner may edit configuration;
team managers can enable/disable/delete teammates' keys. The desktop-managed key
is read-only in this console, preventing accidental loss of automatic access.
Configuration saves do not echo keys. Personal/team Playground selection is
checked against the workspace and owner before a paid request. SSE cancel and
account replacement stop upstream streaming; paid mutations are never replayed.

The native parent (`stallionx-console-entry.js`) and Web frame authenticate
postMessages by source and origin. Menu labels/routes come from the Web's customer
navigation but are validated again by the parent. Theme/locale, workspace routing,
sign-out and constrained browser opening cross this bridge. Account replacement
destroys the frame; network outage is not presented as a second login. A failed
model setup keeps recharge and an explicit retry/preservation-repair banner usable.

The Web header retains its right-side workspace switcher, personal balance/team
wallet/member quota and recharge shortcut. Finance menus disappear in a team
workspace: team funding uses the owner's transfer UI, not personal checkout.
Request billing uses Web's inline expanded row, toggled by row click or a keyboard
arrow control; key inspection still uses a dialog. OAuth binding, personal ZIP export/deletion
and rich-media direct-key testing remain explicit Web handoffs; task inspection
currently shows settlement metadata rather than raw payload/media. Web content
has English/Simplified Chinese, with native-language fallback documented in the
build README. Online payment availability comes from server config; a disabled
payment service still allows redemption.

The console's semantic colors and fonts come from allowlisted computed native
tokens over the authenticated appearance bridge. Backgrounds, cards, borders,
fields, neutral action buttons and dialogs therefore follow the same native
light/dark/system appearance. Native font, colorblind chart and reduced-motion
changes update in place without losing drafts. The Web theme selector is omitted;
native Settings owns appearance. The frame does not reapply native text-size zoom.
Desktop fine-pointer layouts use 30px form controls and tighter rows, cards and
headings without reducing body text; narrow/touch layouts retain Web control sizes.

Verification at this implementation stage: new console journeys pass 8/8
(Chromium/WebKit, English/Chinese, 1280/390px). Focused Go account/GUI security and
guard tests pass with `-race`. A read-only live development-account walkthrough
confirmed overview, logs, inline billing, keys, profile and recharge configuration.
No real payment, redemption, mail, key or team mutation is submitted as a test.
Broader validation is recorded in the console plan after it completes.

## Identity and local development

`internal/brand/brand.go` owns the product name, `stallionx` slug,
`com.stallionx.client` bundle identity and gateway default port 3435.
`internal/appdir` uses separate configuration, cache and log folders. The
application does not migrate an installed magpie or legacy dial configuration.
OS registration, startup jobs and CLI installation use StallionX identities.
The registered URL scheme is `stallionx://`; pasted legacy provider import
links remain accepted by the parser.

Build: `make build` produces `stallionx`; `make app` produces `StallionX.app`.
These targets do not install over `/Applications/magpie.app`.
`make icons` regenerates the approximate vector S logo using librsvg and, on
macOS, iconutil and Xcode actool. Sources live under `build/icon/stallionx*.svg`.

**Develop with `make dev`, not a bare application invocation.** It builds the
binary with the developer's Go cache, then `build/sandbox.go` runs it with:

- HOME: `<checkout>/.stallionx-dev-home` (ignored by Git, persistent between runs)
- separate XDG and Windows application-data directories
- agent-specific home overrides cleared via `agentenv.Vars`
- subscription discovery and installation disabled
- loopback gateway 3426 and browser development UI 3427
- local backend resolved before HOME isolation by
  `../main/scripts/portless-url.sh stallion-x-api`, unless `STALLIONX_URL` is
  explicitly set; resolver failure stops startup instead of using production

The installed magpie remains on its own port and data. Do not connect a real
agent from both products simultaneously: the compatible agent configuration
IDs still refer to the same external agent files. Sandbox development protects
those files; it is not a promise that two products can both own one live agent
configuration. Development binaries are not signed/notarized distribution builds.

## Commercial user module

This is a login-required commercial client, not an optional cloud account beside
an unlocked single-machine tool. The executable enables the account boundary at
startup (`main.go`, `stallionx.EnableRequiredUser`). The reusable GUI/gateway
libraries do not enable it themselves, so upstream embedders/tests retain their
contracts; the shipped executable has no environment switch to bypass it.

### User journey and screens

The primary user wants to sign in and use Stallion models without copying API
addresses, keys or model names. Stallion owns identity, session validity,
available models, prices, money and billing records. The desktop owns the
managed provider configuration and wiring into agents on this computer.

| Task | Surface / route | Action and successful evidence | Failure and recovery |
| --- | --- | --- | --- |
| Enter the client | Full-page `#stxUserGate` before workspace is usable | Email + code; visible Send code button, resend countdown, Sign in; new email registers under server policy | Wrong code stays editable; transient network error offers reconnect; no second login form |
| Prepare model access | Setup state in the gate | Sign-in provisions the stable named client key and fetches/enables models automatically; ready unlocks workspace | Keep authenticated account; show setup reason and Retry setup; Open user center allows recharging before retry |
| Recover edited local credentials | Setup conflict in gate or User center | Restore automatic setup, then explicit confirmation; preserve the old provider under a separate disabled ID and provision managed access | No deletion or silent overwrite; failed writes stop provisioning and remain retryable |
| Inspect account | `?view=stallion-wallet`, Overview | Canonical user profile, email, user ID, group, live balance and managed-access status | No missing value becomes zero; failed reads show error, not false sign-out |
| Top up / redeem | User center / Top up and redeem | Server limits/presets; create order then explicit Pay in browser, or redeem code; show server balance | Keep refused code; no retry of uncertain mutations; missing payment config does not disable redemption |
| Revisit payments | User center / Payment orders | Pending, credited, failed, expired and refunded orders; refresh after checkout | Opening checkout never means credit; continue pending payment only with server-returned HTTPS URL |
| Inspect request charges | User center / Request billing | Personal account logs, model/date/status filters, pagination and inline details | Unknown token usage remains unknown; error differs from no matching records |
| Leave account | Overview / Sign out then confirmation | Shared state locks every workspace surface; local session and matching managed key removed | Preserve externally edited credentials; no silent deletion of unrelated providers |

Account-only recovery is deliberate: insufficient balance may make `/v1/models`
fail, but an authenticated setup-failed user must still be able to recharge.
Other workspace navigation is hidden in this state and server guards deny it.
The client never asks a new user to configure API keys, provider URLs or model
lists to finish login. External agent installation/selection remains a separate
user decision; login does not rewrite every installed agent's files silently.

### One source of account truth

`GET /api/stallionx/user` (`User` in `internal/stallionx/user.go`) returns
`state=signed_out|authenticated|expired|unavailable`, `setup=ready|failed`,
`providerConnected`, public profile and service URLs. `authenticated` alone
allows user-center finance; only authenticated + ready + providerConnected
allows the workspace. Profile fields are allowlisted from `/api/user/self`;
JWTs, refresh credentials and administrator/private fields never reach the UI.
Stallion's `billing_mode` is an integer enum, retained as numeric `billingMode`
in the public profile: `0` means own wallet and `1` means agent pool. Zero is
included explicitly, not omitted. Profile decoding and session-restoration
regressions include this field so a valid account cannot become unavailable
because the client expects a string instead of the server's number.
A saved provider key is not proof of an authenticated user. The legacy
`GET /api/stallionx` remains provider metadata only, not a UI login authority.

`assets/stallionx-user.js` owns the single shared state and login form. The
`stx-user-locked` boot class prevents a flash of unlocked content before the
first read. Locked workspace nodes are inert. All user-center tabs and the
Providers summary subscribe to the same account. The Providers card only links
to User center; it has no email form or independent sign-out. The entry uses the
existing kernel page slot/navigation, normal selected state and breadcrumb,
never a dialog. New assets and the fork shell carry these responsibilities;
`app.js` does not contain the user module.

`POST /api/stallionx/code` mails a code via `/api/user/verification`.
`POST /api/stallionx/signin` calls `/api/user/email-login` with email, code,
optional invitation, locale, agreement and remember-me. It saves the session,
then automatically runs the setup path. `POST /api/stallionx/sync` retries
idempotent `/api/cli/provision` (stable `StallionX 客户端` key name) and fetches
the model catalog. Both return canonical user state; a setup failure does not
pretend login failed or ask for another code. `POST /api/stallionx/signout`
clears shared account state and attempts to revoke the server refresh session.
The obsolete wallet verification route is removed.

`setupConflict` identifies saved custom credentials that automatic setup must
not overwrite. `POST /api/stallionx/repair` requires `{confirm:true}` and a fresh
authenticated user. `internal/stallionx/recovery.go` uses the provider store's
rename/disable operations to keep the old provider as `stallionx-preserved`
(with a collision suffix), verifies preservation, then retries managed setup.
The confirmation explicitly says the retained provider is switched off.

Sessions live in `stallionx-session.json` with 0600 permissions, atomically
renamed from an owner-only temporary file. Non-secret metadata is in
`stallionx-account.json`; the API key uses the provider store. Restart recovers
the session. An explicit 401 renews at `/api/user/refresh`, persists the rotated
cookie, then permits one retry; concurrent renewal is serialized. Uncertain
financial mutations never retry. Sign-out/account replacement wins over stale
network completions. Session files are not in the backup/sync allowlist.
Pending sign-ins lose to logout or a newer login; rotated refresh credentials
cannot overwrite a replacement login even when its JWT bytes are identical.
Account reads spanning a replacement retry once instead of falsely expiring
the new user. In the UI, account changes clear previous profile/billing records
and discard old in-flight reads; an old request's 401 cannot expire a newer
session. A corrupt local session offers explicit sign-out recovery as well as
retry, rather than leaving the user trapped behind an unrecoverable gate.
Previous versions discarded session credentials; those users sign in once via
the same global gate, not an extra billing login. A refresh outage is unavailable,
not expired, and user data is not replaced with an empty successful response.

### Runtime authorization

`internal/gui/stallionx_guard.go` protects workspace APIs and
`internal/gateway/stallionx_guard.go` protects inference/client protocols,
including plugin pages/services, aliases and subsequent WebSocket turns. `stallionx.Access` bounds
server account validation freshness to ten seconds and invalidates on local
account/session/setup changes. The GUI permits only static bootstrap, auth,
setup, independently authenticated finance, limited window controls and safe
terms/privacy links before readiness. Authenticated setup-failed users can open
standard HTTPS `checkout.stripe.com` payment links; arbitrary application/file
schemes are not a checkout escape. This client-only gate supplements, not
replaces, Stallion's server-side account/key/balance authorization. Local CLI
configuration/TUI utilities are not account interfaces; their gateway inference
still passes through the same guard. Custom Stripe checkout domains are not
accepted during failed setup; supporting them requires validating the URL
against an order returned by the backend.

### Billing boundaries

`internal/gui/stallionx_wallet.go` exposes fixed balance/config/orders/logs/keys and
create/redeem operations; `internal/stallionx/wallet.go` maps them to personal
Stallion endpoints. Caller-supplied credentials, user IDs and arbitrary upstream
paths never pass through. Amounts travel as decimal strings and displayed cost
is the server's real charge, not a local token-price estimate. Logs cover all
requests on this user account. Responses are no-store. The UI opens payment in
the browser, then the user returns and refreshes order status; payment callback
and crediting remain Stallion's responsibility.

The User center's API keys tab reads `/api/token/` with `workspace=personal`
and pagination through the saved account session. It shows names, masked suffixes,
status, total/period limits and spending, model/IP restrictions, creation,
last-use and expiry times. It does not create, reveal, rotate, disable or delete
keys. Stallion currently returns full keys in its personal list; `records.go`
allowlists metadata and replaces each secret with `masked_key` **before** the
response reaches the webview. This is separate from the existing managed-provider
key editor. Key inspection remains available when workspace setup has failed.

Request billing expands each server record to show key name, request path,
client source, streaming/first-response timing, errors, token buckets, price
snapshots and the account billing multiplier alongside persisted actual cost.
One-hour cache-write tokens are a subset of total cache writes, never added a
second time. Unknown usage stays unknown. No cost is recomputed from prices.
The list retains its existing all-requests-for-this-user scope (including team
requests, identified by team name when supplied), while keys are personal-only.
The public log allowlist excludes internal channel cost, margin and agent cost
fields returned by the server. This surface shows request billing records, not
request/response bodies or asynchronous task settlement details.

Request billing and API keys use semantic tables in the existing application
theme, not summary cards. Request columns show time, key name, public workspace,
model, streaming mode, input/output tokens, persisted cost, duration, TTFT and
status. Key columns show name, masked key, status, total limit/spending and
creation/last-use/expiry times. Each row has an accessible disclosure button;
clicking a non-button cell also opens details without navigating or a modal.
Orders retain their existing presentation. Wide tables scroll within their own
labelled region, with the page and filters staying within the window. Details
fit that viewport, including the fallback for WebKit without container units.
Background same-account updates refresh balance in place, preserving filter
drafts, open details, keyboard focus and horizontal table position.

Input totals sum uncached, cache-read and cache-write tokens once; unavailable
usage is a dash, never zero. TTFT appears only for a streaming request with a
positive first-byte time; duration and TTFT are milliseconds. The public log
allowlist includes `team_id` for unnamed-team fallback but still excludes user
and channel identities and internal costs. Missing workspace identity stays
unknown. Empty public `team_id` follows Stallion's "Personal" display convention;
the upstream resolver can also return empty for an orphan/failed team lookup,
so this is not definitive proof of which wallet was charged. No full key is
loaded or revealed by changing the list presentation.

Verification for this extension (2026-11-01): the account package passed with
`-race`; GUI tests matching `TestStallion` and `TestCoreScriptBudget` passed;
wallet journeys passed 24/24 across Chromium/WebKit, five languages and two
widths, and translation checks passed 4/4. The development app was rebuilt and
started. The live inspection encountered the signed-out gate, so real account
key/log contents were not verified and no email code was sent. Full repository
and full GUI suite acceptance have not been completed for this extension.

Development assets are served live but Go routes require rebuilding/restarting
the binary. Non-JSON errors are parsed as text and explained rather than leaking
WebKit's generic JSON parsing exception. The default production service is
`https://x.stallion-api.run`; `make dev` uses the sibling Portless backend.
Captcha, registration, payment and email policies are enforced by that service.
No server deployment, payment-provider setup or real payment is performed by
this client change.

The tray's account actions open the main window's user center; the full page
is not rendered inside the compact panel. A failed account-module load keeps
the workspace locked and shows a visible error with Refresh, not a blank page.

### Existing visual system

The account module uses the original app's controls rather than a separate
design kit: `.text.action`/`.text.primary` buttons, `input.words`, `segs()`
segmented controls and `.list > .row.pref` account/detail rows. The original
theme, platform font, focus treatment and browser-mobile touch sizing remain
authoritative. The full-page login uses the plain application background with
one centered, 440px maximum-width panel, a centered wordmark and heading,
42px inputs and a full-width 44px primary action. The form has no nested card.
Only branding, form labels and required terms are shown in the normal state;
introductory and API-configuration prose is omitted. Errors, resend feedback
and expired-session guidance still appear when relevant. This geometry is
scoped to the login gate; workspace controls keep their existing density.
Sending a code and submitting login share an overlap-prevention lock, not a
loading indicator: only the active action changes its label and `aria-busy`.
The other button may be disabled but does not claim to be submitting.
`stallionx-login-busy.test.cjs` holds both responses to check this distinction
and recovery after refusal in both browser engines and every language.
The overview uses the Settings row layout instead of oversized dashboard
cards. User-center gutters and maximum content width match the original
built-in pages. These choices live in fork-owned styles without changing
the shared `app.css` tokens or original pages.

The desktop's default text size is 125% on every platform, provided by
[`settings.DefaultTextSize`](../../internal/settings/settings.go). New installs
and older settings without `textSize` take that default; saved choices stay
unchanged. The existing native WebView zoom scales the whole interface,
including login, user center and tray controls, without per-page font overrides.
`boot.js` supplies the same value before first paint. Settings / General / Text
size still offers 100%, 110%, 125% and 150%; Ctrl/Cmd+0 still resets to 100%.
Browser mode keeps using the browser's own zoom. `TestDefaultTextSize`,
`TestStallionDefaultTextSizeBoot` and `text-size.test.cjs` cover default loading,
explicit choices, bootstrap consistency and the existing scale controls.

`stallionx-style.test.cjs` compares computed styles against actual rendered
Settings and Providers controls in Chromium/WebKit, light/dark and desktop/
mobile layouts. It also checks focus appearance and overflow and captures
the reference and new surfaces together. Functional journeys remain separate
from this visual-consistency check.

### Verification

Focused checks: `go test -race ./internal/stallionx`, GUI/gateway tests matching
`TestStallion`, script budget/builtin registration checks, `i18n-keys.test.cjs`,
and `stallionx-user.test.cjs`, `stallionx-account.test.cjs`,
`stallionx-wallet.test.cjs` in Chromium/WebKit at desktop/mobile widths and five
languages. These use isolated homes and explicit offline fake services. Full
repository suite and real payment/email acceptance are separate qualifications.
The real development listener is covered by `go test -race -tags dev
./internal/gui -run '^TestStallionRequiredUserGuardsDevListener$'` (not
`dev,nogui`: the development shell needs its native host). `Handler` passes
the same wrapped handler to `devListen` that the native window receives;
passing the raw mux would leave browser development access unguarded.

## Dedicated frontend surface

The dedicated window keeps Agents, Sessions, Library, the StallionX
account/service page, Routing, Gateway, Usage and Masking, as requested by
the user. Settings keeps General, Allowances, Network, Models, Privacy and
About so those pages retain their configuration entry points. A fresh window is held behind the user gate until login/setup; successful
login opens User center.
`assets/stallionx-shell.js` owns the presentation allow-list, enabled by
`boot.js` before the first paint. Old URLs and saved page/settings selections
fall back to the account page or General; settings search cannot reveal hidden
sections. The panel retains Routing; plugin recommendations and community
pages/panels/actions are not mounted in this frontend.

The model-service Providers page lists only StallionX. Clicking its row opens the existing
provider editor, including the masked key (revealed only with Show) and model
list/settings. Re-renders and direct edit links retain that editor. Generic
Add/import/reorder controls and the first-use provider sheet remain hidden.
File-read errors remain visible. Agent connection/model selection and Usage
continue using their existing implementations, including built-in plugin code.

**Hide, do not remove:** the dedicated-page visibility rules are presentation
policy; mandatory user authorization is separately enforced as described above. No plugin is uninstalled or disabled, no provider or setting is deleted,
and the upstream gateway/CLI/API implementations are retained behind the
account boundary. Existing hidden configuration can still affect authenticated
runtime behavior. Future simplification follows the same rule
in AGENTS.md unless the user explicitly requests a backend behavior change.

## Upstream behavior

Upstream automatic update checks and release-note requests are disabled by
default: the upstream feed must never replace this fork. A custom update feed
can be configured explicitly, but a StallionX distribution/update pipeline is
not delivered by this change. Upstream telemetry startup and partner feed are
disabled by default. Existing model catalogs, community plugin integrations
and third-party icon infrastructure remain upstream integrations; this build
is not an offline or completely de-Googled/de-upstreamed distribution.

GUI translation templates retain upstream keys; `brandText` substitutes the
product in prose before interpolating values. Paths, protocol IDs and licenses
are not rewritten indiscriminately. Some internal diagnostic/help text remains
upstream wording.

## Verification

- `go test ./internal/brand ./internal/stallionx ./internal/appdir`
- `go test ./internal/gui -run 'TestTrayIconSize|TestCoreScriptBudget|TestBuiltinClientsLoaded'`
- `node --test internal/gui/tests/i18n-keys.test.cjs`
- `node --test internal/gui/tests/stallionx-account.test.cjs`
- Full acceptance: `go test -tags nogui -timeout 45m ./...`, `make test-ui`.

Account tests use a local fake service and isolated homes. They do not prove
production email delivery. Platform cross-compilation is not native platform
execution. Keep test logs and report failures separately from the passing
focused checks.

## Verification record — 2026-11-01

Implemented and verified locally, not a release qualification:

- macOS desktop launched in the isolated HOME; UI interacted with at port 3427.
- Local fake-service smoke: send code, reject wrong code, sign in, provision key,
  fetch one model, sign out; real production credentials were not used.
- Account GUI matrix: 20/20 passed (two engines × two widths × five languages),
  including direct Providers navigation and no horizontal overflow.
- Account/brand race tests passed; appdir and focused lifecycle tests passed.
- macOS bundle built with MIT included; Windows and Linux binaries built.
- Whole-repository vet passed on macOS, Linux and Windows target settings.
- The first complete Go run failed in 12 packages. Identity fixture failures
  were repaired (fixtures now use the configured cache paths, StallionX names
  and port 3435 rather than changing internal protocol IDs). The 57 originally
  failing tests in catalog/provider/CLI/agent/gateway passed a focused rerun.
- The complete run also found the state encoder requires Agents to be the
  first JSON field; the capability flags were moved after it and the allocation
  regression passes. Tray safe-area and narrow sign-out confirmation were fixed.
- Not yet a green full suite. Still observed: GUI proxy bypass test answers 502,
  GUI cold-turn test races its warm-up acquisition, plugin Git installation
  tests fail under Bun 1.3.14, and macOS process responsibility assertion fails.
  These are not claimed to be unchanged on main; no baseline reproduction or
  external issue was created. Original output: /tmp/stallionx-full-go.log.
- The earlier full GUI run (`/tmp/stallionx-full-gui.log`) was stopped when
  the dedicated-shell changes began; it is not a completed acceptance result.

The production public status at verification reported commit `22690f0`, which
is not a descendant of the locally added email-login endpoint commit `65556f9f`.
The server-side feature/docs commits are `65556f9f` and `271fee22`. They were not
pushed or deployed by this task. The server's new nine tests passed; its broader
suite reported payment webhook-version and team-delete race failures.

## Dedicated-shell verification — 2026-11-01

- Account + shell matrix: 20/20 passed (Chromium/WebKit, 390/1100px, five
  languages), `/tmp/stallionx-shell-final-matrix.log`. The earlier combined
  account/community-page/i18n run passed 30/30,
  `/tmp/stallionx-shell-regression.log`; community implementation is retained.
- `TestStallionXShellBoot`, core script budget, built-in client loading and
  state-write allocation guards passed, `/tmp/stallionx-shell-go-final.log`.
- Real isolated desktop/backend: inspected account, General settings and Agents;
  clicked an agent's Sign in button into the email card. Generic onboarding,
  plugin navigation and unsupported-agent rows are hidden. Screenshot:
  `/tmp/stallionx-dedicated-ready.png`. No live account/config was modified.
- The macOS bundle built. The full GUI run was stopped when the user revised
  the visible-page list; output is kept in `/tmp/stallionx-dedicated-full-gui.log`.
  No full-suite success is claimed.
  Whole Go acceptance and native Linux/Windows execution were not rerun for
  this presentation change. Earlier unresolved acceptance failures still apply.

### Restored built-in pages

The user subsequently requested all eight built-in sidebar pages be kept.
The visibility allow-list and related settings/panel shortcuts now retain them;
community plugins remain hidden. The revised account/navigation matrix passed
20/20 (`/tmp/stallionx-restored-nav.log`). The current combined working tree
fails `TestCoreScriptBudget` (1,547,220 > 1,533,105 bytes); additional wallet
scripts are now present in index.html. Their implementation was not changed
as part of this visibility-only revision. Boot-policy test passed, but the
combined guard command is not green (`/tmp/stallionx-restored-nav-go.log`).

### Provider detail visibility correction

StallionX's provider row is clickable again: the existing editor exposes the
model list, model refresh and key copy. Saved key-list accounts also have an
explicit Show/Hide control; plaintext is held only in a read-only input and
is discarded on hide or editor redraw. Other providers and generic creation
remain hidden. The browser regression uses a fake key-list account to check
masked-by-default, Show, model display, redraw and normal sign-out.

Real local verification opened the signed-in provider and a direct edit link;
the saved model shown was `smoke-model`. No real key was revealed/copied and no
model configuration was changed during this check. The running development UI
serves the changed assets. A bundle rebuild was attempted but blocked by the
current working tree's unresolved `saveWallet` / `walletFile` symbols in
`internal/stallionx/account.go` (`/tmp/stallionx-provider-details-build.log`);
this is not a successful new packaged build.

Provider-detail regression completed: 20/20 passed across Chromium/WebKit,
1100/390px and five languages (`/tmp/stallionx-provider-details-verified.log`).
The reveal assertion waits for the asynchronous key response before checking
the input; an earlier immediate assertion failed before that response arrived.
This focused result does not resolve the packaged-build blocker above.

## Commercial-user verification - 2026-11-01

This later record supersedes the earlier missing session symbols, oversized
eager wallet scripts and optional-account behavior. It is not a production
release or a claim that the earlier whole-repository acceptance reds are fixed.

- Browser journeys: 76/76 pass in Chromium and WebKit; the main login,
  profile/provider and payment/billing flows run in five languages at 1100px
  and 390px. Additional cases cover held responses, account replacement,
  setup-only funding, explicit provider preservation, tray-to-window routing,
  corrupt/unavailable recovery, and failed module loading. All traffic is
  mocked; no real mail or payment. Log: `/tmp/stx-user-final-matrix.log`.
- Full account package race suite passes, including delayed sign-in after
  logout, identical-JWT refresh replacement, stale profile reads and provider
  repair. Log: `/tmp/stx-recovery-final.log`. GUI/gateway account guards and
  script-budget/builtin-registration checks pass with race detection:
  `/tmp/stx-commercial-final-go.log`. The real dev-listener test also passes.
- Red-on-old Go overlays prove behavioral failures for missing GUI/gateway
  guards, the unwrapped development listener, provider-bound authentication,
  the three session races and omitted provider preservation. No working-tree
  file was reverted for these checks.
- Translation checks: 4/4 pass (`/tmp/stx-commercial-i18n-final.log`). Changed
  JavaScript parses; `gofmt -l` and `git diff --check` print nothing.
- Whole-repository vet passes for macOS, Linux/nogui and Windows. Native macOS
  dev and Linux/Windows binaries build. Existing Darwin CG enum/link-target
  warnings remain. Logs use `/tmp/stx-commercial-{vet,build}*-final*`.
- Compiled native binary against a loopback-only fake Stallion: 15/15 checks
  pass. Send code, reject wrong code, sign in, automatically provision/fetch
  models, exact profile balance, authenticated workspace, model listing and
  sign-out are exercised over HTTP. Web, dev and gateway entrypoints all deny
  use before login and after sign-out. Fresh temporary HOME and localhost-only
  macOS sandbox; fake process and client cleaned up. Evidence:
  `/tmp/stx-binary-smoke-report.json`.
- Actual isolated developer app rebuilt and restarted on gateway 3426/UI 3427;
  the installed magpie on 3425 is untouched. Legacy metadata has no saved user
  session, so its canonical state is expired, the visible full-page form has
  Send code, and both `/api/state` and `/v1/models` return 401. The user needs
  one normal sign-in to migrate; no code was sent on their behalf.
- Not run: the entire Go/UI suite for this revision, native Windows/Linux
  execution, real-account end-to-end login or payment, deployment, signed app
  packaging, production update/distribution acceptance. Earlier unresolved
  full-suite failures remain recorded above. No commit or release was made.

## Original-style alignment and walkthrough - 2026-11-01

- Account/login styles now reuse the original app controls, compact list rows,
  plain background and page alignment. Existing shared styles are unchanged.
  User center remains a normal page and login remains mandatory.
- Combined account/provider/billing/style matrix: 84/84 pass, no failures or
  skips (`/tmp/stx-restyle-final-matrix.log`). Main functional flows cover five
  languages and two widths in Chromium/WebKit; style comparisons additionally
  cover light/dark against actual original Settings/Providers controls.
- Negative control injects the previous bespoke login input styling into the
  test page only; the style regression fails with 14px versus the original
  12.5px. Production files are not reverted. Evidence:
  `/tmp/stx-style-negative.log`.
- Translation checks 4/4 pass; core script budget, built-in registration and
  shell boot tests pass. JavaScript parsing and whitespace checks pass.
  Logs: `/tmp/stx-restyle-i18n.log`, `/tmp/stx-restyle-go.log`.
- Real running development UI: inspected the restyled login, rejected an
  invalid email locally, verified the Send code control remains explicit and
  bordered, and confirmed workspace/provider/balance/orders/log APIs all deny
  unauthenticated access. The dev asset server serves the new styles without
  a Go restart. No real code email, payment or redemption was submitted.
- Current local backend is not an isolated acceptance environment: real email
  delivery is configured, registration is disabled, and online payment is not
  configured. Real authenticated payment/mail acceptance needs an authorized
  existing test account and payment sandbox. The mocked flow results above
  must not be presented as live backend acceptance. The entire repository
  suite, signed packaging and production deployment were not rerun.

## Larger default text - 2026-11-01

- Default desktop scale is now 125%; explicit saved sizes remain unchanged.
  No shared CSS or per-page typography was changed.
- Full settings package and focused GUI bootstrap/frame/settings tests pass
  under isolated homes (`/tmp/stx-font125-settings-full.log`,
  `/tmp/stx-font125-gui.log`). An old-source overlay fails the new default
  assertion with 100 instead of 125 (`/tmp/stx-font125-red.log`).
- Text-size browser matrix passes 60 behavioral checks plus two engine parents
  in Chromium/WebKit across five languages (`/tmp/stx-text-size-matrix.log`).
  It covers 125% bootstrap selection and persistence, existing scale choices,
  shortcuts, scroll preservation and light/dark layout. Zoom is simulated by
  browser viewport/device scale, not verified on a live native window.
- Native macOS development binary builds at `/tmp/stx-font125-dev` with the
  existing SDK/linker warnings. It was not launched over the active developer
  instance; restarting that instance and changing its saved scale remain
  separate actions. Formatting and whitespace checks pass.
- Not rerun: whole-repository Go/UI acceptance, native OS visual acceptance,
  login/account screens at the new scale, Windows/Linux execution or packaging.

## Request and API-key tables - 2026-11-01

- Request billing and API-key inventories now use column-aligned tables with
  inline details; existing filters, pagination and order/payment behavior stay
  in place. Shared app styles are unchanged. Horizontal scrolling, accessible
  disclosure and balance-only background refresh are scoped to this module.
- Table/filter/wallet matrix passes 106/106 (`/tmp/stx-table-final-matrix.log`).
  After the final scrollbar and background-refresh changes, 52/52 pass
  (`/tmp/stx-table-final52.log`): table layouts across both engines, five
  languages, desktop/mobile/sidebar and simulated 125%, two polling regressions,
  eight original-style comparisons and two account-only funding regressions.
  These flows use mocked services, not live payment or mail.
- Genuine negative controls fail for the old card list and the old redraw
  behavior (`/tmp/stx-table-red.log`, `/tmp/stx-table-poll-red.log`). The latter
  loses the unsubmitted filter draft while keeping the new table code in place.
- Account package race suite and GUI wallet-route/bootstrap/script-budget tests
  pass (`/tmp/stx-log-scope-package.log`, `/tmp/stx-table-go.log`). Old Go overlay
  fails the new public workspace-ID regression. Translation checks pass 4/4;
  JavaScript syntax, Go formatting and whitespace checks pass.
- macOS development binary builds and runs with the existing SDK/linker
  warnings at `/tmp/stx-tables-dev`, using the existing isolated developer HOME
  and local backend. Read-only live browser inspection confirms 20 real request
  rows, workspace display and masked API-key metadata in light/dark and narrow
  layouts. No payment, email, key mutation or account switch was submitted.
- Not run: full repository Go/UI acceptance, native OS screenshot acceptance,
  Windows/Linux execution, old-WebKit execution, signed packaging or deployment.
