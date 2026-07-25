# AI Data Chatbot — Implementation Plan

**Status:** Phases 1–4 landed on `feat/ai-data-chatbot` (2026-07-21); Phase 5 landed on
`feat/ai-chat-tool-surface` (2026-07-25) — tool surface widened 8 → 29, with the report APIs
behind it. SSE streaming and chart rendering remain deferred (now Phase 6).
**Owner:** —
**Written:** 2026-07-21

> Deviations from the plan as written, all deliberate:
> - The platform kill switch became a real `PlatformFeatures.aiChat` flag (`ai_chat_enabled`),
>   toggled from Platform Settings → Tenant Features, rather than a bare settings row.
> - Two extra `ai` settings ship with it: `chat_model` (blank → platform default) and
>   `chat_daily_turn_cap` (default 200).
> - The credit pool is shared with the other AI features, as recommended in §13.1. The AI Credits
>   page now carries a per-feature breakdown so chat usage is visible.
> - Store scoping (§13.2) resolved as: tenant-wide by default, with the model able to pass a
>   `storeId` from the branch list injected into the system prompt. An id outside the tenant's
>   own branches is dropped, and the model is told the result is unfiltered.
> - `GET /ai/chat/tools` was added beyond the planned endpoints so the UI can tell whether the
>   caller has any tools at all.

A conversational assistant inside the app that answers natural-language questions about the
tenant's own business data ("how much did we sell last month?", "which products are below
reorder point?", "what does Karim Traders owe us?"), in English or Bangla.

---

## 1. Goals & non-goals

**Goals**

- Answer read-only questions about live tenant data, grounded in real query results — never
  estimated or hallucinated numbers.
- Reuse the existing `AiModule` plumbing: OpenRouter client, `AiUsageLog` credit metering,
  `premiumAi` plan entitlement, platform-settings-driven API key and model.
- Respect the same permission boundaries as the UI: a cashier's chatbot must not be able to
  reach data the cashier cannot open a page for.
- Ship a useful v1 in one focused sprint, with room to widen the tool surface later.

**Non-goals (v1)**

- Writing data. Every tool is read-only. No "create a sale for me".
- Text-to-SQL / arbitrary query generation. See §3.
- Streaming responses (SSE). Deferred — see §11.
- Charts or rendered report widgets in the chat. Text answers + a deep link to the real report.
- Cross-tenant or platform-admin analytics.

---

## 2. Decisions already made

| Question | Decision |
|---|---|
| Tool surface for v1 | **Core 8 read-only tools** (§4) |
| Who can use it | **Any role**; the tool list is filtered per-caller by store permission |
| Conversation history | **Persisted** — `AiConversation` + `AiMessage` Prisma models |
| Streaming | **No** — single JSON response; add SSE in a later phase |
| Plan gating | `premiumAi` entitlement, same as every other AI feature |

---

## 3. Architecture: why tool calling, not text-to-SQL

Three ways the model can reach data:

1. **Tool calling over existing services** ← chosen.
   The model picks from a fixed menu of functions. `tenantId` is supplied by the server from
   the JWT and is never a model-controlled argument, so tenant isolation is structural rather
   than prompt-dependent. Handlers call the same `SalesReportsService` / `InventoryReportsService`
   methods the REST endpoints use, so money rounding, soft-delete filtering, and date-window
   semantics stay identical to what the UI shows.
2. **Text-to-SQL.** Rejected for v1. A prompt-injected or hallucinated query can cross tenants
   or table-scan production Postgres. Revisit only with a read-only replica, a role with
   row-level security on `tenant_id`, and a hard `statement_timeout`.
3. **Pre-computed KPI snapshot in the prompt.** Too limited — only answers questions we
   anticipated. Kept in spirit: see the "context preamble" in §7.

### Request flow

```
POST /ai/chat  { conversationId?, message }
  │
  ├─ JwtAuthGuard + TenantInterceptor  → tenantId, userId, storeId, userRole
  ├─ SubscriptionAccessGuard           → plan floor
  ├─ AiService.enforceCredits(tenantId)→ premiumAi entitlement + monthly credit ceiling
  ├─ load conversation (last N messages) or create one
  ├─ build tool list = CHAT_TOOLS filtered by hasStorePermission(db, ctx, tool.permission)
  │
  └─ agent loop (max 5 iterations):
       POST OpenRouter /chat/completions  { model, messages, tools }
         ├─ finish_reason = "tool_calls" → run each handler(tenantId, ctx, args)
         │                                  append tool result messages, loop
         └─ finish_reason = "stop"       → final text
       every iteration writes an AiUsageLog row (feature: 'data_chat')
  │
  └─ persist user + assistant messages (+ tool-call trace) → return { conversationId, reply, toolCalls[] }
```

