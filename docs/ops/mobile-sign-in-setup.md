# Mobile-Number Sign-In Setup (Firebase Phone Auth)

ERP71 supports signing in with a mobile number and a 6-digit SMS code on
`/login`, and signing up the same way on `/signup`. The option is hidden unless
the backend has a Firebase project configured, so a deployment without one
behaves exactly as before.

Firebase sends the SMS and verifies the code; the backend never sees the code,
only the signed ID token that Firebase issues once the code is accepted.

---

## 1. Enable phone sign-in in Firebase

1. Open the [Firebase console](https://console.firebase.google.com/) and select
   (or create) the ERP71 project. A Firebase project *is* a Google Cloud project
   — the existing `erp71-709cf` project used for Google sign-in is the right one.
2. **Build → Authentication → Sign-in method → Phone → Enable.**
3. **Authentication → Settings → Authorised domains** — add every domain the
   sign-in page is served from. Firebase refuses to send an SMS from any other
   origin:

   | Environment | Domain |
   |-------------|--------|
   | Production  | `app.erp71.com` |
   | Staging     | your staging frontend domain |
   | Local dev   | `localhost` (present by default) |

4. Optional but recommended while testing: **Authentication → Settings → Phone
   numbers for testing** lets you register a number and a fixed code, so the
   flow can be exercised end to end without spending SMS quota.
5. **Project settings → General → Your apps** — if there is no Web app yet, add
   one ("Web", no hosting needed). Copy the `apiKey` and `projectId` from the
   config snippet it shows.

> The SMS quota on the Spark (free) plan is limited and Firebase throttles
> aggressively per number and per IP. Check the quota before a launch that
> expects real volume.

## 2. Configure the backend

Set two variables in `.env.production` (or `.env` locally):

```bash
FIREBASE_PROJECT_ID=erp71-709cf
FIREBASE_API_KEY=AIzaSy...
# Optional. Defaults to <project>.firebaseapp.com, which is what Firebase
# provisions; set it only if the project uses a custom auth domain.
FIREBASE_AUTH_DOMAIN=
```

Restart the backend. That is the whole configuration:

- Both values are **public client identifiers, not secrets**. The web API key
  identifies the project to Firebase; access is controlled by the authorised-
  domains list, not by keeping the key hidden. No service-account key is needed
  — verifying an ID token only requires Google's public keys.
- The frontend reads them at runtime from `GET /api/v1/auth/firebase/config`, so
  enabling mobile sign-in is a **backend restart, not a frontend rebuild**.
- Leaving either variable empty hides the mobile option and makes
  `POST /api/v1/auth/mobile` return 503.

## 3. Verify

```bash
curl -s https://api.erp71.com/api/v1/auth/firebase/config
# {"enabled":true,"project_id":"erp71-709cf","api_key":"AIzaSy...","auth_domain":"erp71-709cf.firebaseapp.com"}
```

Then load `/login` — a "Sign in with mobile number" button should appear below
the divider. If the button is missing, check the config endpoint first. If it
appears but sending the code fails, the domain is almost certainly missing from
the authorised-domains list (`auth/captcha-check-failed` or
`auth/operation-not-allowed` in the browser console).

---

## How sign-in resolves an account

`POST /api/v1/auth/mobile` verifies the Firebase ID token — signature against
Google's `securetoken@system` JWKS, issuer `https://securetoken.google.com/
<project>`, audience `<project>`, `exp`/`iat`/`auth_time`, and a
`sign_in_provider` of exactly `phone` — and then, in order:

1. **Known Firebase identity** — matched on the token's `sub` (the Firebase
   uid), which survives the person changing their number. Signs in.
2. **Exactly one account carries this number** — adopts the Firebase identity
   onto it and stamps `mobile_verified_at`, so someone who signed up with a
   password can start using the SMS code without ending up with a second, empty
   workspace.
3. **Several accounts carry this number** — refused. Mobile numbers were never
   unique in ERP71 (one person may own several businesses), so there is no
   honest way to pick one; those users sign in with email and password.
4. **Nobody matches** — the response is `{ requires_signup: true, mobile }` and
   **nothing is written**. The page then collects an email address and posts the
   same token back, which creates the account.

Three consequences worth knowing:

- A verified number is never attached to an existing account by email. If the
  email supplied at step 4 already exists, the request is refused — the SMS code
  proves the number and nothing at all about the address, so linking on it would
  let anyone with a phone claim any account whose email they can guess.
- Firebase proves the number, not possession of a second factor. An account with
  2FA enabled still gets the `requires_2fa` challenge after the SMS step.
- If the number on a Firebase identity changes (new SIM, ported line), the next
  sign-in updates `User.mobile` to match. Firebase is the authority on which
  number an identity currently holds.

## Passwordless accounts

An account created through mobile sign-in has `passwordHash = null`, exactly
like a Google-created one, so the same rules apply: `GET /auth/me` reports
`has_password: false` (plus `mobile_connected: true`), `POST
/auth/change-password` returns a 400 pointing at "Forgot password", and password
login rejects it because there is no hash to compare against.

Unlike Google sign-in, the email address on a mobile-created account is **not**
pre-verified — Firebase said nothing about it — so a verification email goes out
at signup and `email_verified` stays false until it is used.

## New workspaces

A mobile signup from `/signup` carries the organization name, plan and referral
code with it, so the workspace is provisioned in the same request. A mobile
sign-in from `/login` for an unknown number has none of that, so the response
carries `requires_workspace: true` and the app sends the user to the onboarding
wizard, which collects the same details and calls `POST /auth/setup-tenant`.

## Frontend loading behaviour

The Firebase JS SDK is loaded from `gstatic.com` on demand (pinned version,
compat build) rather than bundled, so it costs nothing on any page until someone
chooses mobile sign-in — the same approach as Google Identity Services. An
invisible reCAPTCHA is mounted in the panel because Firebase requires one before
it will send an SMS; it only paints a challenge when Firebase decides the
visitor needs one.
