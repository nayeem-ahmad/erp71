# Google Sign-In Setup

ERP71 supports "Sign in with Google" on `/login` and "Sign up with Google" on
`/signup`. Both buttons are hidden unless the backend has a Google OAuth client
id configured, so a deployment without one behaves exactly as before.

---

## 1. Create the OAuth client

1. Open the [Google Cloud Console](https://console.cloud.google.com/) and select
   (or create) the ERP71 project.
2. **APIs & Services → OAuth consent screen** — configure the app name, support
   email, logo, and the privacy policy (`https://app.erp71.com/privacy`) and
   terms (`https://app.erp71.com/terms`) links. Publish it; a consent screen left
   in "Testing" only works for the accounts explicitly listed on it.
3. **APIs & Services → Credentials → Create credentials → OAuth client ID**, type
   **Web application**.
4. Under **Authorised JavaScript origins**, add every origin the sign-in button
   is served from:

   | Environment | Origin |
   |-------------|--------|
   | Production  | `https://app.erp71.com` |
   | Staging     | your staging frontend origin |
   | Local dev   | `http://localhost:3000` |

   No redirect URIs are needed. ERP71 uses Google Identity Services in
   ID-token mode: the browser receives the token directly and posts it to the
   API, so there is no OAuth redirect leg.
5. Copy the **Client ID** (it ends in `.apps.googleusercontent.com`). The client
   *secret* is not used and does not need to be stored anywhere.

## 2. Configure the backend

Set one variable in `.env.production` (or `.env` locally):

```bash
GOOGLE_CLIENT_ID=1234567890-abcdefg.apps.googleusercontent.com
```

Restart the backend. That is the whole configuration:

- The frontend reads the client id at runtime from `GET /api/v1/auth/google/config`,
  so enabling Google sign-in is a **backend restart, not a frontend rebuild**.
  A `NEXT_PUBLIC_*` variable would be baked into the image at build time and
  would need a rebuild to change.
- Leaving `GOOGLE_CLIENT_ID` empty (or unset) hides the buttons and makes
  `POST /api/v1/auth/google` return 503.
- Multiple client ids can be comma-separated. Use this when the mobile apps ship:
  each platform gets its own client id under the same Google project, and tokens
  from any of them are accepted.

## 3. Verify

```bash
curl -s https://api.erp71.com/api/v1/auth/google/config
# {"enabled":true,"client_id":"...apps.googleusercontent.com"}
```

Then load `/login` — Google's button should render below the "or" divider. If
the button is missing, check the config endpoint first; if it renders but errors
on click, the origin is almost certainly missing from the authorised JavaScript
origins list.

---

## How sign-in resolves an account

`POST /api/v1/auth/google` verifies the ID token (signature against Google's
JWKS, issuer, audience, expiry, and `email_verified`) and then, in order:

1. **Known Google account** — matched on Google's `sub` claim, which is stable
   even if the person renames their Gmail address. Signs in.
2. **Existing ERP71 account with the same email** — links the Google identity to
   it, so someone who signed up with a password can switch to the Google button
   without ending up with a second, empty workspace. This is only safe because
   the token is rejected unless Google reports the address as verified.
3. **Nobody matches** — creates the account. It has **no password**: the person
   either keeps using Google or claims a password through "Forgot password".

Two consequences worth knowing:

- An account whose email now belongs to a *different* Google account is rejected
  rather than relinked (`This email is already linked to a different Google
  account`).
- Google proves identity, not possession of a second factor. An account with 2FA
  enabled still gets the `requires_2fa` challenge after the Google step.

## Passwordless accounts

`User.passwordHash` is nullable. For an account created through Google:

- `GET /auth/me` reports `has_password: false` and `google_connected: true`.
- `POST /auth/change-password` returns a 400 explaining that "Forgot password"
  sets the first password.
- Password login and storefront customer login both reject it — there is no
  hash to compare against, so neither can be brute-forced into a match.

## New workspaces

A Google signup from `/signup` carries the organization name, plan and referral
code with it, so the workspace is provisioned in the same request. A Google
sign-in from `/login` for an unknown account has none of that, so the response
carries `requires_workspace: true` and the app sends the user to the onboarding
wizard, which collects the same details and calls `POST /auth/setup-tenant`.
