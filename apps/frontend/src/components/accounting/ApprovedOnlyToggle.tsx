'use client';

import { useI18n } from '@/lib/i18n';

export type ApprovedOnlyToggleProps = {
    checked: boolean;
    onChange: (approvedOnly: boolean) => void;
    /**
     * Whether the tenant requires voucher approval at all. When it doesn't,
     * every voucher is already APPROVED and the toggle can only ever be a no-op,
     * so it renders nothing rather than offering a control with no effect.
     */
    enabled: boolean;
};

/**
 * Per-report override of the tenant's approved-only setting. Sends
 * `approvedOnly` on the report request rather than filtering the response —
 * unapproved vouchers are excluded by the server or not at all.
 */
export function ApprovedOnlyToggle({ checked, onChange, enabled }: ApprovedOnlyToggleProps) {
    const { t } = useI18n();

    if (!enabled) {
        return null;
    }

    return (
        <label className="inline-flex w-fit items-center gap-1.5 text-sm text-gray-700 cursor-pointer">
            <input
                type="checkbox"
                checked={checked}
                onChange={(event) => onChange(event.target.checked)}
                className="text-blue-600"
            />
            {t.accountingShared.approvedOnly}
        </label>
    );
}

export default ApprovedOnlyToggle;
