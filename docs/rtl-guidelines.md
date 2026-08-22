# RTL (right-to-left) guidelines

The platform ships two RTL locales — Urdu (`ur`) and Arabic (`ar`). Both are
registered in `packages/shared-types/locales.ts` with `dir: 'rtl'`, which
`app/layout.tsx` renders onto `<html dir>` and `persistLocalePreference` updates
on a client-side language switch.

There is **no RTL stylesheet**. The layout mirrors because the UI is written in
logical Tailwind utilities, which resolve against `dir` at paint time. Keeping
it that way is the whole discipline.

---

## The rule

Never write a Tailwind utility that names a physical side.

| Don't | Do | Don't | Do |
|---|---|---|---|
| `ml-4` | `ms-4` | `left-0` | `start-0` |
| `mr-4` | `me-4` | `right-0` | `end-0` |
| `pl-4` | `ps-4` | `text-left` | `text-start` |
| `pr-4` | `pe-4` | `text-right` | `text-end` |
| `border-l` | `border-s` | `rounded-l-md` | `rounded-s-md` |
| `border-r` | `border-e` | `rounded-r-md` | `rounded-e-md` |
| `float-left` | `float-start` | `clear-right` | `clear-end` |

Tailwind 3.4 ships every one of these, and under `dir="ltr"` they compile to
exactly the physical property they replace. **Switching is a visual no-op for
the seven LTR locales**, which is why the whole app was converted in one sweep
rather than page by page.

`space-x-*` is the exception that needs a companion rather than a replacement:
it puts `margin-left` on every child but the first, so under RTL the gap lands
outside the last item and the first two sit flush. Pair it with
`rtl:space-x-reverse`, which is inert in LTR:

```tsx
<div className="flex items-center space-x-2 rtl:space-x-reverse">
```

`gap-*` has no such problem and is preferred for new code.

### Enforced, not remembered

`src/lib/localization/rtl-utilities.test.ts` runs the codemod's transform over
every source file and fails if it would change anything. A physical utility
cannot land without turning the suite red, and the failure names the file.

To fix a batch automatically:

```bash
node scripts/rtl-codemod.js            # report what would change (exit 1 if any)
node scripts/rtl-codemod.js --write    # apply
```

---

## What logical utilities do *not* fix

Mirroring the box model is most of the work, not all of it.

**Glyphs don't mirror.** A "next" chevron still points physically right in
Arabic, where next is to the left. `globals.css` flips the left/right lucide
icons under `[dir='rtl']` from one rule, keyed on the stable `lucide-<name>`
class. Up/down glyphs, spinners and sort carets are deliberately absent from
that list — flipping them would be the mirror-image bug. Two escape hatches:

- Add `.rtl-keep` to an icon whose arrow describes something physical (a chart
  axis, a printed form) rather than reading order.
- If the icon carries its own transform (`group-hover:translate-x-1`), the
  specificity-0 `:where()` rule loses to it. Add `rtl:-scale-x-100` explicitly,
  which composes through Tailwind's transform variables.

**`translate-*` is physical.** Anything that slides — drawers, sheets, carousels
— needs an `rtl:` counterpart. The mobile sidebar is the worked example: it is
anchored `start-0` but hides with `-translate-x-full`, so it carries
`rtl:translate-x-full` to leave from the correct edge.

`left-1/2 -translate-x-1/2` centering is the one case to leave physical. Both
halves are symmetric about the centre, so it centres correctly in either
direction; converting the inset to `start-1/2` while `translate-x` stays
physical would break it.

**Hardcoded arrows in copy.** The DataTable scroll hint renders `→` in LTR and
`←` in RTL through `rtl:hidden` / `hidden rtl:inline`. Prefer an icon or a pair
of spans over an arrow character baked into a translated string.

---

## Numerals

`ar` is registered as `ar-EG-u-nu-latn` rather than `ar-EG`. Without the
`-u-nu-latn` extension, `Intl.NumberFormat` renders Eastern Arabic numerals
(`١٢٣`). Those are correct Arabic, but the API returns Latin digits, so a ledger
would mix both in one column and a copy-paste into a spreadsheet would not
parse. `ur` uses `ur-PK`, which is Latin-digit by default.

---

## Plurals

Arabic has six CLDR plural categories (zero, one, two, few, many, other). The
catalogs use inline ICU so each locale supplies only the ones its language
needs:

```ts
// en
recipeCount: '{count, plural, one {# recipe} other {# recipes}}'
// ar
recipeCount: '{count, plural, zero {لا وصفات} one {وصفة واحدة} two {وصفتان} few {# وصفات} many {# وصفة} other {# وصفة}}'
```

Resolve them with `fmt` from `useI18n()`, never the bare `formatMessage`
export — `fmt` is bound to the active locale, and the bare one defaults to
English rules, which silently pick `other` for both 2 and 15 in Arabic. A
dev-mode `console.warn` fires if a plural template is formatted without a
locale.

---

## Typography

Inter has no Arabic glyphs, so `Noto Sans Arabic` is loaded for both `ar` and
`ur` and sits in the Tailwind `sans` stack after Inter and Noto Sans Bengali.

It is **Naskh, not Nastaliq**, and that is a stated tradeoff rather than an
oversight: Urdu readers expect Nastaliq, but its cascading baseline needs
roughly double the line-height, and this UI is deliberately compact. Shipping
Nastaliq without first re-tuning row heights would break every table in Urdu.
The Nastaliq pass is tracked in `TODO.md` and wants a designer looking at real
tables.

---

## Reviewing an RTL change

The suite cannot see layout. Before shipping UI that matters in RTL:

1. Switch the language to Arabic and confirm `<html dir="rtl">`.
2. Check anything that slides, floats, or is absolutely positioned.
3. Check tables: the numeric column should sit on the visual left, headers
   should align with their cells, and the horizontal scroll affordance should
   point the way the table actually scrolls.
4. Check that directional icons point the way the reader is going.

### What the first mirrored-viewport pass found

Login, the app shell, the sales hub and a populated products table were driven
under `ar` and `ur` in a real browser. Two defects that no test could see:

- **The desktop sidebar was parked off-screen.** `md:translate-x-0` undoes the
  mobile drawer's hidden transform, but it loses in the cascade to the drawer's
  own `rtl:translate-x-full`, so at `md` and up the whole sidebar sat at
  `translateX(100%)` — invisible in both RTL locales. Fixed by pairing it with
  `md:rtl:translate-x-0`. **A responsive reset of a `translate-*` needs an
  `rtl:` twin, or the `rtl:` rule wins at every breakpoint.**
- **Hardcoded English in JSX.** The login divider and the whole
  email-verification banner were literals, never catalog keys — so they
  rendered English in all nine locales while every i18n check reported the
  catalogs complete. In RTL they were doubly obvious: LTR sentences in a
  mirrored layout, with trailing full stops bidi-flipped to the front.

Neither the catalog parity test nor `scripts/i18n-report.js` can see a string
that was never a key. Only opening the page finds those.
