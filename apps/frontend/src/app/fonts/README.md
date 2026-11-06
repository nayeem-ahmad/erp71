# Self-hosted fonts

The app's three typefaces, served from here through `next/font/local` in
`../layout.tsx` rather than fetched from Google Fonts at build time. The
Google loader failed builds whenever Google's CSS answered with a font URL
that had no file extension (`@next/font/dist/google/loader.js`).

| File | Family | Subset | Weights |
|---|---|---|---|
| `inter-latin-wght-normal.woff2` | Inter (variable) | latin | 100–900 |
| `noto-sans-bengali-bengali-{400,500,600,700}-normal.woff2` | Noto Sans Bengali | bengali | 400–700 |
| `noto-sans-arabic-arabic-{400,500,600,700}-normal.woff2` | Noto Sans Arabic | arabic | 400–700 |

Taken unchanged from the Fontsource npm packages `@fontsource-variable/inter`,
`@fontsource/noto-sans-bengali` and `@fontsource/noto-sans-arabic`, version
5.3.0, which repackage the Google Fonts files. The `unicode-range` in
`layout.tsx` for each family is the subset's range from those packages' CSS.

All three are under the SIL Open Font License 1.1; the licence for each is in
the matching `OFL-*.txt`.
