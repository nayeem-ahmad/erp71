'use client';

import dynamic from 'next/dynamic';

/*
 * The app layout's optional widgets, each fetched as its own chunk after the
 * page is up instead of riding in the layout's JavaScript.
 *
 * Every `(app)` page used to download all four, whether or not the person could
 * see them: the AI chat (its panel, history and speech input), voice
 * navigation (its phrase tables), the support composer and the time tracker's
 * form. Three of them hang on a premium plan or the projects module, which a
 * shop on the retail plan never has, and nobody opens feedback on the way to a
 * sale. The layout keeps deciding which of them to render; this file only
 * decides when their code arrives — and for a widget the layout never renders,
 * that is never.
 *
 * `ssr: false` throughout: the layout gates them on the plan and permissions
 * from `/auth/me`, which the server does not have, so there is nothing to
 * pre-render. Each header button gets a placeholder of its own size in the
 * meantime, so the header does not shift when it lands — the button is simply
 * not there to press for the moment it takes. The support dialog is only
 * rendered once its avatar-menu item is pressed, so its code arrives then.
 *
 * TimerChip is deliberately not here. It is the header's running clock and the
 * thing that asks the server whether a timer is running, so it should be on
 * screen with the header; it is small, and its helpers are the tracker's too.
 */

/** A header icon button's footprint (`min-h-touch min-w-touch`), empty. */
function HeaderButtonSlot() {
    return <span aria-hidden className="inline-flex min-h-touch min-w-touch" />;
}

export const AiChatWidget = dynamic(() => import('./AiChatWidget'), {
    ssr: false,
    loading: HeaderButtonSlot,
});

export const VoiceNavWidget = dynamic(() => import('./VoiceNavWidget'), {
    ssr: false,
    loading: HeaderButtonSlot,
});

/** A modal: nothing to hold a place for while it loads. */
export const SupportDialog = dynamic(() => import('./SupportDialog'), {
    ssr: false,
    loading: () => null,
});

/** The floating tracker draws nothing until it is opened, so it needs no placeholder. */
export const TimeTracker = dynamic(() => import('./projects/TimeTracker'), {
    ssr: false,
    loading: () => null,
});
