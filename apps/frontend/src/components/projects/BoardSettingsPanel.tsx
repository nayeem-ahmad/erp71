'use client';

import { useState } from 'react';
import { Tabs, TabPanel } from '@/components/ui/compact/Tabs';
import { useI18n } from '@/lib/i18n';
import BoardAppearanceControls from './BoardAppearanceControls';
import BoardBackgroundPicker from './BoardBackgroundPicker';
import BoardColumnsEditor from './BoardColumnsEditor';
import type { BoardBackground } from './board-background';
import type { BoardProject } from './board-tasks';
import type { BoardViewControls } from './use-board-view';

type SettingsTab = 'columns' | 'appearance' | 'background';

/**
 * Everything about a board that is not a card, in one place.
 *
 * The board header used to carry three of these: an Appearance popover, a
 * Background modal and a link to a columns page — three entry points a reader
 * had to try in turn to find the one they wanted, and three buttons competing
 * with the filters for the width of a phone. They are three tabs here instead.
 *
 * They are deliberately still three *sections* rather than one list: columns
 * are the board's shape, the background is the board's and everyone in the
 * workspace sees it, and appearance is this browser's preference alone. Those
 * are different promises, and a single scroll of controls would flatten them.
 */
export default function BoardSettingsPanel({
    boardId,
    boardView,
    background,
    projectsOnBoard,
    onBackgroundChanged,
    onColumnsChanged,
}: Readonly<{
    boardId: string;
    boardView: BoardViewControls;
    background: BoardBackground;
    /** Every project with a card on the board — see `BoardColumnsEditor`. */
    projectsOnBoard: BoardProject[];
    onBackgroundChanged: (next: BoardBackground) => void;
    onColumnsChanged?: () => void;
}>) {
    const { t } = useI18n();
    const m = t.projects.boards;

    const [tab, setTab] = useState<SettingsTab>('columns');

    return (
        <div className="space-y-3">
            <Tabs<SettingsTab>
                idPrefix="board-settings"
                label={m.boardSettings}
                value={tab}
                // `Tabs` closes a tab that is clicked while selected, which is
                // right for a card that opens on no record and wrong for a
                // settings panel: the body would simply go blank.
                onChange={(next) => next && setTab(next)}
                tabs={[
                    { key: 'columns', label: m.columns },
                    { key: 'appearance', label: t.projects.board.view.title },
                    { key: 'background', label: m.background.title },
                ]}
            />

            <TabPanel tabKey="columns" value={tab} idPrefix="board-settings">
                <BoardColumnsEditor
                    boardId={boardId}
                    projectsOnBoard={projectsOnBoard}
                    onChanged={onColumnsChanged}
                />
            </TabPanel>

            <TabPanel tabKey="appearance" value={tab} idPrefix="board-settings">
                <BoardAppearanceControls {...boardView} />
            </TabPanel>

            <TabPanel tabKey="background" value={tab} idPrefix="board-settings">
                <BoardBackgroundPicker
                    boardId={boardId}
                    background={background}
                    onChanged={onBackgroundChanged}
                />
            </TabPanel>
        </div>
    );
}
