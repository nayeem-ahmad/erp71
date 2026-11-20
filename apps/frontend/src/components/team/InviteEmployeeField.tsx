'use client';

import { useEffect, useState } from 'react';
import { api, type EmployeeLinkCandidate } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { Field, Select } from '@/components/ui';

/**
 * "Which employee is this invitation for?" on the invite form.
 *
 * Optional, and offered only to someone who may link (MANAGE_HR on top of the
 * MANAGE_USERS inviting needs). The cards are re-ranked by the address being
 * invited once it is typed, so a card whose email matches rises to the top and
 * says so — but nothing is preselected: inviting someone is not a claim that
 * they are on the payroll.
 */
export default function InviteEmployeeField({
    email,
    value,
    onChange,
    reloadKey,
}: {
    /** The address in the invite form; ranks the cards once it looks complete. */
    email: string;
    value: string;
    onChange: (employeeId: string) => void;
    /** Bumped after an invite is sent, so a card just promised is not offered again. */
    reloadKey: number;
}) {
    const { t } = useI18n();
    const tl = t.employees.detail.linking;
    const [cards, setCards] = useState<EmployeeLinkCandidate[]>([]);

    const rankBy = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) ? email.trim() : '';

    useEffect(() => {
        const timer = setTimeout(() => {
            api.getEmployeeCandidates(rankBy ? { email: rankBy } : {})
                .then((rows) => setCards(rows ?? []))
                .catch(() => setCards([]));
        }, rankBy ? 300 : 0);
        return () => clearTimeout(timer);
    }, [rankBy, reloadKey]);

    if (cards.length === 0 && !value) return null;

    return (
        <Field label={tl.inviteEmployee} hint={tl.inviteEmployeeHint} htmlFor="invite-employee">
            <Select id="invite-employee" value={value} onChange={(e) => onChange(e.target.value)} className="w-full">
                <option value="">{tl.inviteNoEmployee}</option>
                {cards.map((card) => (
                    <option key={card.employeeId} value={card.employeeId}>
                        {card.name} · {card.employeeCode}
                        {card.matches.includes('email') ? ` — ${tl.matchEmail}` : ''}
                    </option>
                ))}
            </Select>
        </Field>
    );
}