The loop is a hard `for` with an iteration cap; on hitting the cap we return whatever text we
have plus a note that the question needed too many lookups.

---

## 4. The tool registry

New file `apps/backend/src/ai/chat-tools.ts`. Each entry declares a JSON Schema (sent to the
model verbatim), the store permission required to expose it, and a handler.

```ts
export interface ChatTool {
    name: string;
    description: string;          // written for the model — say when to use it
    permission: StorePermission;  // filtered via hasStorePermission() before the call
    parameters: Record<string, unknown>;  // JSON Schema
    handler: (ctx: TenantContext, args: any, deps: ChatToolDeps) => Promise<unknown>;
}
```

`ChatToolDeps` is a small injected bag of the services below, wired in `AiModule`.

| # | Tool | Backing call | Permission |
|---|---|---|---|
| 1 | `sales_summary` — revenue, order count, AOV for a date range | `SalesReportsService.getSalesSummary` | `VIEW_FINANCIAL_REPORTS` |
| 2 | `top_products` — units and revenue by product | `SalesReportsService.getSalesByProduct` | `VIEW_FINANCIAL_REPORTS` |
| 3 | `low_stock` — items at/below reorder point | `InventoryReportsService.getReorderSuggestions` | `VIEW_PRODUCT_CATALOG` |
| 4 | `stock_on_hand` — quantity + valuation, filterable by warehouse/group | `InventoryReportsService.getInventoryValuation` | `VIEW_PRODUCT_CATALOG` |
| 5 | `customer_lookup` — find a customer by name/phone, return balance + recent activity | `CustomersService.findAll({search})` → `getAnalytics` | `VIEW_CRM_INTERACTIONS` |
| 6 | `receivables_aging` — who owes what, bucketed | `CustomersService.getDueAgingReport` | `VIEW_CUSTOMER_CREDIT` |
| 7 | `expense_summary` — spend by category for a range | `ExpensesService.getSummary` | `VIEW_FINANCIAL_REPORTS` |
| 8 | `purchase_summary` — purchase totals, optionally by supplier | `PurchaseReportsService.getPurchaseSummary` | `VIEW_FINANCIAL_REPORTS` |

Phase-2 candidates (do not build in v1): `branch_comparison`
(`getBranchReport` / `getConsolidatedReport`, gated on `VIEW_CONSOLIDATED_REPORTS`),
`sales_by_customer`, `shrinkage_summary`, `loan_balances`, `attendance_summary`.

### Tool contract rules

- **`tenantId` is never in `parameters`.** It comes from `ctx`. Same for `userId`.
- **`storeId` may be a parameter**, but the handler must validate the id belongs to the tenant
  and that the user has access, or drop it. Prefer resolving branch names to ids server-side.
- **Results are truncated** before going back to the model: cap list tools at 20 rows and add
  `{ truncated: true, totalRows: N }` so the model can say "showing the top 20 of 143".
- **Results are shrunk**: strip nulls, drop ids the model doesn't need, round money to 2dp.
  Every row that reaches the model is input tokens on the *next* iteration too.
- **Handlers never throw raw Prisma errors** to the model. Catch and return
  `{ error: "human readable reason" }` so the model can apologise instead of the whole turn 500ing.

---

## 5. Backend changes

| File | Change |
|---|---|
| `apps/backend/src/ai/chat-tools.ts` | **new** — registry above + `ChatToolDeps` interface |
| `apps/backend/src/ai/chat.service.ts` | **new** — agent loop, tool dispatch, conversation persistence |
| `apps/backend/src/ai/ai.service.ts` | add `callOpenRouterWithTools()` (multi-message + `tools` param) and export `enforceCredits` / `logUsage` for reuse. The existing `complete()`/`callOpenRouter()` are single-shot system+user only — do not bend them, add a sibling. |
| `apps/backend/src/ai/ai.controller.ts` | add `POST /ai/chat`, `GET /ai/chat/conversations`, `GET /ai/chat/conversations/:id`, `DELETE /ai/chat/conversations/:id` |
| `apps/backend/src/ai/ai.dto.ts` | `ChatDto { conversationId?: string; message: string; locale?: 'en'\|'bn' }` |
| `apps/backend/src/ai/ai.module.ts` | import `SalesReportsModule`, `InventoryReportsModule`, `PurchaseReportsModule`, `CustomersModule`, `ExpensesModule`; provide `ChatService`. Watch for circular imports — use `forwardRef` where the target already imports `AiModule`. |
| `packages/database/prisma/schema.prisma` | `AiConversation`, `AiMessage` (§6) + migration |
| `packages/shared-types/index.ts` | `AiChatMessage`, `AiChatToolCall`, `AiChatResponse` types |
| `apps/frontend/src/lib/api.ts` | `aiChat()`, `getAiConversations()`, `getAiConversation()`, `deleteAiConversation()` |

