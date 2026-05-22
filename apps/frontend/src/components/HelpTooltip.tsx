'use client';
import { useState } from 'react';
import { HelpCircle } from 'lucide-react';

interface HelpTooltipProps {
  text: string;
  side?: 'top' | 'right' | 'bottom' | 'left';
}

const sideClasses: Record<NonNullable<HelpTooltipProps['side']>, string> = {
  top: 'bottom-full left-1/2 -translate-x-1/2 mb-2',
  bottom: 'top-full left-1/2 -translate-x-1/2 mt-2',
  left: 'right-full top-1/2 -translate-y-1/2 mr-2',
  right: 'left-full top-1/2 -translate-y-1/2 ml-2',
};

export function HelpTooltip({ text, side = 'top' }: HelpTooltipProps) {
  const [visible, setVisible] = useState(false);

  return (
    <span className="relative inline-flex items-center">
      <button
        type="button"
        aria-label="Help"
        className="inline-flex items-center justify-center focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 rounded-full"
        onMouseEnter={() => setVisible(true)}
        onMouseLeave={() => setVisible(false)}
        onFocus={() => setVisible(true)}
        onBlur={() => setVisible(false)}
      >
        <HelpCircle
          size={14}
          className="text-gray-400 hover:text-gray-600 transition-colors"
        />
      </button>
      {visible && (
        <span
          role="tooltip"
          className={`absolute ${sideClasses[side]} z-50 w-max max-w-xs rounded-lg bg-gray-900 px-3 py-2 text-sm text-white shadow-lg pointer-events-none`}
        >
          {text}
        </span>
      )}
    </span>
  );
}
