# Settings → Printing: one place for how documents look

Date: 2026-10-12. Status: approved design, awaiting spec review.

## Why

Users find letterhead design and print settings too complicated. All four complaints are real:

1. The letterhead editor overwhelms first-time owners (about 45 fixed controls plus per-line and per-image controls).
2. Nobody knows where a setting lives. Print settings are spread across Settings → Letterhead Design, Settings → Sales, the Print settings modal on the Sales and Purchases lists, the print menus, the post-save prompt, and the print window toolbar.
3. Print results surprise people. Two footers print (the letterhead footer band and the invoice's built-in thank-you). The letterhead that prints is decided by three overlapping mechanisms. Two cashiers can print different-looking invoices for the same shop.
4. Staff can change things that are the owner's call. Invoice layout is saved per member, so any cashier can change it.

The root cause: settings are split by where they happened to be added, not by who decides them.

## Principle

- **The shop decides how documents look.** Admins set it on one page: Settings → Printing.
- **A counter declares only its hardware.** That means paper size and whether to skip the preview.
- **A one-off print can switch Compact** in the print window, without remembering it.
- **Nothing changes on paper for an existing shop until someone changes a setting on the new page**, with one deliberate exception (see *Thank-you*).
- **KH Trading must not lose its designs.** This is verified against their real data before release (see *Release*).

## Where every setting ends up

| Setting | Today | After |
|---|---|---|
| Letterhead design | Settings → Letterhead Design, ~45 controls | Printing → Letterhead: a style, a short form, and *Fine-tune* |
| Which letterhead prints where | Default flag + 15 doc-type checkboxes per template + branch × 15 grid | Printing → Where it prints: one main letterhead plus exceptions |
| Invoice layout | Per member, Print settings modal | Per shop, Printing → Invoice (`SETTINGS_ADMIN`) |
| Default paper size | Settings → Sales | Printing → Paper & spacing (same `SalesSettings.paper_size` column) |
| Compact | Per browser, switchable from 5 places | Per shop, Printing → Paper & spacing; one-off toggle in the print window |
| Padding (invoice) | Per member | Folded into Spacing |
| Invoice footer text (built-in / custom / none) | Per member | "Note on invoices", per shop |
| Counter paper size, skip preview | Print settings modal (per device) | Unchanged |

The Print settings modal shrinks to paper size and skip preview. Members with `SETTINGS_ADMIN` also see a "Shop print design →" link to Settings → Printing. The compact checkboxes in `SalePrintMenu`, `PaperSizeMenu` and `PrintInvoicePrompt` are removed. Settings → Sales loses its Print Settings card and gains a one-line link to Printing.

## The page

Route `/settings/printing`. `/settings/print-templates` redirects there, and the Settings landing card is renamed "Printing". `PageShell` + `PageHeader`; one **Save** in the header covers every tab. Four tabs on the left, with a sticky live preview on the right: a sample invoice drawn on the letterhead being edited, through the same renderer that prints. A paper-size picker on the preview changes only the preview. On a phone the preview moves below the form, behind a "Show preview" button.

Read access needs `PRINT_READ`. Every control is disabled without `SETTINGS_ADMIN`, matching the existing endpoints.

### Tab 1: Letterhead

A letterhead switcher across the top (pills, plus "+ Add another") appears only once the shop has more than one letterhead. The name field shows only when there is more than one. The Default flag and the doc-type checkboxes leave this tab and move to Where it prints.

**Short form:**

- **Style:** Classic · Centred · Formal · Minimal · Own image. Each style writes only fields that `PrintHeaderConfig` v3 already has, so no rendering change and no config version bump are needed.

  | Style | Writes |
  |---|---|
  | Classic | `logo-left`, title `beside-right`, sans, divider 2px in the accent colour (today's `DEFAULT_HEADER_CONFIG`) |
  | Centred | `logo-above`, title `below-center`, sans, divider 1px in the accent colour |
  | Formal | `text-only`, title `beside-right`, serif, accent `#111827`, divider 1px |
  | Minimal | `logo-left`, logo 8mm, company 11pt not bold, title 10pt, not uppercase, no letter spacing, no divider, accent `#111827` |
  | Own image | `logo-above` with `logo.fullWidth`, company name hidden, no detail lines, title `below-right` |

  Picking a style keeps the logo, the detail ticks, the extra line and the footer. If the current config differs from what any style would write, the chips show **Custom**. Picking a style then asks for confirmation before replacing the fine-tuned header fields.
- **Logo:** Replace / Remove. Uses the business logo when none is set (today's branding fallback). For Own image this is "Header image".
- **Show under your name:** checkboxes for Address, Phone, Email, Website, VAT Reg No and TIN. Each generates one header line from the existing tokens (`{{address}}`, `Tel: {{phone}}`, `Email: {{email}}`, `{{website}}`, `VAT Reg: {{vat_reg_no}}`, `TIN: {{tin}}`). The tokens fill from the document's branch, so per-branch addresses keep working. Hidden for Own image.
- **Extra line:** one optional free-text line.
- **Colour:** six swatches plus Custom. Writes `company.color`, `title.color` and `rule.color`.
- **Footer:** one textarea. Each line becomes a footer line, and an empty textarea sets `footer.show = false`. An edited line keeps its existing size, alignment and colour; a new line copies the line above it (or `DEFAULT_FOOTER_CONFIG`'s style).

**Guard against overwriting real work.** The header lines count as *simple* when every line is either one of the generated detail lines or a single trailing extra line, and no line carries per-line overrides (bold, italic, underline, font family, letter spacing). If the lines are not simple, the checkboxes and the extra line are replaced by "Your header lines are customised — edit them in Fine-tune". Size, colour and alignment do not count as overrides. The footer textarea follows the same rule for footer lines. Footer images and footer layout are always edited in Fine-tune, whatever the lines look like.

**Fine-tune** (collapsed by default) holds every remaining `HeaderEditor` control, grouped as: Logo size & placement · Business name · Document title · Header lines · Header images · Divider · Footer layout (images/signature, divider, every page, pin to bottom, bleed) · Type. These reuse the existing `TemplateBlocks` components.

Opening the page never saves. Configs are written only on Save. Save sends the loaded config with the user's edits applied, so every untouched field renders as before.

A letterhead that prints on nothing (the shop's only letterhead, not main, with no exceptions) shows an amber note on this tab: "This letterhead isn't used on any document yet", with a **Use it everywhere** button that makes it main.

### Tab 2: Invoice

Shop-wide `InvoicePrintPrefs`.

- **Design:** Standard / Detailed, as two thumbnail cards. Hint: thermal rolls always print the receipt design.
- **Item table:** one control whose options follow the design. Standard: Minimal · Striped · Grid · Shaded header (`table_style`). Detailed: Shaded header · Shaded + column lines (`table_borders` `none` / `columns`). The value for the design not chosen is kept, not reset.
- **Warranty column** (Detailed only): Always · When an item has one · Never.
- **Customer's balance:** When they owe · Always · Never.
- **Also print:** Total in words · SL number column · Signature lines · Hide Discount column when unused.
- **Note on invoices:** a textarea (`footer_text`, max 500). Empty means no note.

### Tab 3: Paper & spacing

- **Shop's paper size:** writes `SalesSettings.paper_size`. Hint: a counter with a different printer sets its own size in Print settings.
- **Spacing:** Compact · Normal · Roomy.
  - Compact sets shop density `compact` for every compactable document.
  - Normal and Roomy set density `normal`. They also set invoice `padding` to `normal` or `wide`, since only the invoice has padding.
  - A migrated `padding: 'narrow'` shows a fourth chip, "Narrow (earlier setting)", until someone picks another value.
  - While the shop's spacing is unset (*legacy*), the control shows no selection and a hint: "Each counter keeps its own Compact switch until you choose".

### Tab 4: Where it prints

Shown when the shop has 2+ letterheads, or when its one letterhead is not used everywhere (not main, or has exceptions). A single-letterhead shop that prints it everywhere never sees this tab.

- **Main letterhead:** a select listing every letterhead plus "None: use business branding". Writes `is_default`, true on exactly one template or on none.
- **Exceptions:** rows of "Use [letterhead] for [Any branch | branch] on [All documents | document]", with ✕ to remove and "+ Add exception" to add.

Each row maps onto data that already exists, plus one additive value:

| Row | Stored as |
|---|---|
| Any branch, document X | `X` in `PrintTemplate.doc_types` |
| Branch Y, document X | `PrintTemplateStoreAssignment(store Y, doc_type X)`, as today |
| Branch Y, all documents | `PrintTemplateStoreAssignment(store Y, doc_type '*')` (**new value**) |
| Any branch, all documents | Not offered. That is the main letterhead |

When more than one exception matches, the more specific one wins. Hint text: "branch + document, then branch, then document, then main". If two templates both list the same document in `doc_types`, the row is flagged with an amber warning, because `resolve` picks one arbitrarily today.

## Backend

### Letterhead resolve

`PrintTemplatesService.resolve` inserts one step. Everything that resolves today resolves the same.

1. Store override for `(store, docType)`, as today.
2. **New:** store override for `(store, '*')`.
3. A template whose `doc_types` includes `docType`, as today.
4. `is_default`, as today.
5. Branding fallback, as today.

`UpsertPrintTemplateAssignmentDto` accepts `'*'` as `docType`. `PrintTemplateStoreAssignment` needs no schema change, because `doc_type` is a free string. Deleting a template still cascades its rows.

No letterhead data migration. No stored `PrintTemplate.config` is rewritten.

### Shop print settings

New model:

```prisma
/// How the shop's documents print: invoice layout and spacing.
/// One row per tenant; absent until backfilled or first saved.
model PrintSettings {
  id            String   @id @default(uuid())
  tenant_id     String   @unique
  /// InvoicePrintPrefs JSON (packages/shared-types/invoice-print.ts).
  invoice_prefs Json
  /// 'compact' | 'normal' | 'roomy'; null = legacy, each browser's Compact switch decides.
  spacing       String?
  created_at    DateTime @default(now())
  updated_at    DateTime @updatedAt
  tenant        Tenant   @relation(fields: [tenant_id], references: [id], onDelete: Cascade)
  @@map("print_settings")
}
```

Endpoints on a new `print-settings` controller (tenant-scoped through `TenantInterceptor`):

- `GET /print-settings`, `PRINT_READ` ∪ `SALES_READ` (the union of today's two gates, so nobody who prints today loses access). Returns `{ invoice_prefs, spacing, paper_size }`. **If there is no row, `invoice_prefs` is the requesting member's own `TenantUser.invoice_print_prefs` and `spacing` is null**, so a deploy before the backfill prints exactly as today.
- `PATCH /print-settings`, `SETTINGS_ADMIN`. Partial update: it creates the row on first save (seeded from the requester's member prefs), validates through the shared option lists, and writes `paper_size` through to `SalesSettings`.

`GET /sales-settings/my-invoice-print` becomes an alias returning the same `invoice_prefs` as `GET /print-settings`. `PATCH /sales-settings/my-invoice-print` is removed. `TenantUser.invoice_print_prefs` is kept and no longer written, as the rollback source; drop it in a later migration once the release has settled.

### Effective density on the client

`usePrintDensity` resolves the default density once per print:

- When `spacing` is `compact`, the default is `compact`.
- When it is `normal` or `roomy`, the default is `normal`.
- When it is `null` (legacy), the default is the browser's stored `erp71:print:density`, which is today's behaviour.

The print window's switch becomes one-off: it reflows the open document but no longer posts back or writes storage. In legacy mode the stored browser value is therefore frozen at whatever each counter had. That is how the change preserves KH Trading's counters exactly. A shop changes it by choosing a Spacing.

### Thank-you (the one deliberate visible change)

The built-in "Thank you for your business!" (standard design: the `.footer` div; detailed design: `detailedFooterHtml`'s default) prints **only when the resolved letterhead's footer is not shown**. A non-empty Note on invoices prints as it does today. This applies to every shop, KH Trading included (decision 2026-10-12). It removes the duplicate thank-you where a letterhead footer already carries one.

Migration of `footer_text`: `null` becomes an empty note, because the built-in line is now governed by the rule above. A custom string is kept as the note. `''` stays empty.

## Backfill and the report

`scripts/print-settings-backfill.ts`, following the `scripts/lead-duplicates.ts` pattern: report by default, `--tenant <id>`, `--csv`, and `--yes` to write.

**The report** (read-only), per tenant:

- Members with non-default invoice prefs, grouped by identical normalised prefs.
- The owner's prefs.
- The prefs the rule picks, and whether members disagree.
- Letterhead count, templates with `footer.show`, members whose `footer_text` is `null` (they lose the duplicate thank-you), templates claiming the same doc type, and stores with overrides.

**The rule:** the owner's prefs if they differ from the defaults, otherwise the most common non-default prefs across members (ties go to the most recently updated member), otherwise the defaults. `spacing` is left null.

**`--export <tenant>`** writes that tenant's templates, assignments and member prefs as JSON, with no customer data, for the before/after render below.

The user runs the report on the VPS, since production reads are not available from an agent session. Every disagreeing tenant, and KH Trading regardless, is confirmed with the user before running `--yes`. Because of the no-row fallback, the deploy and the backfill can happen in either order.

## Testing

- **Renderer equivalence:** each style preset, `DEFAULT_HEADER_CONFIG`, and representative fine-tuned fixture configs render to identical `header.ts` HTML on `dev` and on the branch.
- **Resolve equivalence:** a fixture tenant with templates (default, `doc_types`, duplicates) and store overrides. Every `(store, docType)` pair resolves the same before and after; `'*'` rows sit between `(store, doc)` and `doc_types`.
- **Print settings:** no-row fallback to member prefs, first PATCH seeds and creates the row, `SETTINGS_ADMIN` gate, `paper_size` write-through, validation, tenant scoping.
- **Backfill:** owner-customised, most-common, tie, all-default and `footer_text` mapping cases. The report never writes.
- **Frontend:**
  - Each tab.
  - Item table options follow the design; the Warranty column shows only for Detailed.
  - Style → Custom detection.
  - The customised-lines guard.
  - The Where it prints mapping, including `'*'`.
  - The Narrow chip and legacy spacing.
  - The shrunk Print settings modal.
  - A one-off print-window toggle does not write storage.
  - Thank-you rule × letterhead footer, on both designs.
- **Before release (KH Trading):** run `--export` for KH, then render their invoice (standard and detailed as configured), a challan and a money receipt to PDF in headless Chrome on `dev` and on the branch. Compare page for page. The only expected difference is the duplicate thank-you, if KH has one.

## Out of scope

- New rendering features: header background bands, double rules, per-paper overrides in the UI.
- Dropping `TenantUser.invoice_print_prefs`, which needs a later migration.
- The existing TODO items on print pipelines (pages printing through `window.print()`, a mixed-branch bulk print sharing one template's CSS) are unchanged.
