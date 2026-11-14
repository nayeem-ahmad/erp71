import 'package:erp71_mobile/features/ask/ask_copy.dart';
import 'package:erp71_mobile/features/ask/ask_draft.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  const task = {
    'kind': 'task',
    'status': 'needs_input',
    'missing': ['project'],
    'warnings': ['More than one project matches "shop". Pick one.'],
    'fields': {
      'title': 'Call the supplier',
      'description': 'About the rice order',
      'projectChoices': [
        {'id': 'p-show', 'label': 'Showroom', 'detail': 'SH'},
      ],
      'assigneeUnresolved': true,
      'assigneeChoices': [
        {'id': 'u-1', 'label': 'Karim', 'kind': 'user'},
        {
          'id': 'e-2',
          'label': 'Salma',
          'kind': 'employee',
          'detail': 'Cashier',
        },
      ],
      'priority': 'high',
      'dueDate': 'tomorrow',
    },
  };

  test(
    'a task draft keeps the choices and drops a due date that is not a day',
    () {
      final draft = AskDraft.tryParse(task)!;
      expect(draft.kind, AskDraftKind.task);
      expect(draft.fields.title, 'Call the supplier');
      expect(draft.fields.projectChoices.single.menuLabel, 'Showroom (SH)');
      expect(draft.fields.dueDate, isNull);
      expect(initialPriority(draft), 'HIGH');
      expect(assigneeValueOf(draft), '');
      expect(assigneeOptions(draft).map((choice) => choice.value), [
        'user:u-1',
        'employee:e-2',
      ]);
      expect(
        taskReady(title: 'Call the supplier', projectId: '', assignee: ''),
        isFalse,
      );
      expect(
        taskReady(
          title: 'Call the supplier',
          projectId: 'p-show',
          assignee: 'unassigned',
        ),
        isTrue,
      );
    },
  );

  test(
    'an unassigned task sends no assignee, and a named one sends the right id',
    () {
      expect(
        taskPayload(
          title: ' Call ',
          description: '',
          projectId: 'p-show',
          assignee: 'unassigned',
          dueDate: '',
          priority: 'MEDIUM',
        ),
        {'projectId': 'p-show', 'title': 'Call', 'priority': 'MEDIUM'},
      );
      expect(
        taskPayload(
          title: 'Call',
          description: 'Rice',
          projectId: 'p-show',
          assignee: 'employee:e-2',
          dueDate: '2026-11-15',
          priority: 'HIGH',
        ),
        {
          'projectId': 'p-show',
          'title': 'Call',
          'description': 'Rice',
          'dueDate': '2026-11-15',
          'priority': 'HIGH',
          'assigneeEmployeeId': 'e-2',
        },
      );
    },
  );

  test('a lead keeps the company in the note and never names an owner', () {
    final draft = AskDraft.tryParse({
      'kind': 'lead',
      'fields': {
        'name': 'Rahim',
        'mobile': '01711111111',
        'email': 'not-an-email',
        'remarks': 'Company: Karim Traders',
      },
    })!;
    expect(draft.kind, AskDraftKind.lead);
    expect(leadReady(name: 'Rahim', email: 'not-an-email'), isFalse);
    expect(leadReady(name: 'Rahim', email: ''), isTrue);
    expect(leadReady(name: 'Rahim', email: 'rahim@example.com'), isTrue);
    final body = leadPayload(
      name: 'Rahim',
      mobile: '01711111111',
      email: '',
      remarks: 'Company: Karim Traders',
    );
    expect(body.containsKey('assigned_to'), isFalse);
    expect(body.containsKey('email'), isFalse);
    expect(body['remarks'], 'Company: Karim Traders');
  });

  test('a lookup has no card, and a card waits for the tool list', () {
    final drafts = parseDrafts([
      {'name': 'sales_summary', 'args': <String, Object?>{}},
      {
        'name': 'propose_create_task',
        'args': <String, Object?>{},
        'draft': task,
      },
    ]);
    expect(drafts, hasLength(1));
    expect(
      draftIsOffered(false, {'propose_create_task'}, drafts.single),
      isFalse,
    );
    expect(draftIsOffered(true, {'sales_summary'}, drafts.single), isFalse);
    expect(
      draftIsOffered(true, {'propose_create_task'}, drafts.single),
      isTrue,
    );
    expect(AskDraft.tryParse({'kind': 'ticket', 'fields': {}}), isNull);
  });

  test('credits stay readable', () {
    expect(formatCredits(2), '2');
    expect(formatCredits(0.25), '0.25');
    expect(formatCredits(0.5), '0.5');
    expect(formatCredits(1.0), '1');
    expect(const AskCopy(false).creditsLine(2), '2 credits');
    expect(const AskCopy(false).creditsLine(1), '1 credit');
    expect(const AskCopy(true).heard(0.25), contains('0.25'));
  });
}
