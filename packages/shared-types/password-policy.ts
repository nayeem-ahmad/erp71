/**
 * Per-tenant password complexity policy.
 *
 * One definition, evaluated in two places: the backend rejects a password that
 * fails it, and the frontend renders the same rules as a live checklist while
 * someone types. Keeping the evaluator here — rather than a regex on each side —
 * is what stops the two from drifting into a form that shows a tick beside a
 * rule the API is about to reject.
 *
 * The policy is stored as columns on `Tenant` and edited by a tenant admin at
 * Settings › Password Policy. It applies wherever a *workspace member* sets a
 * password: changing it, resetting it through an emailed link, or claiming an
 * invitation. It deliberately does not apply to storefront shoppers or job
 * applicants, who are not staff and whose accounts a workspace admin does not
 * administer.
 */

export interface PasswordPolicy {
  /** Never below `PASSWORD_MIN_LENGTH_FLOOR`; see `normalizePasswordPolicy`. */
  min_length: number;
  require_uppercase: boolean;
  require_lowercase: boolean;
  require_number: boolean;
  require_symbol: boolean;
  /** Reject passwords on the embedded most-breached list, e.g. `password1`. */
  block_common: boolean;
}

/**
 * The platform floor. A tenant admin may tighten the policy but never loosen it
 * past this, so the guarantee the product has always made — eight characters —
 * holds for every workspace whatever an admin does to the form.
 */
export const PASSWORD_MIN_LENGTH_FLOOR = 8;

/**
 * The most an admin may demand. Not a limit on what anyone may *type* — it caps
 * the configurable minimum so a slipped keystroke in the settings form cannot
 * leave a workspace where no password is acceptable. bcrypt stops reading at 72
 * bytes, so a minimum anywhere near that is already past the point of adding
 * strength.
 */
export const PASSWORD_MAX_MIN_LENGTH = 64;

/**
 * What every workspace gets until an admin says otherwise: the eight-character
 * rule the product already enforced, plus the common-password list.
 *
 * Only the list is new, and it is on by default on purpose — `password123`
 * clears every character-class rule anyone would think to set, and a member who
 * is told why it was refused is being helped rather than obstructed. It never
 * affects signing in, only choosing a new password.
 */
export const DEFAULT_PASSWORD_POLICY: PasswordPolicy = {
  min_length: PASSWORD_MIN_LENGTH_FLOOR,
  require_uppercase: false,
  require_lowercase: false,
  require_number: false,
  require_symbol: false,
  block_common: true,
};

export const PASSWORD_RULE_IDS = [
  'minLength',
  'uppercase',
  'lowercase',
  'number',
  'symbol',
  'common',
] as const;

export type PasswordRuleId = (typeof PASSWORD_RULE_IDS)[number];

export interface PasswordRuleResult {
  id: PasswordRuleId;
  /** Whether the candidate satisfies this rule. */
  ok: boolean;
  /** Only set for `minLength`, so a caller can render the number it demands. */
  minLength?: number;
}

export interface PasswordEvaluation {
  valid: boolean;
  /** Every rule the policy turns on, in a stable order for rendering. */
  rules: PasswordRuleResult[];
  failed: PasswordRuleId[];
}

/**
 * Anything that is not a letter, a digit or whitespace counts as a symbol.
 *
 * Defined by exclusion rather than as a list of punctuation, so a password
 * someone types on a Bangla or Arabic keyboard is judged by the same rule as one
 * typed on a US layout.
 */
const SYMBOL_PATTERN = /[^\p{L}\p{N}\s]/u;
const UPPERCASE_PATTERN = /\p{Lu}/u;
const LOWERCASE_PATTERN = /\p{Ll}/u;
const NUMBER_PATTERN = /\p{N}/u;

