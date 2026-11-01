# StallionX account console parity

Implementation plan and verification notes, not release acceptance.

## Requirement and boundaries

The commercial client user signs in once, selects a personal or authorized
team workspace, manages access and understands spending without leaving the
client or configuring another backend. The StallionX Web account console is
the source for visual layout, page hierarchy, form behavior and server rules.
The native client's existing agent/gateway pages stay available and unchanged.

Must: independent sidebar destinations, workspace switcher, contextual
balance/quota, personal top-up, API keys, request logs, overview, model/pricing
catalogue, Playground, profile and team management. The latest user scope hides
Playground, model/pricing, plan and subscription-usage navigation/search while
retaining their routes. Request billing now uses Web's inline disclosure by the
latest user request; key details remain dialogs. Native colors/fonts and compact
desktop controls replace the Web theme, without shrinking body text.
Team funding is an owner-authorized transfer, not a personal checkout. Actual
money, mail, key changes and team mutations are not submitted as live tests.
Platform administrator operations are outside this customer console.

## Journey and screens

| Task | Trigger and flow | Route / result | Failure and recovery |
| --- | --- | --- | --- |
| C1 Start using models | Existing native login -> account overview -> select models/key -> Playground | `/personal/dashboard`, `/personal/token`, `/playground`, `/models`; server-authorized result | Keep shared login; show setup/service error, never an unrelated second login |
| C2 Inspect a charge | Overview or log navigation -> filter -> click request -> expand billing row -> click again to collapse | `/personal/log`; exact persisted charge, keyboard toggle, no modal | Unknown usage stays unknown; failure differs from no records |
| C3 Manage credentials | Key list -> create/edit dialog -> validate -> save -> list/read-back | `/personal/token`; own key only, explicit secret copy | Preserve drafts on refusal; stale account completion cannot mutate another account |
| C4 Fund account | Header top-up -> amount/code -> order -> external payment -> return/read order | `/topup`, `/orders`, `/personal/balance-log`; server balance is authoritative | No optimistic credit or uncertain automatic mutation retry |
| C5 Switch workspace | Header switcher -> authorized team resolution -> equivalent section | `/team/:slug/:section`; immutable team ID keys data/cache | Revoke old data/drafts on switch or lost permission; retry outages |
| C6 Team administration | Team members/settings/wallet -> authorized dialog -> confirm -> server read-back | Team role/status gates actions; owner transfer updates both wallets | No platform-role escalation; no team funding through personal payment UI |
| C7 Maintain account | Profile navigation -> edit/verify email or password -> submit -> refreshed profile | `/profile`; same account identity and canonical login | Explicit code-send, validation and confirmation; never overwrite another login |

## Architecture and permissions

Reuse the actual Web page components in an isolated, reproducible build overlay
instead of maintaining a second approximation. Do not edit the sibling source
checkout. The native sidebar presents individual console routes; the Web
content retains its header/workspace controls but not a duplicate sidebar.

The bundled console runs on a distinct loopback origin. Its BFF uses a random
in-memory capability bound to the native account generation. Only fixed
customer endpoints are proxied; account JWT/refresh credentials never enter
the renderer. Host, Origin, method/path and body checks supplement the
service's own authorization. Native plugin/frame API protections stay intact.
The frame and parent use source/origin-checked messages for navigation, theme,
session change, sign-out and constrained external opening. Team/public IDs
come from authorized server resolution, not mutable global headers.

Team roles remain member/admin/owner (1/2/3), separate from platform role.
Personal logs/usage exclude team traffic. Team member data is narrowed by the
backend. Admin/owner management permissions do not imply ownership of every
key's configuration. Platform-only APIs are denied even for a platform-admin
account using the customer console.

## Acceptance gates

- Cold/returning login, direct routes, independent sidebar and browser history.
- Personal -> team A -> team B -> personal with held responses and revoked role.
- Exact decimals, unknown usage, payment refusal and uncertain-result recovery.
- Dialog focus/escape/return, narrow layouts and original Web page appearance.
- Secret redaction, owner preflight, account generation and streaming cancel.
- Loopback Host/Origin/capability and native API isolation negative tests.
- Offline customer journeys, build/format checks and read-only live inspection.

Unverified routes or unsupported features must be named explicitly at delivery;
the prior table-only test record does not qualify this expanded implementation.

## Verification notes (2026-11-01)

- Web overlay and native dev build pass; the isolated developer client is restarted.
- Appearance/login regression passed 50/50 (new console and retained native-login
  journeys; Chromium/WebKit, five native languages, en/zh console, 1280/390px).
  The subsequent inline-billing/compact-controls console run passes 8/8.
- Focused final `-race` account/GUI/CLI tests pass, including account security,
  console capabilities, route parity and GUI date formatting.
- Red-on-old: the new inline-billing test fails on the modal bundle because no
  expanded detail row appears. Tests also measure desktop input/row heights and
  verify personal/team disclosures, keyboard toggle, no modal and narrow overflow.
- Read-only live inspection covers dark orders/logs and light profile, including
  inline billing. No real financial/mail/key/team write is submitted.
- The full Go suite was run, but is NOT green: account route-parity omissions and
  legacy wallet locale formatting were found and corrected. Remaining failures
  are gateway package 10-minute timeout (`TestKeptAliveChatErrorNamesTheModel` was
  running), `TestProxyCheckSaysAProxyPassedBy` (HTTP 502, reproduces separately),
  Bun local Git dependency tests (`TestGitUpdateInstallsTheBranchsCommitNow`,
  `TestGitUpdateKeepsACommitPin`) and macOS responsibility assertion
  `TestCombinedOutputOwnAnswersForItself`. No unrelated production fix or release
  is made here. Full log: `/tmp/stx-console-full-go.log`.
- Full GUI suite, cross-OS builds/vet and native Windows/Linux execution are not
  completed. This is development verification, not release approval.
- Collapsed-navigation follow-up: console suite passes 18/18, including 10
  Chromium/WebKit cases across all five native languages with 125% native text
  settings, 1280/900/560px widths, saved top-layout startup, personal/team menus,
  wheel scrolling, keyboard selection and return to sidebar. Red-on-old reports
  the three account group labels still visible in the collapsed header. Live
  wide/narrow inspection and JS syntax/diff checks pass. No Go changes in this
  follow-up; the full-suite limitations above remain.
- Refresh flash follow-up: inspected the user's 1.96-second recording, reproduced
  the old Extend/User center first paint with a held console-session response,
  then replaced it with a native loading/retry placeholder. New refresh/failure
  tests pass 10/10 in Chromium/WebKit, en/zh and side/top layouts. Live developer
  endpoint refresh confirms both legacy nodes remain display:none. The combined
  70-case run passed 69, with a retained legacy-renderer Japanese reload wait
  timing out (its separate rerun passed); this is not claimed as a green full run.
  Native macOS window automation was unavailable; live observation used the
  developer browser endpoint plus WebKit tests.
