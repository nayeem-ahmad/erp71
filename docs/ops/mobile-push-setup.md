# Mobile Push Notifications Setup (Firebase Cloud Messaging)

The mobile app gets every in-app notification (the bell) as a push as well:
approvals waiting, a short till, low stock, a large refund and the rest. Push is
**off until the backend has a service account**. Without one, the app asks the
phone for nothing, and the Alerts tab still lists everything.

How it fits together:

- `NotificationsService.create()` writes the bell's row, then hands the same
  title, body and link to `PushService`. That decides whether and when to send;
  the policy is in `apps/backend/src/notifications/alert-policy.ts`.
- `PushService` sends through FCM's HTTP v1 API, signed as the service account.
  It sends only to phones whose sign-in session is still live. Signing out, "sign
  out everywhere", a password change or a replayed token all end the session,
  and with it that phone's pushes.
- The app reads the Firebase client values from `GET /push/config`, so it ships
  no `google-services.json` or `GoogleService-Info.plist`.

---

## 1. Use the existing Firebase project

Use the same project as mobile-number sign-in (`docs/ops/mobile-sign-in-setup.md`),
`erp71-709cf`, so `FIREBASE_PROJECT_ID` and `FIREBASE_API_KEY` are already set.

## 2. Register the apps

**Project settings → General → Your apps → Add app**:

| Platform | Package / bundle | Value to copy |
|---|---|---|
| Android | `com.erp71.app` | the **App ID** (`1:…:android:…`) → `FCM_ANDROID_APP_ID` |
| iOS | `com.erp71.app` | the **App ID** (`1:…:ios:…`) → `FCM_IOS_APP_ID` |

Skip the "download google-services.json" step; the app does not use the file.
The **Project number** on the same page goes in `FCM_SENDER_ID`.

**iOS only:** upload an APNs authentication key under **Project settings →
Cloud Messaging → Apple app configuration**. The app also needs the *Push
Notifications* capability, and *Background Modes → Remote notifications*,
added in Xcode before an iOS build. Until both are done, leave `FCM_IOS_APP_ID`
empty and iOS phones simply won't ask.

## 3. Create the sending key

**Project settings → Service accounts → Generate new private key.** This
downloads a JSON file. It is a secret: it can send pushes to every phone.

Put it in `.env.production` on the VPS, either raw on one line or base64:

```bash
FCM_SERVICE_ACCOUNT_JSON=$(base64 -w0 erp71-709cf-firebase-adminsdk.json)
FCM_SENDER_ID=123456789012
FCM_ANDROID_APP_ID=1:123456789012:android:abcdef
FCM_IOS_APP_ID=
```

Then redeploy (`./scripts/deploy.sh main`). Delete the downloaded file afterwards.

## 4. Check it

1. `GET /api/v1/push/config` (signed in) answers `"enabled": true`.
2. Sign in on an Android phone and allow notifications when asked.
   A row appears in `DeviceToken` for that person.
3. Trigger any notification, e.g. submit an expense claim as another member.
   The approver's phone shows it, and tapping it opens the Approvals tab.

If nothing arrives, the backend log has `FCM send refused: HTTP …`. A 401 or
403 there means a wrong or revoked key.

## Rotating or turning off

- **Rotate:** generate a new key, swap `FCM_SERVICE_ACCOUNT_JSON`, redeploy,
  then delete the old key in the Google Cloud console (IAM → Service accounts).
- **Turn off:** empty `FCM_SERVICE_ACCOUNT_JSON` and redeploy. Phones stop
  asking at their next launch, and nothing else changes.
