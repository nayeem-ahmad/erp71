import {
    boardLanesKey,
    laneStorageId,
    MAX_REMEMBERED_LANE_BOARDS,
    parseStoredLanes,
    readCollapsedLanes,
    writeCollapsedLanes,
} from './board-lane-storage';

afterEach(() => localStorage.clear());

describe('board lane storage', () => {
    it('keeps the grouping in the id, so Unassigned and No story fold separately', () => {
        expect(laneStorageId('assignee', 'none')).not.toBe(laneStorageId('story', 'none'));
    });

    it('round-trips a board’s folded lanes', () => {
        writeCollapsedLanes('b1', ['assignee|user:u1']);
        expect(readCollapsedLanes('b1')).toEqual(['assignee|user:u1']);
        expect(readCollapsedLanes('b2')).toEqual([]);
    });

    it('clears the entry once nothing is folded', () => {
        writeCollapsedLanes('b1', ['assignee|none']);
        writeCollapsedLanes('b1', []);
        expect(localStorage.getItem(boardLanesKey('b1'))).toBeNull();
    });

    it('reads a hand-edited or broken entry as nothing folded', () => {
        localStorage.setItem(boardLanesKey('b1'), 'not json');
        expect(readCollapsedLanes('b1')).toEqual([]);
        expect(parseStoredLanes({ collapsed: ['a', 3, null] })).toEqual(['a']);
        expect(parseStoredLanes([])).toEqual([]);
    });

    it('forgets the oldest boards past the cap', () => {
        const now = jest.spyOn(Date, 'now');
        for (let i = 0; i <= MAX_REMEMBERED_LANE_BOARDS; i += 1) {
            now.mockReturnValue(1000 + i);
            writeCollapsedLanes(`b${i}`, ['story|none']);
        }
        now.mockRestore();
        expect(readCollapsedLanes('b0')).toEqual([]);
        expect(readCollapsedLanes(`b${MAX_REMEMBERED_LANE_BOARDS}`)).toEqual(['story|none']);
    });
});
