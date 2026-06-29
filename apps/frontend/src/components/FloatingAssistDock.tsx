'use client';

import FeedbackWidget from '@/components/FeedbackWidget';
import VoiceNavWidget from '@/components/VoiceNavWidget';

/** Bottom-right dock: voice navigation above feedback. */
export default function FloatingAssistDock() {
    return (
        <div className="fixed bottom-5 right-5 z-[60] flex flex-col items-end gap-3">
            <VoiceNavWidget />
            <FeedbackWidget />
        </div>
    );
}