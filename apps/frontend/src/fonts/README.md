# App fonts

Self-hosted so `next build` does not fetch `fonts.googleapis.com`. A Google
Fonts hiccup used to fail CI and the VPS image with
`Cannot read properties of null (reading '1')` in `@next/font/google`.

| File | Face | Package |
| --- | --- | --- |
| `inter-latin-wght-normal.woff2` | Inter, latin, variable `wght` | `@fontsource-variable/inter@5.2.8` |
| `noto-sans-bengali-wght-normal.woff2` | Noto Sans Bengali, bengali, variable `wght` | `@fontsource-variable/noto-sans-bengali@5.2.8` |
| `noto-sans-arabic-wght-normal.woff2` | Noto Sans Arabic, arabic, variable `wght` | `@fontsource-variable/noto-sans-arabic@5.2.10` |

Each face is SIL Open Font License 1.1 (`OFL-*.txt` in this folder).
