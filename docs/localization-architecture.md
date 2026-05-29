# Localization Architecture

## Goal

Add Bangla cleanly now and keep future languages, such as Malay, to a low-cost change instead of another refactor.

## Current foundation

- Locale registry lives in `apps/frontend/src/lib/localization/config.ts`
- Message catalogs live in `apps/frontend/src/lib/localization/messages/`
- Public i18n provider API remains `apps/frontend/src/lib/i18n.tsx`
- Formatting is centralized in `apps/frontend/src/lib/format.ts`
- Locale preference is persisted in both `localStorage` and a `locale` cookie
- Root layout reads the cookie and sets `<html lang>` and `dir`

## Why this shape

- Existing consumers only depended on `useI18n()` and `format*()` helpers, so the internal implementation was the safest seam to replace.
- Locale metadata is now configuration-driven rather than hard-coded around `en` and `bn`.
- Message files are split by language, which makes translation review and key validation simpler.
- Language and currency are now separate concerns. The app can keep BDT while changing language, and future MYR support does not require a localization redesign.

## Adding a new language later

1. Add the locale metadata entry in `apps/frontend/src/lib/localization/config.ts`
2. Create the message file in `apps/frontend/src/lib/localization/messages/`
3. Export it from `apps/frontend/src/lib/localization/messages/index.ts`
4. Set `enabled: true` when the catalog is ready for users
5. Migrate any remaining hard-coded UI copy in the relevant screens to message keys

Malay is already scaffolded as `ms` with `enabled: false` to demonstrate that path without exposing incomplete translations in the UI.

## Migration plan for the rest of the app

### Phase 1

- Foundation layer
- Dynamic language switcher
- Cookie-backed initial locale
- Locale-aware date, number, and BDT formatting

### Phase 2

- Migrate dashboard shell, auth, billing, POS, sales, inventory, storefront, and onboarding screens from literal strings to message keys
- Replace ad hoc `toLocaleString()` and `toLocaleDateString()` calls with shared format helpers

### Phase 3

- Add translation key completeness checks in CI
- Add tenant-level default locale if different stores need different defaults
- Evaluate locale-prefixed public routes only for storefront and marketing surfaces if SEO becomes important

## Guardrails

- Use semantic keys, not English sentences as keys
- Keep tenant content separate from static UI translations
- Route localization is deferred until there is a concrete SEO requirement
- Do not infer currency from language