No new store permission is introduced — access is derived from the permissions the user already
has. The feature as a whole is gated by `premiumAi` + a platform-settings `chat` feature flag
so it can be killed globally without a deploy (mirror `isFeatureEnabled('voice')`).

---

## 6. Data model

```prisma
model AiConversation {
  id         String      @id @default(cuid())
  tenant_id  String
  user_id    String
  title      String?     // first user message, truncated — filled on first turn
  created_at DateTime    @default(now())
  updated_at DateTime    @updatedAt

  tenant   Tenant      @relation(fields: [tenant_id], references: [id], onDelete: Cascade)
  messages AiMessage[]

  @@index([tenant_id, user_id, updated_at])
}

model AiMessage {
  id              String   @id @default(cuid())
  conversation_id String
  role            String   // 'user' | 'assistant'
  content         String   @db.Text
  tool_calls_json Json?    // [{ name, args, rowCount, ms }] — audit trail + UI "sources" line
  credits_used    Float    @default(0)
  created_at      DateTime @default(now())

  conversation AiConversation @relation(fields: [conversation_id], references: [id], onDelete: Cascade)

  @@index([conversation_id, created_at])
}
```

Notes:
- Store the *summary* of tool calls, not full result payloads — those can be large and are a
  second copy of tenant data. `rowCount` + args is enough for auditing "what did this user ask
  the bot to look at".
- Retention: add these tables to `docs/data-retention-policy.md`; propose 180-day purge via the
  existing `@nestjs/schedule` cron pattern.
- On replay we resend the stored `user`/`assistant` messages only — tool result messages are
  *not* replayed into later turns (too expensive). Cap replay at the last 10 messages.

---

## 7. Prompting

System prompt is assembled per request, not a constant:

1. **Role** — "You are the ERP71 business assistant for a Bangladeshi retailer. Answer only from
   tool results."
2. **Grounding rule** — "Never compute, estimate, or recall a number that did not come from a
   tool result in this conversation. If no tool can answer, say what you cannot see and suggest
   which report to open."
3. **Context preamble** — today's date, tenant timezone, currency (BDT), the tenant's store list
   (id + name, so "Gulshan branch" resolves without a lookup tool), fiscal-year start.
   Without an injected date, "last month" is whatever the model guesses.
4. **Formatting** — amounts as `৳1,23,456` (the frontend re-formats via `formatBDT()`, but the
   model should not emit `$`); short answers, a compact markdown table when >3 rows.
5. **Locale** — mirror `draftMessage`: reply in Bangla when `locale === 'bn'` or when the user
   wrote in Bangla.

Model: the platform default (`anthropic/claude-haiku-4.5`). Tool calling on Haiku 4.5 is
adequate for an 8-tool menu; if routing accuracy is poor in testing, the fallback is
`anthropic/claude-sonnet-4.6` for this feature only, via a new platform setting `ai.chat_model`.

---

## 8. Cost & credits

- 8 tool schemas ≈ 1.5–2.5k input tokens per iteration, before results. A typical 2-iteration
  turn lands around 5–8k total tokens ≈ **5–8 credits** at `AI_TOKENS_PER_CREDIT = 1000`.
- That is material against a PREMIUM allowance of 2,000 credits/month (~250–400 questions).
  Decide before launch whether chat gets its own allowance or shares the pool. **Recommendation:**
  share the pool for v1, surface per-feature breakdown on `/settings/ai-credits` so heavy chat
  users are visible, and revisit pricing with real numbers.
- Log **every** loop iteration to `AiUsageLog` with `feature: 'data_chat'`. Under-billing here is
  a silent margin leak.
- Enable OpenRouter prompt caching on the system prompt + tool schemas (they are stable per
  tenant per day). `usage.prompt_tokens_details` is already read and stored by `complete()`.
- Guard rails: max 5 iterations, max 12 messages replayed, max 20 rows per tool result, and a
  per-tenant per-day chat turn cap (platform setting, default 200) to bound a runaway loop.

---

## 9. Frontend

