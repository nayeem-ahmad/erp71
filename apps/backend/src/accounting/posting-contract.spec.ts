import { DEFAULT_POSTING_RULES, DEFAULT_ACCOUNTING_TEMPLATE } from '@erp71/database';
import { POSTING_CONTRACT } from './posting-contract';

const PROVISIONED_ACCOUNT_NAMES = DEFAULT_ACCOUNTING_TEMPLATE.flatMap((group) =>
    group.subgroups.flatMap((subgroup) => subgroup.accounts.map((account) => account.name)),
);

const ruleKey = (eventType: string, conditionKey: string, conditionValue: string | null) =>
    `${eventType}|${conditionKey}|${conditionValue ?? 'null'}`;

describe('posting contract — callers vs default rules', () => {
    const ruleKeys = new Set(
        DEFAULT_POSTING_RULES.map((rule) =>
            ruleKey(rule.event_type, rule.condition_key, rule.condition_value),
        ),
    );

    describe('every tuple a caller emits is accounted for', () => {
        const expectRule = POSTING_CONTRACT.filter((entry) => entry.expectation === 'rule');

        it.each(expectRule)(
            '$eventType/$conditionKey/$conditionValue (from $emittedBy) resolves to a default rule',
            (entry) => {
                expect(
                    ruleKeys.has(ruleKey(entry.eventType, entry.conditionKey, entry.conditionValue)),
                ).toBe(true);
            },
        );
    });

    describe('tuples that must post nothing have no rule and no none-fallback', () => {
        const expectSkip = POSTING_CONTRACT.filter((entry) => entry.expectation === 'skip');

        it.each(expectSkip)(
            '$eventType/$conditionKey/$conditionValue (from $emittedBy) has no default rule',
            (entry) => {
                expect(
                    ruleKeys.has(ruleKey(entry.eventType, entry.conditionKey, entry.conditionValue)),
                ).toBe(false);
            },
        );

        // The real hazard: autoPostFromRules falls back to condition_key:'none'.
        // A none-rule for a skip event posts fiction rather than nothing.
        it.each([...new Set(expectSkip.map((entry) => entry.eventType))])(
            '%s has no condition_key:none fallback rule',
            (eventType) => {
                expect(ruleKeys.has(ruleKey(eventType, 'none', null))).toBe(false);
            },
        );
    });

    it('has no unreachable rules', () => {
        const emitted = new Set(
            POSTING_CONTRACT.map((entry) =>
                ruleKey(entry.eventType, entry.conditionKey, entry.conditionValue),
            ),
        );

        const unreachable = DEFAULT_POSTING_RULES.filter(
            (rule) => !emitted.has(ruleKey(rule.event_type, rule.condition_key, rule.condition_value)),
        ).map((rule) => ruleKey(rule.event_type, rule.condition_key, rule.condition_value));

        expect(unreachable).toEqual([]);
    });

    it('every rule references an account the template provisions', () => {
        // Guards against a rule naming an account that does not exist: the bootstrap
        // silently `continue`s on an unresolved name, so the rule would just never
        // be created and the event would skip.
        const provisioned = new Set(PROVISIONED_ACCOUNT_NAMES);

        for (const rule of DEFAULT_POSTING_RULES) {
            expect(provisioned).toContain(rule.debit_account);
            expect(provisioned).toContain(rule.credit_account);
        }
    });
});