/**
 * The passwords that turn up first in every credential-stuffing list, plus the
 * keyboard walks and the ones this product invites by name (`erp71`, `bismillah`,
 * `dhaka`). Short entries are kept even though the eight-character floor already
 * rejects them, because `block_common` also matches a padded variant below.
 *
 * Not a dictionary — a dictionary belongs behind a service, and shipping one in
 * a browser bundle is not an option. This is the cheap half of the win.
 */
const COMMON_PASSWORDS: readonly string[] = [
  '123456', '123456789', '12345678', '1234567890', '1234567', '12345',
  'password', 'password1', 'password123', 'passw0rd', 'p@ssw0rd', 'p@ssword',
  'qwerty', 'qwerty123', 'qwertyuiop', 'asdfghjkl', 'zxcvbnm', '1q2w3e4r',
  '1qaz2wsx', 'qazwsx', 'qwe123', 'abc123', 'abcd1234', 'a1b2c3d4',
  'iloveyou', 'admin', 'admin123', 'administrator', 'root', 'root123',
  'welcome', 'welcome1', 'welcome123', 'letmein', 'login', 'guest',
  'monkey', 'dragon', 'sunshine', 'princess', 'football', 'baseball',
  'superman', 'batman', 'master', 'shadow', 'michael', 'jordan',
  'trustno1', 'whatever', 'starwars', 'computer', 'internet', 'samsung',
  'google', 'facebook', 'myspace1', 'secret', 'freedom', 'charlie',
  'test123', 'testing', 'test1234', 'temp1234', 'changeme', 'default',
  'pakistan', 'bangladesh', 'dhaka', 'chittagong', 'bismillah', 'allah',
  'erp71', 'erp123', 'company', 'business', 'office123', 'shop123',
  '11111111', '00000000', '121212', '123123', '112233', '654321',
  'aaaaaa', 'asdfgh', 'zaq12wsx', 'qwerty1', 'pass1234', 'user1234',
];

const COMMON_PASSWORD_SET = new Set(COMMON_PASSWORDS);

/**
 * Whether a candidate is one of the common passwords, or one wearing a hat.
 *
 * Bare membership would catch `password` and miss `Password1!`, which is the
 * same password with the character-class rules paid off. So the check also
 * strips a leading capital, trailing digits and trailing punctuation before
 * looking again — the three things people actually add when a form tells them
 * their password is not complex enough.
 */
function isCommonPassword(password: string): boolean {
  const lower = password.toLowerCase();
  if (COMMON_PASSWORD_SET.has(lower)) return true;

  const stripped = lower.replace(/[^a-z]+$/, '');
  return stripped.length > 0 && COMMON_PASSWORD_SET.has(stripped);
}

/**
 * Fold whatever is stored — or posted — into a policy the evaluator can trust.
 *
 * Clamps `min_length` into `[PASSWORD_MIN_LENGTH_FLOOR, PASSWORD_MAX_MIN_LENGTH]`
 * rather than rejecting it, so a row written before a floor changed still
 * evaluates, and coerces every switch to a boolean. Called on read and on write,
 * which is why nothing downstream has to re-check the bounds.
 */
export function normalizePasswordPolicy(
  raw: Partial<PasswordPolicy> | null | undefined,
): PasswordPolicy {
  const requested = Number(raw?.min_length);
  const minLength = Number.isFinite(requested)
    ? Math.min(Math.max(Math.trunc(requested), PASSWORD_MIN_LENGTH_FLOOR), PASSWORD_MAX_MIN_LENGTH)
    : DEFAULT_PASSWORD_POLICY.min_length;

  return {
    min_length: minLength,
    require_uppercase: raw?.require_uppercase ?? DEFAULT_PASSWORD_POLICY.require_uppercase,
    require_lowercase: raw?.require_lowercase ?? DEFAULT_PASSWORD_POLICY.require_lowercase,
    require_number: raw?.require_number ?? DEFAULT_PASSWORD_POLICY.require_number,
    require_symbol: raw?.require_symbol ?? DEFAULT_PASSWORD_POLICY.require_symbol,
    block_common: raw?.block_common ?? DEFAULT_PASSWORD_POLICY.block_common,
  };
}

