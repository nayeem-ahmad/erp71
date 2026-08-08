# Blog post editors — AI Assistant draft button

**Date:** 2026-08-08
**Status:** Approved, ready for planning

## Problem

Writing a blog post from an empty editor means filling ten-odd fields by hand: a title, an excerpt, a body in markdown, two SEO strings, a slug, cover alt text, a category, an author, and — on the platform blog — an audience. Every one of them is derivable from a single sentence describing what the post should be about.

Both editors should offer a button that takes that sentence and fills the form, leaving the author to review and correct rather than to start from nothing. Nothing is persisted by the generation step; the author still saves.

## Scope

- An **AI Assistant** button on both post editors, new and existing posts alike.
- A modal that takes a free-text prompt and returns a filled form.
- One backend endpoint per blog, sharing a single prompt and response contract.

Out of scope: cover image generation (the model is text-only), translating an existing post into another locale, tone/length presets, and any change to how posts are saved or published.

## The two editors

The two authoring surfaces differ enough that the split drives most of this design.

| | Platform blog | Storefront blog |
| --- | --- | --- |
| Component | [`AdminPostEditor.tsx`](../../../apps/frontend/src/components/blog/AdminPostEditor.tsx) | [`TenantPostEditor.tsx`](../../../apps/frontend/src/components/blog/TenantPostEditor.tsx) |
| Route | `/admin/blog/new`, `/admin/blog/[id]` | `/settings/blog/new`, `/settings/blog/[id]` |
| Audience | Platform staff writing for the whole customer base | A shop owner writing for their own customers |
| Languages | Three locale tabs: `en`, `bn`, `ms` | Single language |
| Tenant | None — these posts belong to no tenant | Tenant-scoped |

## Backend

### One shared contract

Prompt assembly and response normalization live in one pure module, `apps/backend/src/blog/blog-ai-draft.ts`. Keeping them out of both services means one JSON contract instead of two that drift, and unit tests that never touch the network.

It exports two functions:

```ts
buildBlogDraftPrompt(options: {
    prompt: string;
    locale: string;             // 'en' | 'bn' | 'ms'
    categories: Array<{ id: string; name: string }>;
    includeAudience: boolean;   // platform blog only
}): { systemPrompt: string; userMessage: string }

normalizeBlogDraft(raw: string, options: {
    categories: Array<{ id: string; name: string }>;
    includeAudience: boolean;
}): BlogAiDraft
```

`normalizeBlogDraft` parses with the existing `extractJson<T>()` helper on `AiService`, which already strips ```` ```json ```` fences and throws a clean error on unparseable output.

### Two endpoints

| | Platform blog | Storefront blog |
| --- | --- | --- |
| Route | `POST /admin/blog/ai-draft` | `POST /blog/manage/ai-draft` |
| Controller | [`blog-admin.controller.ts`](../../../apps/backend/src/blog/blog-admin.controller.ts) | [`tenant-blog.controller.ts`](../../../apps/backend/src/tenant-blog/tenant-blog.controller.ts) |
| Guards | `JwtAuthGuard`, `PlatformAdminGuard` | `JwtAuthGuard`, `StorePermissionGuard`, `TenantInterceptor`, `@RequireStorePermission(StorePermission.MANAGE_BLOG)` |
| Billing | Unbilled | `enforceCredits` before, `logUsage` after, feature `blog_post_draft` |

Each endpoint takes the same request body:

```ts
class BlogAiDraftDto {
    prompt: string;    // required, non-empty
    locale?: string;   // defaults to 'en'
}
```

The platform endpoint takes no locale beyond what the open tab sends; the tenant endpoint uses the shop's own language.

### Why the platform side is unbilled

`AiUsageLog.tenant_id` is a required foreign key to `Tenant` ([`schema.prisma:4644`](../../../packages/database/prisma/schema.prisma)). A platform blog post belongs to no tenant, so there is no row that could be written and no credit balance that could be charged. [`feedback-agent-runner.service.ts`](../../../apps/backend/src/feedback-automation/feedback-agent-runner.service.ts) already established this path: it calls OpenRouter directly and logs no usage. Platform staff traffic is low-volume and internal, so the untracked cost is acceptable; making it trackable would mean a nullable-tenant usage log, which is a separate change.

To support both paths, the private `AiService.complete()` splits in two:

```ts
async completeUnbilled(model, systemPrompt, userMessage, maxTokens): Promise<{ text; usage }>

