'use client';

import FeedbackWidget from '@/components/FeedbackWidget';

/** Bottom-right feedback entry point. */
export default function FloatingAssistDock() {
    return (
        <div className="fixed bottom-safe right-safe z-50">
            <FeedbackWidget />
        </div>
    );
}