'use client';

import { Field, Select } from '@/components/ui';
import {
    paymentMethodDisplayName,
    type PaymentMethodOption,
    type PaymentMethodTypeLabels,
} from '@/lib/hooks/usePaymentMethodOptions';

interface PaymentMethodFieldProps {
    id: string;
    label: string;
    hint?: string;
    value: string;
    onChange: (name: string) => void;
    options: PaymentMethodOption[];
    typeLabels: PaymentMethodTypeLabels;
}

/**
 * "How did the money move?" for the customer and supplier payment forms — one
 * select over the tenant's payment methods. The value is the method's name,
 * which is what the backend resolves the posting account from.
 */
export default function PaymentMethodField({
    id,
    label,
    hint,
    value,
    onChange,
    options,
    typeLabels,
}: PaymentMethodFieldProps) {
    return (
        <Field label={label} htmlFor={id} hint={hint}>
            <Select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
                {options.map((option) => (
                    <option key={option.name} value={option.name}>
                        {paymentMethodDisplayName(option.name, typeLabels)}
                    </option>
                ))}
            </Select>
        </Field>
    );
}