private async complete(tenantId, feature, model, systemPrompt, userMessage, maxTokens): Promise<string> {
    const { text, usage } = await this.completeUnbilled(...);
    await this.logUsage(tenantId, feature, model, usage);
    return text;
}
```

`complete()` keeps its current signature and behaviour, so `narrateReport`, `parseVoiceEntry` and `draftMessage` are untouched.

### The model call

Model comes from platform settings via `getDefaultModel()` — today `anthropic/claude-haiku-4.5` through OpenRouter. `max_tokens` is 3000, well above the 512 default, because a full article body is the bulk of the response.

The system prompt establishes the role (a content writer for a Bangladeshi retail SaaS blog), demands markdown for the body, names the target language, lists the available category names, and specifies the exact JSON shape with no prose around it.

### Generated fields and their guardrails

| Field | Guardrail |
| --- | --- |
| `title`, `excerpt`, `body_md` | Trimmed; body must be non-empty or the response is rejected |
| `seo_title`, `seo_description` | Trimmed, omitted when blank |
| `slug` | Passed through the repo's existing `slugify()` from [`blog-slug.ts`](../../../apps/backend/src/blog/blog-slug.ts) |
| `cover_alt` | Trimmed, omitted when blank |
| `category` | Returned as a **name**, matched case-insensitively against the injected list and mapped to its id; an unrecognized name becomes `null`, never an invalid foreign key |
| `author_name`, `author_title` | Trimmed, omitted when blank |
| `featured` | Coerced to boolean, defaults `false` |
| `audience` | Platform blog only; clamped to `PUBLIC`, `IN_APP` or `BOTH`, defaulting to `BOTH` on anything unrecognized |

Deliberately **not** generated: `scheduled_for`, because a model has no basis for choosing a publish date, and the cover image itself, because the model is text-only. Both stay manual.

## Frontend

### The shared modal

`apps/frontend/src/components/blog/AiDraftModal.tsx`, built on [`ModalShell`](../../../apps/frontend/src/components/ModalShell.tsx) (`size="md"`) — a labelled prompt textarea, a hint line, and Cancel / Generate in the footer. Generate is disabled while the prompt is empty and shows a loading state while the request is in flight.

The modal owns no editor knowledge. It takes:

```ts
type AiDraftModalProps = {
    open: boolean;
    prompt: string;
    onPromptChange: (value: string) => void;
    onClose: () => void;
    onGenerate: () => Promise<void>;   // parent calls its own endpoint and applies the result
};
```

The prompt lives in the parent's state so re-running after a locale switch does not mean retyping it.

### The button

Each editor's header row gets a secondary `Button` with a `Sparkles` icon, labelled from the i18n dictionary. It sits alongside Save / Publish, follows the blue-600 accent rule, and inherits the shared `Button`'s touch sizing on mobile.

### Applying the result

On success the fields populate in place, the modal closes, and a success toast fires. **Nothing is written to the database** — the editor is the review surface, and the author saves through the existing Save button exactly as before.

If `title`, `excerpt` or `body_md` already holds content, a `ConfirmDialog` warns before the fields are replaced. The confirm runs *after* generation, so a cancelled overwrite still leaves the author the option to re-run.

In the platform editor, the returned text fields patch **only the currently open locale tab** via the existing `patchCurrent()`; slug, category, audience, author and featured are post-level and always patched. The request carries the open tab's locale, so generating on the BN tab returns Bangla.

### Copy

New keys in [`localization/messages/en.ts`](../../../apps/frontend/src/lib/localization/messages/en.ts) and `bn.ts`, under the existing `admin.blog.editor` and `storefront.blog` namespaces: button label, modal title, prompt label, prompt placeholder, generate label, overwrite-confirm title and prompt, and the success toast.

## Errors

Every failure leaves the form untouched and surfaces through the global toaster.

| Failure | Behaviour |
| --- | --- |
| Empty prompt | Generate button disabled; no request |
| No OpenRouter key configured | Existing `AI service is not configured` error |
| Tenant out of credits | Existing `enforceCredits` error message |
| Model returns unparseable JSON | Existing `extractJson` error: `AI returned an invalid response. Please try again.` |
| Model returns JSON with no body | Same invalid-response error, raised by the normalizer |
| Non-platform-admin hits the admin endpoint | 403 from `PlatformAdminGuard` |

## Testing

**`blog-ai-draft.spec.ts`** — the guardrails, which is where the real risk sits:

- The prompt includes the target language, the category names, and the audience instruction only when `includeAudience` is set
- A category name matches case-insensitively and maps to its id
- An unknown category name yields `null`
- `PUBLIC` and `IN_APP` survive; an unrecognized audience falls back to `BOTH`
- A slug with spaces and punctuation comes back normalized
- Blank optional fields are omitted rather than sent as empty strings
- A response with no `body_md` is rejected
- A fenced ```` ```json ```` response parses

**Backend controller/service specs** with a stubbed `AiService`:

- The admin endpoint is rejected without platform-admin
- The tenant endpoint calls `enforceCredits` before the model call and `logUsage` after
- The admin endpoint writes no `AiUsageLog` row

**`AiDraftModal.test.tsx`** — Generate is disabled on an empty prompt, calls `onGenerate` when clicked, and shows a loading state while pending.
