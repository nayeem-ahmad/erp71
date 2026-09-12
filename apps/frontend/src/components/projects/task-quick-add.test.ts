import { parseQuickAdd, type QuickAddVocabulary } from './task-quick-add';

const vocab = (over: Partial<QuickAddVocabulary> = {}): QuickAddVocabulary => ({
    labels: [
        { id: 'l1', name: 'Bug' },
        { id: 'l2', name: 'Client waiting' },
    ],
    assignees: [
        { key: 'user:u1', name: 'Rafi Ahmed' },
        { key: 'user:u2', name: 'Karim Uddin' },
        { key: 'employee:e1', name: 'Shanto' },
    ],
    locale: 'en-GB',
    today: 'today',
    tomorrow: 'tomorrow',
    // A Wednesday, so "friday" is two days out and "wednesday" is a week.
    now: new Date(2026, 8, 9, 10, 0, 0),
    ...over,
});

describe('parseQuickAdd', () => {
    it('takes a bare line as the whole title', () => {
        expect(parseQuickAdd('Wire the meter', vocab())).toMatchObject({
            title: 'Wire the meter',
            applied: [],
        });
    });

    it('pulls every token out of one line', () => {
        const result = parseQuickAdd('Fix the invoice footer @rafi #bug !high ~3h >friday', vocab());

        expect(result).toMatchObject({
            title: 'Fix the invoice footer',
            assigneeId: 'u1',
            labelIds: ['l1'],
            priority: 'HIGH',
            estimateHours: 3,
            dueDate: '2026-09-11',
        });
    });

    it('reads tokens wherever they appear, not only at the end', () => {
        expect(parseQuickAdd('!urgent Rewire @karim the board', vocab())).toMatchObject({
            title: 'Rewire the board',
            priority: 'URGENT',
            assigneeId: 'u2',
        });
    });

    /** The rule the whole module is built around. */
    describe('never swallows what it cannot resolve', () => {
        it('keeps an address that is nobody on the project', () => {
            const result = parseQuickAdd('Email @bkash about the refund', vocab());

            expect(result.title).toBe('Email @bkash about the refund');
            expect(result.assigneeId).toBeUndefined();
            expect(result.applied).toEqual([]);
        });

        it('keeps a hex colour that is not a label', () => {
            const result = parseQuickAdd('Header should be #f3f4f6', vocab());

            expect(result.title).toBe('Header should be #f3f4f6');
            expect(result.labelIds).toBeUndefined();
        });

        it('keeps a bare sigil', () => {
            expect(parseQuickAdd('Compare a > b and c ~ d', vocab()).title).toBe(
                'Compare a > b and c ~ d',
            );
        });

        it('keeps an exclamation that is not a priority', () => {
            expect(parseQuickAdd('Ship it !now', vocab()).title).toBe('Ship it !now');
        });

        it('leaves an email address alone — it does not start with the sigil', () => {
            expect(parseQuickAdd('Mail nayeem@gmail.com back', vocab()).title).toBe(
                'Mail nayeem@gmail.com back',
            );
        });

        it('refuses an ambiguous prefix rather than picking one', () => {
            const two = vocab({
                assignees: [
                    { key: 'user:u1', name: 'Rafi Ahmed' },
                    { key: 'user:u3', name: 'Rafi Hossain' },
                ],
            });
            const result = parseQuickAdd('Check the meter @rafi', two);

            expect(result.assigneeId).toBeUndefined();
            expect(result.title).toBe('Check the meter @rafi');
        });

        it('still resolves an exact name that is also a prefix of another', () => {
            const two = vocab({
                assignees: [
                    { key: 'user:u1', name: 'Rafi' },
                    { key: 'user:u3', name: 'Rafi Hossain' },
                ],
            });

            expect(parseQuickAdd('Check it @rafi', two)).toMatchObject({
                assigneeId: 'u1',
                title: 'Check it',
            });
        });
    });

    describe('assignees', () => {
        it('matches a label whose name has a space', () => {
            expect(parseQuickAdd('Chase it #clientwaiting', vocab())).toMatchObject({
                title: 'Chase it',
                labelIds: ['l2'],
            });
        });

        it('puts a login-less employee on the employee column', () => {
            expect(parseQuickAdd('Site visit @shanto', vocab())).toMatchObject({
                assigneeEmployeeId: 'e1',
                assigneeId: undefined,
            });
        });

        it('lets a later mention win rather than holding both columns', () => {
            const result = parseQuickAdd('Job @shanto @rafi', vocab());

            expect(result.assigneeId).toBe('u1');
            expect(result.assigneeEmployeeId).toBeUndefined();
        });

        it('collects several labels and never repeats one', () => {
            expect(parseQuickAdd('Job #bug #clientwaiting #bug', vocab()).labelIds).toEqual([
                'l1',
                'l2',
            ]);
        });
    });

    describe('priority', () => {
        it.each([
            ['!low', 'LOW'],
            ['!MEDIUM', 'MEDIUM'],
            ['!high', 'HIGH'],
            ['!u', 'URGENT'],
        ])('reads %s as %s', (token, expected) => {
            expect(parseQuickAdd(`Job ${token}`, vocab()).priority).toBe(expected);
        });

        it('refuses an initial that fits more than one', () => {
            // No priority starts with "x"; and nothing ambiguous should resolve.
            expect(parseQuickAdd('Job !x', vocab()).title).toBe('Job !x');
        });
    });

    describe('estimate', () => {
        it.each([
            ['~3', 3],
            ['~3h', 3],
            ['~1.5h', 1.5],
            ['~90m', 1.5],
        ])('reads %s as %s hours', (token, expected) => {
            expect(parseQuickAdd(`Job ${token}`, vocab()).estimateHours).toBe(expected);
        });

        it('refuses a zero or a negative', () => {
            expect(parseQuickAdd('Job ~0', vocab()).estimateHours).toBeUndefined();
            expect(parseQuickAdd('Job ~-2', vocab()).title).toBe('Job ~-2');
        });

        it('refuses a figure the API would reject anyway', () => {
            expect(parseQuickAdd('Job ~10000', vocab()).estimateHours).toBeUndefined();
        });
    });

    describe('due date', () => {
        it('takes an ISO date as given', () => {
            expect(parseQuickAdd('Job >2026-12-01', vocab()).dueDate).toBe('2026-12-01');
        });

        it('reads today and tomorrow', () => {
            expect(parseQuickAdd('Job >today', vocab()).dueDate).toBe('2026-09-09');
            expect(parseQuickAdd('Job >tomorrow', vocab()).dueDate).toBe('2026-09-10');
        });

        it('reads a day count', () => {
            expect(parseQuickAdd('Job >5d', vocab()).dueDate).toBe('2026-09-14');
        });

        // Never today: "due Wednesday" said on a Wednesday means next Wednesday.
        it('takes the next occurrence of a weekday, never the current day', () => {
            expect(parseQuickAdd('Job >wednesday', vocab()).dueDate).toBe('2026-09-16');
            expect(parseQuickAdd('Job >fri', vocab()).dueDate).toBe('2026-09-11');
        });

        /**
         * Weekday names are generated from the locale rather than listed, so the
         * grammar follows the nine catalogues without a table to keep in step.
         */
        it('reads a weekday in the active locale', () => {
            const de = vocab({ locale: 'de-DE', today: 'heute', tomorrow: 'morgen' });

            expect(parseQuickAdd('Job >freitag', de).dueDate).toBe('2026-09-11');
            expect(parseQuickAdd('Job >morgen', de).dueDate).toBe('2026-09-10');
        });

        it('refuses a date that is not one', () => {
            expect(parseQuickAdd('Job >2026-13-45', vocab()).title).toBe('Job >2026-13-45');
            expect(parseQuickAdd('Job >someday', vocab()).title).toBe('Job >someday');
        });
    });

    it('reports what it applied so the composer can say so', () => {
        expect(parseQuickAdd('Job @rafi !high', vocab()).applied).toEqual(['@rafi', '!high']);
    });

    it('collapses the whitespace a removed token leaves behind', () => {
        expect(parseQuickAdd('  Wire   @rafi   the meter  ', vocab()).title).toBe(
            'Wire the meter',
        );
    });

    it('leaves an empty title empty rather than inventing one', () => {
        expect(parseQuickAdd('@rafi !high', vocab())).toMatchObject({
            title: '',
            assigneeId: 'u1',
        });
    });
});
