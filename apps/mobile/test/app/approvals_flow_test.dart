import 'package:erp71_mobile/core/push/push_channel.dart';
import 'package:erp71_mobile/core/security/app_lock.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import '../support/app_harness.dart';
import '../support/fake_backend.dart';
import '../support/fixtures.dart';

Map<String, Object?> approvalJson({
  String kind = 'EXPENSE_CLAIM',
  String id = 'claim-1',
  String title = 'Travel to Chattogram',
  num? amount = 1200,
  String? requestedBy = 'Rina Akter',
  String? branch,
}) => {
  'kind': kind,
  'id': id,
  'title': title,
  'amount': amount,
  'requested_by': requestedBy,
  'requested_at': DateTime.now()
      .toUtc()
      .subtract(const Duration(hours: 2))
      .toIso8601String(),
  'branch': branch,
  'details': [
    {'label': 'Lines', 'value': '2'},
  ],
};

Map<String, Object?> inboxJson(List<Map<String, Object?>> items) => {
  'items': items,
  'kinds': ['EXPENSE_CLAIM', 'LEAVE_REQUEST', 'VOUCHER'],
  'counts': <String, Object?>{},
  'total': items.length,
};

Finder tab(String label) =>
    find.descendant(of: find.byType(NavigationBar), matching: find.text(label));

