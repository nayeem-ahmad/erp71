export type MeetingStatus = 'DRAFT' | 'FINALIZED' | 'CANCELLED';
export type MeetingType = 'MANAGEMENT' | 'STAFF' | 'CLIENT' | 'SUPPLIER' | 'OTHER';
export type MeetingAttendeeRole = 'CHAIR' | 'MINUTE_TAKER' | 'MEMBER' | 'GUEST';
export type MeetingActionStatus = 'OPEN' | 'IN_PROGRESS' | 'DONE' | 'CANCELLED';
export type MeetingActionPriority = 'LOW' | 'NORMAL' | 'HIGH';

export type MeetingPerson = {
    id?: string;
    user_id?: string | null;
    name: string;
    email?: string | null;
    organization?: string | null;
    position?: number;
};

export type MeetingAction = {
    id?: string;
    position: number;
    description: string;
    assignee_user_id?: string | null;
    assignee_name: string;
    assignee_email?: string | null;
    assignee_org?: string | null;
    due_date: string;
    priority: MeetingActionPriority;
    status: MeetingActionStatus;
    completion_note?: string | null;
    others: MeetingPerson[];
};

export type MeetingDiscussion = {
    id?: string;
    position: number;
    title: string;
    description?: string | null;
    decision?: string | null;
    actionItems: MeetingAction[];
};

export type MeetingAttendee = MeetingPerson & {
    role: MeetingAttendeeRole;
    attended: boolean;
};

export type Meeting = {
    id: string;
    meeting_number: string;
    title: string;
    type: MeetingType;
    starts_at: string;
    ends_at?: string | null;
    venue?: string | null;
    summary?: string | null;
    status: MeetingStatus;
    organizer_id: string;
    created_by: string;
    share_token?: string | null;
    finalized_at?: string | null;
    organizer?: { id: string; name?: string | null; email: string } | null;
    attendees: MeetingAttendee[];
    discussions: MeetingDiscussion[];
    open_action_count?: number;
    overdue_action_count?: number;
};

export type MeetingActionRow = MeetingAction & {
    meeting: { id: string; title: string; meeting_number: string; starts_at: string; status: string };
    discussion: { id: string; title: string; position: number };
    involved_as: 'responsible' | 'other';
    is_overdue: boolean;
};

export type PublicMeeting = {
    meeting_number: string;
    title: string;
    type: MeetingType;
    starts_at: string;
    ends_at?: string | null;
    venue?: string | null;
    summary?: string | null;
    status: MeetingStatus;
    finalized_at?: string | null;
    organizer?: { name?: string | null; email?: string | null } | null;
    store?: { name?: string | null } | null;
    tenant?: { name?: string | null; brand_business_name?: string | null; brand_logo_url?: string | null } | null;
    attendees: MeetingAttendee[];
    discussions: MeetingDiscussion[];
};

export const MEETING_TYPES: MeetingType[] = ['MANAGEMENT', 'STAFF', 'CLIENT', 'SUPPLIER', 'OTHER'];
export const ATTENDEE_ROLES: MeetingAttendeeRole[] = ['CHAIR', 'MINUTE_TAKER', 'MEMBER', 'GUEST'];
export const ACTION_STATUSES: MeetingActionStatus[] = ['OPEN', 'IN_PROGRESS', 'DONE', 'CANCELLED'];
export const ACTION_PRIORITIES: MeetingActionPriority[] = ['LOW', 'NORMAL', 'HIGH'];