/**
 * Check a candidate against a policy, returning every rule rather than the first
 * failure. A form that can only say "too short" makes someone submit four times
 * to discover four rules; the checklist this feeds shows all of them at once.
 */
export function evaluatePassword(
  password: string,
  policy: Partial<PasswordPolicy> | null | undefined = DEFAULT_PASSWORD_POLICY,
): PasswordEvaluation {
  const resolved = normalizePasswordPolicy(policy);
  const candidate = password ?? '';
  const rules: PasswordRuleResult[] = [
    {
      id: 'minLength',
      // Count code points, not UTF-16 units: an emoji is one character to the
      // person who typed it, and `.length` would score it as two.
      ok: [...candidate].length >= resolved.min_length,
      minLength: resolved.min_length,
    },
  ];

  if (resolved.require_uppercase) {
    rules.push({ id: 'uppercase', ok: UPPERCASE_PATTERN.test(candidate) });
  }
  if (resolved.require_lowercase) {
    rules.push({ id: 'lowercase', ok: LOWERCASE_PATTERN.test(candidate) });
  }
  if (resolved.require_number) {
    rules.push({ id: 'number', ok: NUMBER_PATTERN.test(candidate) });
  }
  if (resolved.require_symbol) {
    rules.push({ id: 'symbol', ok: SYMBOL_PATTERN.test(candidate) });
  }
  if (resolved.block_common) {
    rules.push({ id: 'common', ok: !isCommonPassword(candidate) });
  }

  const failed = rules.filter((rule) => !rule.ok).map((rule) => rule.id);
  return { valid: failed.length === 0, rules, failed };
}

/**
 * The strictest single policy satisfying all of them.
 *
 * One person can be a member of several workspaces and has one password for all
 * of them, so "which tenant's policy applies" has no answer — the union does.
 * Taking the widest minimum and the OR of every switch means a password accepted
 * anywhere is acceptable everywhere, which is the only reading under which a
 * strict workspace's policy actually holds.
 */
export function strictestPasswordPolicy(
  policies: (Partial<PasswordPolicy> | null | undefined)[],
): PasswordPolicy {
  const resolved = policies.map(normalizePasswordPolicy);
  if (resolved.length === 0) return { ...DEFAULT_PASSWORD_POLICY };

  return resolved.reduce((strictest, policy) => ({
    min_length: Math.max(strictest.min_length, policy.min_length),
    require_uppercase: strictest.require_uppercase || policy.require_uppercase,
    require_lowercase: strictest.require_lowercase || policy.require_lowercase,
    require_number: strictest.require_number || policy.require_number,
    require_symbol: strictest.require_symbol || policy.require_symbol,
    block_common: strictest.block_common || policy.block_common,
  }));
}

/**
 * The policy as one English sentence, for the backend's rejection message.
 *
 * The frontend renders its own localized checklist from `evaluatePassword` and
 * never shows this; it is what an API client, a curl request or a log line gets,
 * so it has to be readable on its own.
 */
export function describePasswordPolicy(policy: Partial<PasswordPolicy> | null | undefined): string {
  const resolved = normalizePasswordPolicy(policy);
  const clauses = [`at least ${resolved.min_length} characters`];
  if (resolved.require_uppercase) clauses.push('an uppercase letter');
  if (resolved.require_lowercase) clauses.push('a lowercase letter');
  if (resolved.require_number) clauses.push('a number');
  if (resolved.require_symbol) clauses.push('a symbol');

  const requirement =
    clauses.length === 1
      ? clauses[0]
      : `${clauses.slice(0, -1).join(', ')} and ${clauses[clauses.length - 1]}`;

  const sentence = `Password must contain ${requirement}.`;
  return resolved.block_common
    ? `${sentence} It must not be a commonly used password.`
    : sentence;
}