Future<void> openApprovals(WidgetTester tester) async {
  await tester.tap(tab('Approvals'));
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('lists what waits, badges the tab, and filters by kind', (
    tester,
  ) async {
    final backend = ownerBackend()
      ..on(
        'GET',
        '/approvals/inbox',
        (_) => inboxJson([
          approvalJson(),
          approvalJson(
            kind: 'LEAVE_REQUEST',
            id: 'leave-1',
            title: 'Casual leave · 2 days',
            amount: null,
            requestedBy: 'Kamal Hossain',
          ),
        ]),
      );
    await pumpApp(tester, backend: backend);
    await signInWithGoogle(tester);

    expect(
      find.descendant(of: find.byType(Badge), matching: find.text('2')),
      findsWidgets,
    );
    await openApprovals(tester);

    expect(find.text('Travel to Chattogram'), findsOneWidget);
    expect(find.text('Casual leave · 2 days'), findsOneWidget);
    expect(find.text('৳ 1,200.00'), findsOneWidget);

    // At 360px the chips run off the edge and scroll sideways.
    await tester.ensureVisible(find.text('Leave 1'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Leave 1'));
    await tester.pumpAndSettle();
    expect(find.text('Travel to Chattogram'), findsNothing);
    expect(find.text('Casual leave · 2 days'), findsOneWidget);
  });

  testWidgets('approves with a note, and the inbox reloads', (tester) async {
    var waiting = [approvalJson()];
    final backend = ownerBackend()
      ..on('GET', '/approvals/inbox', (_) => inboxJson(waiting))
      ..on('POST', '/approvals/EXPENSE_CLAIM/claim-1/approve', (_) {
        waiting = [];
        return {'decision': 'APPROVED'};
      });
    await pumpApp(tester, backend: backend);
    await signInWithGoogle(tester);
    await openApprovals(tester);

    await tester.tap(find.text('Travel to Chattogram'));
    await tester.pumpAndSettle();
    expect(find.text('Lines'), findsOneWidget);
    await tester.enterText(find.byType(TextField), 'Fine, within policy');
    await tester.tap(find.widgetWithText(FilledButton, 'Approve'));
    await tester.pumpAndSettle();

    expect(
      backend.lastBody('POST', '/approvals/EXPENSE_CLAIM/claim-1/approve'),
      {'note': 'Fine, within policy'},
    );
    expect(find.text('Expense claim approved'), findsOneWidget);
    expect(find.text('Nothing waiting'), findsOneWidget);
  });

  testWidgets('a rejection needs a reason, said on the field', (tester) async {
    final backend = ownerBackend()
      ..on('GET', '/approvals/inbox', (_) => inboxJson([approvalJson()]))
      ..on(
        'POST',
        '/approvals/EXPENSE_CLAIM/claim-1/reject',
        (_) => {'decision': 'REJECTED'},
      );
    await pumpApp(tester, backend: backend);
    await signInWithGoogle(tester);
    await openApprovals(tester);
    await tester.tap(find.text('Travel to Chattogram'));
    await tester.pumpAndSettle();

    await tester.tap(find.widgetWithText(OutlinedButton, 'Reject'));
    await tester.pumpAndSettle();
    expect(find.text('Say why, so they know what to change.'), findsOneWidget);
    expect(
      backend.sent('POST', '/approvals/EXPENSE_CLAIM/claim-1/reject'),
      isEmpty,
    );

    await tester.enterText(find.byType(TextField), 'Receipt missing');
    await tester.tap(find.widgetWithText(OutlinedButton, 'Reject'));
    await tester.pumpAndSettle();
    expect(
      backend.lastBody('POST', '/approvals/EXPENSE_CLAIM/claim-1/reject'),
      {'reason': 'Receipt missing'},
    );
  });

  testWidgets('a large amount asks for the phone lock before approving', (
    tester,
  ) async {
    final authenticator = FakeDeviceAuthenticator(
      result: DeviceAuthResult.failed,
    );
    final backend = ownerBackend()
      ..on(
        'GET',
        '/approvals/inbox',
        (_) => inboxJson([
          approvalJson(
            kind: 'VOUCHER',
            id: 'v1',
            title: 'JV-0007',
            amount: 75000,
          ),
        ]),
      )
      ..on('POST', '/approvals/VOUCHER/v1/approve', (_) => {});
    await pumpApp(tester, backend: backend, authenticator: authenticator);
    await signInWithGoogle(tester);
    await openApprovals(tester);
    await tester.tap(find.text('JV-0007'));
    await tester.pumpAndSettle();

    await tester.tap(find.widgetWithText(FilledButton, 'Approve'));
    await tester.pumpAndSettle();
    expect(authenticator.reasons, ['Confirm approving ৳ 75,000.00']);
    expect(backend.sent('POST', '/approvals/VOUCHER/v1/approve'), isEmpty);

    authenticator.result = DeviceAuthResult.passed;
    await tester.tap(find.widgetWithText(FilledButton, 'Approve'));
    await tester.pumpAndSettle();
    expect(backend.sent('POST', '/approvals/VOUCHER/v1/approve'), hasLength(1));
  });

  testWidgets('someone else deciding first is said plainly, not as an error', (
    tester,
  ) async {
    var waiting = [approvalJson()];
    final backend = ownerBackend()
      ..on('GET', '/approvals/inbox', (_) => inboxJson(waiting))
      ..on('POST', '/approvals/EXPENSE_CLAIM/claim-1/approve', (_) {
        waiting = [];
        return apiError(409, 'This expense claim has already been decided.');
      });
    await pumpApp(tester, backend: backend);
    await signInWithGoogle(tester);
    await openApprovals(tester);
    await tester.tap(find.text('Travel to Chattogram'));
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(FilledButton, 'Approve'));
    await tester.pumpAndSettle();

    expect(
      find.text('This expense claim has already been decided.'),
      findsOneWidget,
    );
    expect(find.text('Nothing waiting'), findsOneWidget);
  });

  testWidgets('an approval push opens the inbox', (tester) async {
    final push = FakePushChannel();
    final backend = ownerBackend()
      ..on(
        'GET',
        '/push/config',
        (_) => {
          'enabled': true,
          'project_id': 'p',
          'api_key': 'k',
          'sender_id': '1',
          'android_app_id': 'a',
        },
      )
      ..on('POST', '/push/devices', (_) => null)
      ..on('PATCH', '/notifications/n-1/read', (_) => {})
      ..on('GET', '/approvals/inbox', (_) => inboxJson([approvalJson()]));
    await pumpApp(tester, backend: backend, push: push);
    await signInWithGoogle(tester);

    push.tapController.add(
      const PushTap({
        'notification_id': 'n-1',
        'tenant_id': 'tenant-1',
        'type': 'APPROVAL_REQUEST',
        'link': '/hr',
      }),
    );
    await tester.pumpAndSettle();

    expect(find.text('Travel to Chattogram'), findsOneWidget);
  });

  testWidgets('an HR approver with nothing else starts on Approvals', (
    tester,
  ) async {
    final hr = workspaceJson(
      permissions: const ['MANAGE_HR'],
      premiumCrm: false,
    );
    final backend = crmBackend()
      ..on('POST', '/auth/google', (_) => authResponse(tenants: [hr]))
      ..on('GET', '/approvals/inbox', (_) => inboxJson([approvalJson()]));
    await pumpApp(tester, backend: backend);
    await signInWithGoogle(tester);

    expect(find.text('Travel to Chattogram'), findsOneWidget);
    for (final label in ['Approvals', 'Alerts', 'More']) {
      expect(tab(label), findsOneWidget);
    }
    expect(tab('Home'), findsNothing);
  });
}