Model it on `VoiceNavWidget.tsx` (header-mounted, i18n'd, already handles the mic/permission UX).

- **Entry point:** a chat icon in the app top bar next to the notification bell. Not a floating
  action button — `docs/ui-design-guidelines.md` forbids them.
- **Panel:** docked right-side panel on desktop (~380px), `ModalShell` bottom sheet on mobile.
  `blue-600` accent, `text-sm` body, ≥44px touch targets.
- **Message list:** user bubbles right, assistant left. Under each assistant message render a
  collapsed sources line — "Looked at: sales summary (1 Jun–30 Jun), low stock (7 items)" — from
  `tool_calls_json`. This is what makes the answer auditable and is the single most important
  trust affordance in the feature.
- **Pending state:** "Checking your sales…" driven by the tool name of the in-flight call is not
  available without streaming; v1 shows a generic animated "Thinking…" row.
- **Deep links:** where a tool maps to a real page, render a "Open full report →" link under the
  answer. Mapping lives in the frontend, keyed by tool name.
- **Errors:** inline in the thread, not a toast (the global `Toaster` is for app-level events).
- **Empty state:** 4 suggested starter questions, localized — these do most of the work of
  teaching people what the bot can and cannot do.
- **i18n:** en/bn/ms strings from the start; do not repeat the English-only precedent of the
  platform-settings AI page.

---

## 10. Security & privacy

- Tenant scoping: `tenantId` from `TenantInterceptor` only. Add a unit test asserting no tool's
  JSON Schema contains a `tenantId`-like property.
- Permission filtering happens **before** the tool list is sent — an unauthorized tool is not
  merely refused, the model never learns it exists.
- Prompt injection: tenant data (customer names, product names, notes) enters the context as
  tool results. A malicious "customer name" cannot escalate because the model's only capability
  is calling more read-only tools the user is already entitled to. Still: never render
  assistant output as raw HTML on the frontend.
- The conversation store contains business figures — cascade-delete on tenant deletion is
  covered by the `onDelete: Cascade` above; add to the data-retention doc.
- Rate limit `POST /ai/chat` via the existing `@nestjs/throttler` config (suggest 20/min/user).

---

## 11. Phasing

**Phase 1 — vertical slice (target: 2 days)**
- Prisma models + migration
- `callOpenRouterWithTools()` + agent loop in `ChatService`
- 2 tools only: `sales_summary`, `low_stock`
- `POST /ai/chat`, no history endpoints
- Throwaway test page to drive it

**Phase 2 — the other 6 tools + permission filtering + conversation endpoints**

**Phase 3 — frontend panel** (docked/bottom-sheet, sources line, deep links, i18n, starter questions)

**Phase 4 — hardening**: credit accounting verified against OpenRouter dashboard, per-day cap,
throttler, retention cron, `/settings/ai-credits` per-feature breakdown, tests (§12)

**Phase 5 (landed 2026-07-25)**: tool surface widened 8 → 29, with the report APIs behind it.
The three changes that mattered were shape, not count — `compareTo` (prior window computed in
the report layer, never by the model), a single `groupBy` breakdown in place of one endpoint
per dimension, and `resolve_entity` (without it the model's only way to filter by a named
product or supplier was to invent an id). "Why did this number change" became `top_movers`.
Also: paging on list tools, parallel tool calls within a turn, `MAX_TURNS` 5 → 8, and a
module filter so accounting-only tenants stop being offered inventory tools.

**Phase 6 (later)**: SSE streaming, chart rendering in chat, Bangla quality pass.

---

## 12. Testing

- **Unit**: each tool handler against seeded demo data (the six-month demo generator already
  exists) — assert shape, row cap, and money rounding.
- **Unit**: permission filter — for each `UserRole`, assert the exact expected tool subset.
  This is the security-critical test.
- **Unit**: agent loop with a stubbed OpenRouter — tool_calls → dispatch → second call → stop;
  plus the iteration-cap path and the handler-error path.
- **Integration**: `POST /ai/chat` returns 403 without `premiumAi`, 403 over credit limit.
- **Manual eval set**: ~25 written questions (mixed English/Bangla) with known-correct answers
  from the demo tenant, run before each change to the tool schemas or prompt. Keep it in
  `apps/backend/test/fixtures/ai-chat-eval.md`. Without this, prompt changes are unfalsifiable.

---

## 13. Open questions

1. **Credit pool** — shared with other AI features, or a separate `chat_credits` allowance?
   (Recommendation: shared for v1.)
2. **Store scoping** — should a multi-branch tenant's chat default to the currently selected
   store, or tenant-wide? Currently `TenantInterceptor` gives us `storeId`; the safest default is
   *current store*, with the model able to ask for tenant-wide when the user says "all branches"
   and holds `VIEW_CONSOLIDATED_REPORTS`.
3. **Bangla numerals** — do users want `৳১,২৩,৪৫৬` or Latin digits in Bangla replies?
4. **Does the accounting-only tenant mode get the chatbot?** If so tools 3–4 are meaningless
   there and the registry needs a module-aware filter alongside the permission filter.

---

## 14. References

- `apps/backend/src/ai/ai.service.ts` — existing OpenRouter client, credit metering, `enforceCredits`
- `apps/backend/src/auth/permission.util.ts` — `hasStorePermission(db, ctx, permission)`
- `apps/backend/src/database/tenant.decorator.ts` — `TenantContext`
- `apps/frontend/src/components/VoiceNavWidget.tsx` — header widget precedent
- `docs/ui-design-guidelines.md` — non-negotiable UI rules
