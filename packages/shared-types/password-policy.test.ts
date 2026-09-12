import {
  DEFAULT_PASSWORD_POLICY,
  PASSWORD_MAX_MIN_LENGTH,
  PASSWORD_MIN_LENGTH_FLOOR,
  describePasswordPolicy,
  evaluatePassword,
  normalizePasswordPolicy,
  strictestPasswordPolicy,
  type PasswordPolicy,
} from './password-policy';

const policy = (overrides: Partial<PasswordPolicy> = {}): PasswordPolicy => ({
  ...DEFAULT_PASSWORD_POLICY,
  ...overrides,
});

describe('normalizePasswordPolicy', () => {
  it('falls back to the default policy for a missing row', () => {
    expect(normalizePasswordPolicy(null)).toEqual(DEFAULT_PASSWORD_POLICY);
    expect(normalizePasswordPolicy(undefined)).toEqual(DEFAULT_PASSWORD_POLICY);
  });

  it('never lets a tenant go below the platform floor', () => {
    expect(normalizePasswordPolicy({ min_length: 4 }).min_length).toBe(PASSWORD_MIN_LENGTH_FLOOR);
    expect(normalizePasswordPolicy({ min_length: 0 }).min_length).toBe(PASSWORD_MIN_LENGTH_FLOOR);
    expect(normalizePasswordPolicy({ min_length: -20 }).min_length).toBe(PASSWORD_MIN_LENGTH_FLOOR);
  });

  it('caps a minimum nobody could satisfy', () => {
    expect(normalizePasswordPolicy({ min_length: 500 }).min_length).toBe(PASSWORD_MAX_MIN_LENGTH);
  });

  it('ignores a non-numeric length rather than producing NaN', () => {
    expect(normalizePasswordPolicy({ min_length: 'twelve' as never }).min_length).toBe(
      DEFAULT_PASSWORD_POLICY.min_length,
    );
  });
});

describe('evaluatePassword', () => {
  it('accepts an eight-character password under the default policy', () => {
    expect(evaluatePassword('correct-horse', DEFAULT_PASSWORD_POLICY).valid).toBe(true);
  });

  it('rejects one below the minimum and names the rule', () => {
    const result = evaluatePassword('short1', DEFAULT_PASSWORD_POLICY);
    expect(result.valid).toBe(false);
    expect(result.failed).toContain('minLength');
  });

  it('only returns rules the policy turns on', () => {
    const result = evaluatePassword('anything', policy({ block_common: false }));
    expect(result.rules.map((rule) => rule.id)).toEqual(['minLength']);
  });

  it('reports every failure at once rather than the first', () => {
    const result = evaluatePassword('abc', policy({ require_uppercase: true, require_number: true, require_symbol: true }));
    expect(result.failed).toEqual(['minLength', 'uppercase', 'number', 'symbol']);
  });

  it('checks each character class independently', () => {
    const strict = policy({
      require_uppercase: true,
      require_lowercase: true,
      require_number: true,
      require_symbol: true,
    });
    expect(evaluatePassword('Sadia#2026', strict).valid).toBe(true);
    expect(evaluatePassword('sadia#2026', strict).failed).toEqual(['uppercase']);
    expect(evaluatePassword('SADIA#2026', strict).failed).toEqual(['lowercase']);
    expect(evaluatePassword('SadiaRahman#', strict).failed).toEqual(['number']);
    expect(evaluatePassword('SadiaRahman2026', strict).failed).toEqual(['symbol']);
  });

  it('counts a non-Latin script as satisfying the letter classes', () => {
    // A Bangla password has no case, so a workspace demanding upper and lower
    // case is telling its members to type Latin — worth knowing, and the reason
    // the settings page says so rather than the evaluator quietly excusing it.
    const result = evaluatePassword('সাদিয়া২০২৬', policy({ require_number: true }));
    expect(result.valid).toBe(true);
  });

  it('counts code points, so an emoji is one character', () => {
    expect(evaluatePassword('ab🔐🔐🔐🔐🔐🔐', policy({ block_common: false })).valid).toBe(true);
    expect(evaluatePassword('ab🔐🔐🔐🔐🔐', policy({ block_common: false })).failed).toEqual(['minLength']);
  });

  it('treats punctuation outside ASCII as a symbol', () => {
    expect(evaluatePassword('sadia—rahman', policy({ require_symbol: true })).valid).toBe(true);
  });

  it('blocks a common password, and the variants that pay off the class rules', () => {
    const strict = policy({ require_uppercase: true, require_number: true });
    expect(evaluatePassword('Password1', strict).failed).toEqual(['common']);
    expect(evaluatePassword('Password123!', strict).failed).toEqual(['common']);
    expect(evaluatePassword('BISMILLAH786', strict).failed).toEqual(['common']);
  });

  it('lets a workspace turn the common-password list off', () => {
    expect(evaluatePassword('password1', policy({ block_common: false })).valid).toBe(true);
  });

  it('does not mistake a passphrase that merely contains a common word', () => {
    expect(evaluatePassword('my-password-for-erp', DEFAULT_PASSWORD_POLICY).valid).toBe(true);
  });

  it('treats a missing password as failing rather than throwing', () => {
    expect(evaluatePassword(undefined as never, DEFAULT_PASSWORD_POLICY).valid).toBe(false);
  });
});

describe('strictestPasswordPolicy', () => {
  it('takes the widest minimum and the union of the switches', () => {
    expect(
      strictestPasswordPolicy([
        policy({ min_length: 10, require_uppercase: true, block_common: false }),
        policy({ min_length: 14, require_symbol: true, block_common: false }),
      ]),
    ).toEqual({
      min_length: 14,
      require_uppercase: true,
      require_lowercase: false,
      require_number: false,
      require_symbol: true,
      block_common: false,
    });
  });

  it('falls back to the default for someone in no workspace', () => {
    expect(strictestPasswordPolicy([])).toEqual(DEFAULT_PASSWORD_POLICY);
  });
});

describe('describePasswordPolicy', () => {
  it('reads as a sentence with one requirement', () => {
    expect(describePasswordPolicy(policy({ block_common: false }))).toBe(
      'Password must contain at least 8 characters.',
    );
  });

  it('reads as a sentence with several', () => {
    expect(
      describePasswordPolicy(
        policy({ min_length: 12, require_uppercase: true, require_number: true, block_common: false }),
      ),
    ).toBe('Password must contain at least 12 characters, an uppercase letter and a number.');
  });

  it('mentions the common-password list when it is on', () => {
    expect(describePasswordPolicy(DEFAULT_PASSWORD_POLICY)).toBe(
      'Password must contain at least 8 characters. It must not be a commonly used password.',
    );
  });
});
