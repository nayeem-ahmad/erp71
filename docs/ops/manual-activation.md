# Manual activation (no payment gateway)

How a new workspace goes from signup to working while the SSL Wireless gateway
is not live. Signup provisions a tenant unpaid; nothing about that changes here.
What changes is that the wait is visible, the customer can pay today, and the
team is told.

## The flow

1. **Someone signs up.** The workspace is created at `PAST_DUE` with
   `activated_at` null, and they are signed in. Basic setup — store, products,
   POS — works; accounting, CRM, reports and dashboards answer `403` with the
   code `PENDING_ACTIVATION`, which the frontend turns into the activation
   screen instead of a permission error.
2. **Two emails go out.** The owner gets "we're activating your account", which
   quotes the turnaround and the support number. Every address in
   `PLATFORM_ADMIN_EMAILS` gets a new-signup alert with the business name,
   contact, mobile, plan and referral code.
3. **They pay.** `/billing` shows what they owe and the team's bKash/Nagad
   numbers, and takes the transaction ID, sending wallet and amount.
4. **The team verifies.** The submission lands in **Admin › Tenant Management ›
   Activation Requests** and alerts `PLATFORM_ADMIN_EMAILS`. Check it against the
   merchant app, then approve — which posts a `manual_payment` to the tenant's
   ledger, activates the subscription on a real billing period, and emails the
   owner that the workspace is live. Rejecting emails them the reason verbatim
   so they can correct and resubmit.

## Configuration

The payment details are **platform settings**, not environment variables, so
correcting a typo in a number customers are asked to send money to does not need
a redeploy. Set them in **Admin › Platform Settings**, group `activation`:

| Key | What it is |
|-----|-----------|
| `bkash_number` | The team's bKash number. Blank hides bKash as an option. |
| `nagad_number` | The team's Nagad number. Blank hides Nagad. |
| `bank_details` | Free text — account name, number, branch. Blank hides bank transfer. |
| `support_phone` | Shown on the activation screen and in the signup email. |
| `support_whatsapp` | Shown as a WhatsApp link. |
| `sla_hours` | The turnaround quoted on screen and in email. Defaults to 24. |
| `instructions` | Optional extra line under the payment methods. |

**With none of these set the screen still renders** — it falls back to "contact
our team", and the support number is the only thing missing. Set at least
`bkash_number` and `support_phone` before pointing any advertising at signup.

## What is deliberately closed

`POST /billing/confirm` marks a checkout paid on the caller's say-so. Against a
real gateway that is reconciliation; against the manual provider it is a button
that grants a paid plan for nothing, so it is refused when `NODE_ENV=production`
unless `BILLING_ALLOW_MANUAL_CONFIRM=true`. Set that only on a staging box.

## When the gateway goes live

Set `BILLING_PROVIDER=SSL_WIRELESS` with real `SSL_WIRELESS_STORE_ID` and
`SSL_WIRELESS_STORE_PASSWORD`, and checkout starts using the hosted page. None of
this has to be removed: a workspace that has already been activated never sees
the activation screen again, and the request queue stays as the record of what
was collected by hand. Clearing the `activation` settings group hides the manual
payment details from any workspace still awaiting activation, so do that only
once the queue is empty.
