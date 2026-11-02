# Desktop account console

The desktop reuses the customer pages in `../../main/web`, not its admin router.
`node desktop-console/build.mjs` (`make console`) stages that checkout in a
temporary directory, overlays the native authentication/API/router adapters and
builds into `internal/gui/assets/stallionx-console`. It never edits the sibling
checkout. Set `STALLIONX_WEB_SOURCE` to use another Web checkout.

Install the source Web dependencies with its checked-in package lock before
building. `source-manifest.json` records the package/lock hashes and every source
seam the overlay changes. A seam must match exactly once; drift fails the build.
Generated assets are committed with their overlay, so ordinary Go/upstream builds
do not require Node or the sibling repository. Rebuild after syncing Web changes.

## Boundaries

- Native `stallionx-user.js` remains the only login authority. The frame receives
  a random account-bound capability, never the service JWT or refresh credential.
- A dedicated loopback origin serves only the bundle and fixed customer BFF.
  Frame scripting cannot read native DOM/storage or call native APIs. Native
  `noFramedAPI` is unchanged.
- Personal pages force personal wallet/log/key scope. Team routes resolve the
  immutable team ID and require real membership, regardless of platform role.
- Lists mask keys; an explicit copy retrieves the owned/authorized team key.
  The desktop app's own keys (`desktop_managed`: the account's and each team
  payer's) can be edited and switched on or off like any key. Their delete
  button is hidden and their name field is locked with the reason shown, since
  the app finds its key again by name. The BFF refuses a rename or delete
  either way, and after a save it refetches that key's provider's models.
- Copies go to the native parent. The app's window refuses the frame's own
  `navigator.clipboard`, so `bridge.js` replaces `writeText` once (no Web page
  is patched). It posts `stx-console-copy` and waits up to 10 seconds for an
  answer. The parent (`stallionx-console-entry.js`) accepts it only from the
  frame's origin and only as a non-empty string of at most 64 KiB. It copies
  the way app.js `copy()` does, `POST /api/copy` first, and answers
  `stx-console-copied`. Each page keeps its own success and failure toasts.
- Mutations are not replayed, and paid SSE is never retried. Abort/account
  replacement closes the upstream stream. Finance stays authoritative upstream.
- Native sidebar entries are individual routes. Header, forms, tables and team
  switcher are the original Web components. Request billing expands in its table
  row (click again to collapse, or use the keyboard arrow control); key inspection
  remains a dialog, as do specialized task details.
- Playground, models/pricing, plans and subscription usage are temporarily hidden
  from personal/team navigation and global search; their routes remain available.
- Collapsed navigation hides sidebar group headings, refits after menus arrive
  and scrolls horizontally when crowded. Wheel/trackpad and keyboard reach the
  whole strip; the selected account route stays visible with the native highlight.
- Startup uses a native navigation placeholder, never the legacy Extend/User center
  menu. The authenticated manifest replaces it in one render. A failed bootstrap
  or 20-second startup deadline exposes retry rather than waiting indefinitely.
- The parent sends allowlisted computed color/font tokens, resolved theme and
  reduced-motion preference. The console follows native light/dark/system,
  colorblind charts and font changes without remounting forms. Appearance is
  changed in native Settings, not a second Web theme selector. Native text-size
  zoom is applied only once. Desktop pointer layouts use 30px form controls,
  tighter tables/cards and smaller headings; narrow/touch layouts retain Web sizing.

## Deliberate differences / remaining parity

Linked OAuth accounts, ZIP data export and account deletion use an explicit Web
handoff. Rich media/direct-key Playground in model details links to the
session-backed chat Playground instead of asking users to configure keys. Task
details expose settlement metadata only, not raw task bodies/downloads. Team
export responses retain the current 1 MiB account-response cap (large exports
fail, never silently truncate).

Web currently has English and Simplified Chinese translations; native German,
Japanese and Traditional Chinese remain available for the shell, with Web content
falling back to English/Simplified Chinese. A platform administrator whose actual
team role is member cannot use the upstream aggregate/member endpoints that
still return platform-wide data: the desktop fails closed pending a server fix.

The fixture's legacy table renderer remains selectable only inside old tests.
Production always loads this console. New console tests use the actual generated
bundle and parent bridge, with no live mail/payment/mutations.

## Verification

```sh
node desktop-console/build.mjs
node --test internal/gui/tests/stallionx-console.test.cjs
# Go: run with isolated HOME and pinned GOPATH/GOMODCACHE/GOCACHE as required
go test -race -tags nogui ./internal/stallionx ./internal/gui -run 'TestConsole|TestStallionConsole'
```

The console tests run Chromium/WebKit, English/Chinese and 1280/390px. They
exercise shared login, hidden navigation/search, scope switch, inline billing,
key dialogs, compact controls, live native theme/font updates, preserved form
drafts, profile, view-only recharge and sign-out. Go tests cover Host/Origin/capability rejection,
route/body/query allowlists, personal redaction, ownership, platform/team scope,
account replacement, permission changes and no financial replay.
