import {
    accruedDays,
    buildLeaveCalendar,
    carryForwardDays,
    needsFurtherApproval,
    round,
    validateLeaveRequest,
    type LeaveTypePolicy,
} from './leave-policy.util';

const policy = (over: Partial<LeaveTypePolicy> = {}): LeaveTypePolicy => ({
    days_per_year: 12,
    accrual_mode: 'ANNUAL_GRANT',
    carry_forward_max_days: null,
    allows_half_day: true,
    requires_attachment: false,
    approval_levels: 1,
    ...over,
});

describe('leave-policy.util', () => {
    describe('accruedDays', () => {
        it('grants the whole year up front under ANNUAL_GRANT', () => {
            expect(accruedDays(policy(), 1)).toBe(12);
        });

        it('accrues a twelfth per completed month under MONTHLY_ACCRUAL', () => {
            // The rule that stops a January joiner taking a full year's leave
            // in February.
            const monthly = policy({ accrual_mode: 'MONTHLY_ACCRUAL' });
            expect(accruedDays(monthly, 1)).toBe(1);
            expect(accruedDays(monthly, 6)).toBe(6);
            expect(accruedDays(monthly, 12)).toBe(12);
        });

        it('starts accruing from the joining month', () => {
            const monthly = policy({ accrual_mode: 'MONTHLY_ACCRUAL' });
            // Joined in July, asking in December: six months.
            expect(accruedDays(monthly, 12, 7)).toBe(6);
        });

        it('accrues nothing before the joining month', () => {
            const monthly = policy({ accrual_mode: 'MONTHLY_ACCRUAL' });
            expect(accruedDays(monthly, 3, 7)).toBe(0);
        });

        it('never exceeds the annual entitlement', () => {
            const monthly = policy({ accrual_mode: 'MONTHLY_ACCRUAL' });
            expect(accruedDays(monthly, 99)).toBe(12);
        });

        it('rounds to a half day', () => {
            const monthly = policy({ days_per_year: 10, accrual_mode: 'MONTHLY_ACCRUAL' });
            // 10/12 × 4 = 3.33 → 3.5
            expect(accruedDays(monthly, 4)).toBe(3.5);
        });
    });

    describe('carryForwardDays', () => {
        it('carries nothing when no cap is set', () => {
            // The safe default, not the generous one.
            expect(carryForwardDays(policy(), 12, 3)).toBe(0);
        });

        it('carries the unused balance up to the cap', () => {
            expect(carryForwardDays(policy({ carry_forward_max_days: 5 }), 12, 3)).toBe(5);
            expect(carryForwardDays(policy({ carry_forward_max_days: 5 }), 12, 9)).toBe(3);
        });

        it('carries nothing when the balance is spent', () => {
            expect(carryForwardDays(policy({ carry_forward_max_days: 5 }), 12, 12)).toBe(0);
        });

        it('never carries a negative balance', () => {
            // Over-taken leave is a payroll question, not a carry-forward one.
            expect(carryForwardDays(policy({ carry_forward_max_days: 5 }), 12, 15)).toBe(0);
        });

        it('treats a zero cap as no carry-forward', () => {
            expect(carryForwardDays(policy({ carry_forward_max_days: 0 }), 12, 0)).toBe(0);
        });
    });

    describe('validateLeaveRequest', () => {
        const input = (over = {}) => ({ days: 2, remainingDays: 10, hasAttachment: false, ...over });

        it('accepts a request within balance', () => {
            expect(validateLeaveRequest(policy(), input())).toEqual([]);
        });

        it('rejects a non-positive request', () => {
            expect(validateLeaveRequest(policy(), input({ days: 0 }))).toContain('NOT_POSITIVE');
        });

        it('rejects more days than remain', () => {
            expect(validateLeaveRequest(policy(), input({ days: 20 })))
                .toContain('INSUFFICIENT_BALANCE');
        });

        it('allows a half day when the type permits it', () => {
            expect(validateLeaveRequest(policy(), input({ days: 0.5 }))).toEqual([]);
        });

        it('rejects a half day when the type forbids it', () => {
            expect(validateLeaveRequest(policy({ allows_half_day: false }), input({ days: 0.5 })))
                .toContain('HALF_DAY_NOT_ALLOWED');
        });

        it('requires an attachment when the type demands one', () => {
            expect(validateLeaveRequest(policy({ requires_attachment: true }), input()))
                .toContain('ATTACHMENT_REQUIRED');
        });

        it('accepts once the attachment is there', () => {
            expect(validateLeaveRequest(
                policy({ requires_attachment: true }),
                input({ hasAttachment: true }),
            )).toEqual([]);
        });

        it('reports every reason at once', () => {
            // So a form shows all of them rather than making the employee
            // resubmit to discover the next one.
            const errors = validateLeaveRequest(
                policy({ allows_half_day: false, requires_attachment: true }),
                input({ days: 20.5, remainingDays: 2 }),
            );
            expect(errors).toEqual(expect.arrayContaining([
                'HALF_DAY_NOT_ALLOWED', 'INSUFFICIENT_BALANCE', 'ATTACHMENT_REQUIRED',
            ]));
        });
    });

    describe('needsFurtherApproval', () => {
        it('is done after one approval by default', () => {
            expect(needsFurtherApproval(policy(), 1)).toBe(false);
        });

        it('wants a second signature at two levels', () => {
            expect(needsFurtherApproval(policy({ approval_levels: 2 }), 1)).toBe(true);
            expect(needsFurtherApproval(policy({ approval_levels: 2 }), 2)).toBe(false);
        });

        it('treats a zero level count as one', () => {
            // Bad config must not make a request unapprovable.
            expect(needsFurtherApproval(policy({ approval_levels: 0 }), 1)).toBe(false);
        });
    });

    describe('buildLeaveCalendar', () => {
        const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

        it('expands a range into one entry per day', () => {
            const calendar = buildLeaveCalendar([{
                employeeId: 'e1', employeeName: 'Alice',
                startDate: d('2026-08-10'), endDate: d('2026-08-12'),
                status: 'APPROVED', leaveType: 'Annual',
            }], d('2026-08-01'), d('2026-08-31'));

            expect(Object.keys(calendar)).toEqual(['2026-08-10', '2026-08-11', '2026-08-12']);
            expect(calendar['2026-08-11'][0].employeeName).toBe('Alice');
        });

        it('puts two people off on the same day in one bucket', () => {
            const calendar = buildLeaveCalendar([
                { employeeId: 'e1', employeeName: 'Alice', startDate: d('2026-08-10'), endDate: d('2026-08-10'), status: 'APPROVED', leaveType: 'Annual' },
                { employeeId: 'e2', employeeName: 'Bob', startDate: d('2026-08-10'), endDate: d('2026-08-10'), status: 'APPROVED', leaveType: 'Sick' },
            ], d('2026-08-01'), d('2026-08-31'));

            expect(calendar['2026-08-10']).toHaveLength(2);
        });

        it('clips a range that starts before the window', () => {
            const calendar = buildLeaveCalendar([{
                employeeId: 'e1', employeeName: 'Alice',
                startDate: d('2026-07-28'), endDate: d('2026-08-02'),
                status: 'APPROVED', leaveType: 'Annual',
            }], d('2026-08-01'), d('2026-08-31'));

            expect(Object.keys(calendar)).toEqual(['2026-08-01', '2026-08-02']);
        });

        it('clips a range that ends after the window', () => {
            const calendar = buildLeaveCalendar([{
                employeeId: 'e1', employeeName: 'Alice',
                startDate: d('2026-08-30'), endDate: d('2026-09-05'),
                status: 'APPROVED', leaveType: 'Annual',
            }], d('2026-08-01'), d('2026-08-31'));

            expect(Object.keys(calendar)).toEqual(['2026-08-30', '2026-08-31']);
        });

        it('returns an empty calendar for no leave', () => {
            expect(buildLeaveCalendar([], d('2026-08-01'), d('2026-08-31'))).toEqual({});
        });
    });

    describe('round', () => {
        it('rounds to the nearest half day', () => {
            expect(round(1.24)).toBe(1);
            expect(round(1.25)).toBe(1.5);
            expect(round(1.75)).toBe(2);
        });
    });
});
