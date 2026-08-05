# Short link simplification — design

**Date:** 2026-08-05
**Status:** approved

Two changes to the URL shortener shipped on 2026-08-05: shorter, human-safe
codes, and a way to get the full URL onto the clipboard from the manager table.

## Motivation

The links are long enough to be awkward where they actually get used —
WhatsApp messages and printed quotations. `app.erp71.com/s/Rqeaom3` is 23
characters, and the mixed-case code is unpleasant to read aloud down a phone.

Separately, the manager table renders `/s/<code>` as bare text. There is no way
to obtain the full URL from that screen at all: no copy control, and the domain
is not even shown, so selecting the text by hand still gives you a path rather
than a link you can paste.

## Decisions

### Domain: unchanged

Short links stay on `app.erp71.com`. `erp71.com` was considered and rejected
for now: the apex resolves to Bluehost shared hosting (162.241.27.28, a parked
Skenzo page), not the VPS, so it would require a registrar DNS change and a new
Caddy site block. `s.erp71.com/<code>` was also considered — identical character
count to `erp71.com/s/<code>` — and rejected for the same external dependency.

Revisit if the saving becomes worth the DNS work. Repointing the apex would also
replace the parked page with the app's real marketing landing page, and would
not affect email, since MX records are independent of the A record.

### Code: 6 characters, 31-character alphabet

```
ALPHABET  '23456789abcdefghjkmnpqrstuvwxyz'
LENGTH    6
Space     31^6 = 887,503,681
```

Lowercase and digits only, excluding `0`, `1`, `i`, `l` and `o`. These links get
printed on quotations, so a code that cannot be misread off paper or misheard
over a phone is worth more than the extra keyspace the full 36-character set
would give. 887 million is far beyond any plausible link count.

**No migration and no backfill.** Resolution is an exact
`findUnique({ where: { code } })`, so existing 7-character base62 codes keep
resolving unchanged; only newly minted codes take the new shape. The two formats
coexist permanently, which is fine because nothing derives meaning from a code's
shape.

**Collision handling already exists.** `insertWithCode` retries up to
`MAX_CODE_ATTEMPTS = 5` on a P2002 unique violation and then fails loudly. At
887M keyspace that headroom is ample until link counts reach the millions.

**Resolution stays case-sensitive.** Case-insensitive lookup was rejected: the
existing mixed-case codes would make it ambiguous (`Rqeaom3` and `rqeaom3` could
both exist), and these links are pasted rather than typed, so the benefit is
small against a correctness risk.

### Copy button: icon, in the manager row

An icon-only button beside the path in each `ShortLinkManager` row, copying
`${window.location.origin}/s/${code}` — the full, immediately pasteable URL. The
`Copy` icon flips to `Check` for two seconds, matching the pattern ShareModal
already uses.

The row keeps showing the compact `/s/<code>` rather than the full URL. The table
already scrolls horizontally on a phone, and widening the first column to fit a
domain would push the target and click columns further out of view for no gain —
the full URL is what you *copy*, not what you need to *read*.

Two behaviours worth stating explicitly:

- **Hidden on revoked rows**, matching the revoke button. A revoked link 404s, so
  offering to copy it hands someone a dead URL.
- **Clipboard failures are caught and surfaced as a toast.** `navigator.clipboard`
  is undefined in insecure contexts, where an uncaught rejection would leave the
  user believing they had copied something.

## Components touched

| File | Change |
|------|--------|
| `apps/backend/src/short-links/short-link-code.ts` | alphabet, length, doc comment |
| `apps/backend/src/short-links/short-link-code.spec.ts` | length, alphabet membership, look-alike exclusion |
| `apps/frontend/src/components/short-links/ShortLinkManager.tsx` | copy button |
| `apps/frontend/src/components/short-links/ShortLinkManager.test.tsx` | copy behaviour, revoked rows |
| `apps/frontend/src/lib/localization/messages/{en,bn,ms}/components.ts` | `copyAria`, `copied` |

## Testing

Backend: generated codes are 6 characters, every character is in the alphabet,
and no code across a large sample contains `0`, `1`, `i`, `l` or `o`.

Frontend: the button writes the origin-qualified URL to the clipboard, shows the
check state afterwards, does not render for a revoked row, and surfaces a toast
when the clipboard write rejects.

## Out of scope

- Any domain or DNS change.
- Backfilling or re-minting existing codes.
- Case-insensitive resolution.
- ShareModal's own copy button, which has the same uncaught-rejection gap. Noted
  to the user; folded in only if asked.
