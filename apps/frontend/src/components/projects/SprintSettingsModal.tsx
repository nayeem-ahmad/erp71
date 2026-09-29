'use client';

import { useState } from 'react';
import { Button } from '@/components/ui';
import { Tabs, TabPanel } from '@/components/ui/compact/Tabs';
import ModalShell, { ModalHeader, ModalFooter } from '@/components/ModalShell';
import { useI18n } from '@/lib/i18n';
import BoardAppearanceControls from './BoardAppearanceControls';
import BoardBackgroundPicker from './BoardBackgroundPicker';
import type { BoardBackground } from './board-background';
import type { BoardViewControls } from './use-board-view';

type SettingsTab = 'appearance' | 'background';

/**
 * The sprint's counterpart of `BoardSettingsModal`, less the Columns tab: a
 * sprint's card columns are merged from the statuses of every project in it
 * (`sprint-cards.ts`), so there is nothing here to edit — they change on those
 * projects' boards.
 *
 * The two tabs keep the board's split. Appearance is this browser's, and is the
 * same preference the boards read, so a reader sets up how cards look once.
 * The background is the sprint's own and everyone who opens it sees it.
 */
export default function SprintSettingsModal({
    sprintId,
    sprintName,
    boardView,
    background,
    onBackgroundChanged,
    onClose,
}: Readonly<{
    sprintId: string;
    sprintName: string;
    boardView: BoardViewControls;
    background: BoardBackground;
    onBackgroundChanged: (next: BoardBackground) => void;
    onClose: () => void;
}>) {
    const { t } = useI18n();
    const [tab, setTab] = useState<SettingsTab>('appearance');

    return (
        <ModalShell size="lg" onBackdropClick={onClose}>
            <ModalHeader
                title={t.projects.sprint.settings}
                subtitle={sprintName}
                onClose={onClose}
                closeLabel={t.common.close}
            />

            <div className="flex-1 space-y-3 overflow-y-auto p-4">
                <Tabs<SettingsTab>
                    idPrefix="sprint-settings"
                    label={t.projects.sprint.settings}
                    value={tab}
                    // A click on the open tab must not blank the panel; see BoardSettingsPanel.
                    onChange={(next) => next && setTab(next)}
                    tabs={[
                        { key: 'appearance', label: t.projects.board.view.title },
                        { key: 'background', label: t.projects.boards.background.title },
                    ]}
                />

                <TabPanel tabKey="appearance" value={tab} idPrefix="sprint-settings">
                    <BoardAppearanceControls {...boardView} hide={['swimlanes', 'scroll']} />
                </TabPanel>

                <TabPanel tabKey="background" value={tab} idPrefix="sprint-settings">
                    <BoardBackgroundPicker
                        target={{ kind: 'sprint', id: sprintId }}
                        background={background}
                        onChanged={onBackgroundChanged}
                    />
                </TabPanel>
            </div>

            <ModalFooter>
                <Button variant="secondary" className="min-h-touch" onClick={onClose}>
                    {t.common.close}
                </Button>
            </ModalFooter>
        </ModalShell>
    );
}
