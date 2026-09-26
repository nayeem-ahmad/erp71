# ERP71 mobile

The Flutter app for Android and iOS. The first release covers **Google sign-in
and the CRM**: an overview of the pipeline and today's work, leads, activities
(follow-ups and logged calls), and contacts. It talks to the same NestJS API as
the web app and needs nothing from it that the web does not already use, apart
from `POST /auth/logout/session` (see [Signing out](#signing-out)).

## Running it

Flutter **3.47.5** (the version CI pins in `.github/workflows/mobile.yml`).

```bash
cd apps/mobile
flutter pub get
flutter run                                   # against production, api.erp71.com
flutter run --dart-define=API_BASE_URL=http://10.0.2.2:4000/api/v1   # local backend, Android emulator
flutter run --dart-define=API_BASE_URL=http://localhost:4000/api/v1  # local backend, iOS simulator
```

`API_BASE_URL` includes the `/api/v1` prefix. Debug Android builds may use plain
`http` (for the emulator's `10.0.2.2`); release builds are https-only.

Checks, as CI runs them:

```bash
dart format --output=none --set-exit-if-changed lib test
flutter analyze
flutter test
```

The widget tests in `test/app/` drive the whole app on a 360 × 780 screen
against an in-memory API (`test/support/fake_backend.dart`), so a layout that
overflows at the narrowest supported width fails the suite.

## Google sign-in setup

Sign-in needs no change to the backend: the app asks Google for an ID token
addressed to the backend's **web** OAuth client (read at runtime from
`GET /auth/google/config`), which is exactly the audience the backend already
accepts from the web app. What each platform does need is its own OAuth client
in the **same Google Cloud project** as that web client
(APIs & Services → Credentials → Create credentials → OAuth client ID):

| Platform | Client type | What to enter | What goes in the app |
|---|---|---|---|
| Android | Android | Package `com.erp71.app` and the SHA-1 of the signing key | Nothing. Google matches the app by package and signature. |
| iOS | iOS | Bundle ID `com.erp71.app` | The client ID and its reversed form, in `ios/Flutter/GoogleSignIn.xcconfig` |

- **SHA-1 fingerprints.** Register one Android client per signing key: the
  debug keystore for development
  (`keytool -list -v -keystore ~/.android/debug.keystore -alias androiddebugkey -storepass android`),
  and the Play Console's app signing key for store builds.
- **Backend `GOOGLE_CLIENT_ID`** is a comma-separated list, and the web client
  must stay **first**: `/auth/google/config` hands out the first entry, and
  that is the client the phones ask for tokens for.
- A Google Cloud project whose consent screen is still in *Testing* only lets
  its listed test users sign in.

Until the iOS values are filled in, iOS builds run but Google sign-in fails
with a configuration message. Android shows the same message until its OAuth
client exists.

## Who can sign in

- **Existing ERP71 accounts only.** The app never creates an account: a new
  one needs the terms accepted and usually a workspace set up, which is the
  web's signup. An unknown Google address is told to start at app.erp71.com.
- Accounts with two-step verification are asked for their authenticator code.
- The CRM opens for a workspace whose plan includes it (`premiumCrm`) with an
  active or trial subscription — the same check every CRM endpoint makes.
  Otherwise the app says why and offers to switch workspace.
- Within the CRM, screens follow the member's permissions the way the server
  enforces them: the overview needs `VIEW_LEADS`; activities need
  `VIEW_CRM_INTERACTIONS` to list, `MANAGE_CRM_TASKS` to log or plan, and
  `CREATE_CRM_INTERACTIONS` to mark done. Leads and contacts need no
  permission beyond membership.

## Signing out

Signing out ends **this phone's** session only, through
`POST /auth/logout/session`, which revokes the refresh token the phone holds
(and the rest of its rotation chain). `POST /auth/logout` would bump the
account's token version and sign the user out of every browser and phone at
once. Against a backend that predates the endpoint, the phone still forgets its
tokens.

## How it is put together

```
lib/
  main.dart, app/          app shell and routes (go_router), redirects driven by sign-in state
  config/                  build-time settings (--dart-define)
  core/api/                HTTP client: envelopes, errors, token renewal
  core/auth/               session storage, Google, the sign-in state machine
  core/format/             money, dates and times, the web's formats
  features/auth/           sign-in, two-step verification, launch
  features/workspace/      workspace picker, account, branch
  features/crm/            overview, leads, activities, contacts
  ui/                      theme and shared widgets
```

State is [Riverpod](https://riverpod.dev) without code generation; HTTP is
`package:http`; tokens live in the Keychain / Keystore via
`flutter_secure_storage`.

Things the API expects that are easy to get wrong, and where the app handles
them:

- **Envelopes.** Success is `{"data": …}` (lists add `meta`), errors are
  `{"error": {"code", "message"}}` — unwrapped in `core/api/api_client.dart`.
- **Workspace and branch headers.** Every request carries `x-tenant-id`, and
  `x-store-id` for the chosen branch; staff with several branches get their
  permissions checked per branch and can switch branch from Account. A 401
  saying *Missing/Invalid tenant context* is about the header, not the
  session, and does not sign the user out.
- **Refresh tokens rotate** on every use, so renewal is single-flight and the
  new pair is saved before anything else.
- **Dates.** Times are shown in the workspace's time zone, like the web.
  Times the user picks are sent without an offset, which the server reads in
  the workspace's zone.
- **Rate limit.** Production allows about 20 requests a minute per route per
  IP, shared by every phone behind one shop Wi-Fi or carrier NAT. The app
  caches the CRM's configurable lists per session and pages lists 20 rows at
  a time.

The look follows `docs/ui-design-guidelines.md`: one blue-600 accent, emerald,
amber and red for status, a gray-100 canvas, 44 px touch targets, and money
always through `formatBDT`.

## Not done yet

Tracked in `TODO.md` under *Mobile App*: release signing and store listings,
push notifications for assigned activities, business-card scanning, custom
lead fields, customers' activity timelines, Bangla strings, and offline use.
