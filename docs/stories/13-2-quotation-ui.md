# Story 13.2: Quotation UI and Document Conversion

Status: done

## Story

As a Sales Rep,
I want an interface to construct a Quote and a view displaying its breakdown, 
so that I can seamlessly convert it to a live Order once the prospect accepts.

## Acceptance Criteria

1.  `/dashboard/quotes` lists standard `Quotation` metrics. [x]
2.  `[id]/page.tsx` details the active Quote including its `version` integer, `valid_until` date wrapper, and UI buttons handling API conversions. [x]
3.  Sidebar navigation contains the "Quotes" list. [x]
4.  The quotations list uses the shared Sales-style table UI and exposes add, view, print, edit, and delete actions. [x]
5.  Quotation detail supports edit mode, save/delete actions, revise, convert, and print-friendly output. [x]

## Dev Notes

- For this v0.1 architecture, Print-to-PDF will simply be a "Print" browser-styled button mimicking the Invoice document. Native PDF generation inside the backend via `puppeteer` or `pdfkit` is reserved for a future tech-debt ticket when full B2B templates are established.

## Dev Agent Record

### Agent Model Used

Antigravity

### Completion Notes List

- Completed frontend components supporting `Revise` and `Convert to Order` workflow steps securely handling API conversions interactively.
- Added visual `FileText` icon directly to the primary Navigation sidebar.
- Reworked the quotations list to match the shared Sales/Orders table pattern and added `CreateQuotationModal`.
- Added detail-page edit and delete flows plus browser print support for quotation documents.
