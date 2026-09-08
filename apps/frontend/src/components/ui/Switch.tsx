'use client';

import { forwardRef, type ButtonHTMLAttributes } from 'react';

export type SwitchProps = Omit<
    ButtonHTMLAttributes<HTMLButtonElement>,
    'type' | 'role' | 'onChange' | 'children'
> & {
    checked: boolean;
    onCheckedChange: (checked: boolean) => void;
    /** Required unless the switch sits inside a <label> that already names it. */
    'aria-label'?: string;
};

const TRACK =
    'relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50';
const KNOB =
    'pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out';

/**
 * Canonical on/off switch for a single boolean that saves immediately — see
 * docs/ui-design-guidelines.md §2.6. For a boolean that is submitted with a form,
 * use `Checkbox` instead: a switch that needs a Save button reads as already saved.
 *
 * A `<button role="switch">` rather than a styled checkbox, so the control keeps
 * its own accessible on/off state and stays reachable by keyboard. `aria-checked`
 * is what a screen reader announces; the colour is only for everyone else.
 */
export const Switch = forwardRef<HTMLButtonElement, SwitchProps>(function Switch(
    { checked, onCheckedChange, disabled, className = '', ...rest },
    ref,
) {
    return (
        <button
            ref={ref}
            type="button"
            role="switch"
            aria-checked={checked}
            disabled={disabled}
            onClick={() => onCheckedChange(!checked)}
            className={`${TRACK} ${checked ? 'bg-blue-600' : 'bg-gray-200'}${className ? ` ${className}` : ''}`}
            {...rest}
        >
            <span className={`${KNOB} ${checked ? 'translate-x-5' : 'translate-x-0'}`} />
        </button>
    );
});
