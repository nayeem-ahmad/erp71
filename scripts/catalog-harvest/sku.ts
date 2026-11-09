/** Uppercase `[A-Z0-9]+` tokens joined by single hyphens. Empty input → `''`. */
export function slug(input: string): string {
  return input.toUpperCase().match(/[A-Z0-9]+/g)?.join('-') ?? '';
}

/** `slug(brand)-slug(model)` with no leading hyphen when brand is missing/empty. */
export function productSku(brand: string | null | undefined, model: string): string {
  return [slug(brand ?? ''), slug(model)].filter(Boolean).join('-');
}

/**
 * Clip `base` to `maxLength` first. On collision append `-2`, `-3`, …,
 * clipping the stem so the whole string stays ≤ `maxLength`. Adds the winner to `taken`.
 */
export function uniqueSku(base: string, taken: Set<string>, maxLength = 64): string {
  const clipped = base.slice(0, maxLength);
  if (!taken.has(clipped)) {
    taken.add(clipped);
    return clipped;
  }

  let n = 2;
  while (true) {
    const suffix = `-${n}`;
    const stem = clipped.slice(0, Math.max(0, maxLength - suffix.length));
    const candidate = `${stem}-${n}`;
    if (!taken.has(candidate)) {
      taken.add(candidate);
      return candidate;
    }
    n += 1;
  }
}
