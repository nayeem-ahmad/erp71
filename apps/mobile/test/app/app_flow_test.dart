import 'dart:convert';

import 'package:erp71_mobile/features/crm/leads/lead_detail_screen.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import '../support/app_harness.dart';
import '../support/fake_backend.dart';
import '../support/fixtures.dart';

void main() {
  testWidgets('signs in with Google and lands on the CRM overview', (
    tester,
  ) async {
    final backend = crmBackend();
    final google = FakeGoogleAuth();
    await pumpApp(tester, backend: backend, google: google);

    expect(find.text('Continue with Google'), findsOneWidget);
    await signInWithGoogle(tester);

    expect(google.lastServerClientId, 'web-client');
    expect(find.text('Overview'), findsWidgets);
    expect(find.text('Rahman Traders'), findsOneWidget);
    expect(find.text('Open leads'), findsOneWidget);
    expect(find.text('13'), findsOneWidget);
    expect(find.text('Due today for you'), findsOneWidget);

    // Every CRM request names the workspace and branch.
    final overview = backend.sent('GET', '/crm/dashboard/overview').single;
    expect(overview.headers['x-tenant-id'], 'tenant-1');
    expect(overview.headers['x-store-id'], 'store-1');
    expect(overview.headers['Authorization'], 'Bearer access-1');
    // A manager starts on "Mine".
    expect(overview.url.queryParameters, {'mine': 'true'});
  });

  testWidgets('an address with no ERP71 account is pointed at the web', (
    tester,
  ) async {
    final backend = crmBackend()
      ..on(
        'POST',
        '/auth/google',
        (_) => apiError(400, 'Please accept the Terms of Service to continue.'),
      );
    await pumpApp(tester, backend: backend);

    await signInWithGoogle(tester);

    expect(
      find.textContaining('No ERP71 account uses this Google address'),
      findsOneWidget,
    );
    expect(find.text('Continue with Google'), findsOneWidget);
  });

  testWidgets('a workspace without the CRM says so instead of failing', (
    tester,
  ) async {
    final backend = crmBackend()
      ..on(
        'POST',
        '/auth/google',
        (_) => authResponse(tenants: [workspaceJson(premiumCrm: false)]),
      );
    await pumpApp(tester, backend: backend);

    await signInWithGoogle(tester);

    expect(find.text('CRM is not available here'), findsOneWidget);
    expect(backend.sent('GET', '/crm/dashboard/overview'), isEmpty);
  });

  testWidgets('several workspaces: pick one first', (tester) async {
    final backend = crmBackend()
      ..on(
        'POST',
        '/auth/google',
        (_) => authResponse(
          tenants: [
            workspaceJson(id: 'tenant-1', name: 'Rahman Traders'),
            workspaceJson(id: 'tenant-2', name: 'Dhaka Wholesale'),
          ],
        ),
      );
    await pumpApp(tester, backend: backend);

    await signInWithGoogle(tester);
    expect(find.text('Choose a workspace'), findsOneWidget);

    await tester.tap(find.text('Dhaka Wholesale'));
    await tester.pumpAndSettle();

    expect(find.text('Dhaka Wholesale'), findsOneWidget);
    expect(
      backend
          .sent('GET', '/crm/dashboard/overview')
          .last
          .headers['x-tenant-id'],
      'tenant-2',
    );
  });

  testWidgets('works a lead: detail, timeline, and marking it lost', (
    tester,
  ) async {
    final backend = crmBackend()
      ..on('PATCH', '/crm/leads/lead-1', (request) {
        final body = jsonDecode(request.body) as Map<String, dynamic>;
        return leadJson(status: body['status'] as String, nextStep: null);
      });
    await pumpApp(tester, backend: backend);
    await signInWithGoogle(tester);

    await tester.tap(find.text('Leads').last);
    await tester.pumpAndSettle();
    expect(find.text('Rahim Uddin'), findsOneWidget);
    expect(find.text('Salma Begum'), findsOneWidget);
    expect(
      backend.sent('GET', '/crm/leads').last.url.queryParameters['status'],
      'open',
    );

    await tester.tap(find.text('Rahim Uddin'));
    await tester.pumpAndSettle();

    expect(find.text('Next step'), findsOneWidget);
    expect(find.text('Call'), findsOneWidget);
    final detail = find.descendant(
      of: find.byType(LeadDetailScreen),
      matching: find.byType(Scrollable),
    );
    await tester.scrollUntilVisible(
      find.text('Asked for the price list'),
      300,
      scrollable: detail.first,
    );
    expect(find.text('Asked for the price list'), findsOneWidget);

    await tester.scrollUntilVisible(
      find.text('Change status'),
      -300,
      scrollable: detail.first,
    );
    await tester.tap(find.text('Change status'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Mark as lost'));
    await tester.pumpAndSettle();

    // A reason is required, and asked for inline.
    await tester.tap(find.widgetWithText(TextButton, 'Mark as lost'));
    await tester.pumpAndSettle();
    expect(find.textContaining('Say why'), findsOneWidget);

    await tester.enterText(
      find.byType(TextField).last,
      'Chose a cheaper supplier',
    );
    await tester.tap(find.widgetWithText(TextButton, 'Mark as lost'));
    await tester.pumpAndSettle();

    expect(backend.lastBody('PATCH', '/crm/leads/lead-1'), {
      'status': 'LOST',
      'lost_reason': 'Chose a cheaper supplier',
    });
    expect(find.text('Marked as lost'), findsOneWidget);
  });

  testWidgets('marks today\'s activity done and plans the next', (
    tester,
  ) async {
    final backend = crmBackend()
      ..on(
        'POST',
        '/crm/activities/act-1/complete',
        (_) => {
          'completed': activityJson(status: 'DONE', summary: 'Sent the quote'),
          'next': activityJson(id: 'act-2'),
        },
      );
    await pumpApp(tester, backend: backend);
    await signInWithGoogle(tester);

    await tester.tap(find.text('Activities').last);
    await tester.pumpAndSettle();
    expect(
      backend
          .sent('GET', '/crm/activities')
          .last
          .url
          .queryParameters['dueToday'],
      'true',
    );

    await tester.tap(find.text('Call back about pricing').first);
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(FilledButton, 'Mark as done'));
    await tester.pumpAndSettle();

    // Channel and summary are both required.
    await tester.ensureVisible(
      find.widgetWithText(FilledButton, 'Mark as done'),
    );
    await tester.tap(find.widgetWithText(FilledButton, 'Mark as done'));
    await tester.pumpAndSettle();
    expect(find.text('Choose how you were in touch.'), findsOneWidget);
    expect(find.text('Say briefly what happened.'), findsOneWidget);

    await tester.tap(find.text('📞 Call'));
    await tester.enterText(
      find.widgetWithText(TextField, 'What happened? *'),
      'Sent the quote',
    );
    await tester.ensureVisible(find.text('Plan the next follow-up'));
    await tester.tap(find.text('Plan the next follow-up'));
    await tester.pumpAndSettle();
    await tester.enterText(
      find.widgetWithText(TextField, 'Next follow-up'),
      'Chase the order',
    );
    await tester.ensureVisible(find.text('Tomorrow 10:00'));
    await tester.tap(find.text('Tomorrow 10:00'));
    await tester.pumpAndSettle();
    await tester.ensureVisible(
      find.widgetWithText(FilledButton, 'Mark as done'),
    );
    await tester.tap(find.widgetWithText(FilledButton, 'Mark as done'));
    await tester.pumpAndSettle();

    final body = backend.lastBody('POST', '/crm/activities/act-1/complete');
    expect(body['channel'], 'channel-1');
    expect(body['summary'], 'Sent the quote');
    expect((body['next'] as Map)['subject'], 'Chase the order');
    expect((body['next'] as Map)['due_at'], endsWith('T10:00:00'));
    expect(find.text('Done, next follow-up planned'), findsOneWidget);
  });

  testWidgets(
    'a new lead needs a name, and a duplicate mobile is shown on its field',
    (tester) async {
      final backend = crmBackend()
        ..on(
          'POST',
          '/crm/leads',
          (_) =>
              apiError(400, 'A lead with this mobile number already exists.'),
        );
      await pumpApp(tester, backend: backend);
      await signInWithGoogle(tester);

      await tester.tap(find.byTooltip('New lead'));
      await tester.pumpAndSettle();
      expect(find.text('New lead'), findsOneWidget);

      await tester.tap(find.text('Save'));
      await tester.pumpAndSettle();
      expect(find.text('Enter a name.'), findsOneWidget);
      expect(backend.sent('POST', '/crm/leads'), isEmpty);

      await tester.enterText(
        find.widgetWithText(TextFormField, 'Name *'),
        'Rahim Uddin',
      );
      await tester.enterText(
        find.widgetWithText(TextFormField, 'Mobile'),
        '01712345678',
      );
      await tester.tap(find.text('Save'));
      await tester.pumpAndSettle();

      expect(
        find.text('A lead with this mobile number already exists.'),
        findsOneWidget,
      );
      expect(backend.lastBody('POST', '/crm/leads'), {
        'name': 'Rahim Uddin',
        'mobile': '01712345678',
        'priority': 'MEDIUM',
      });
    },
  );

  testWidgets('opens a contact from the list', (tester) async {
    await pumpApp(tester, backend: crmBackend());
    await signInWithGoogle(tester);

    await tester.tap(find.text('Contacts').last);
    await tester.pumpAndSettle();
    await tester.tap(find.text('Nusrat Jahan'));
    await tester.pumpAndSettle();

    expect(find.text('Buyer · Acme Ltd'), findsOneWidget);
    expect(find.text('nusrat@acme.com'), findsOneWidget);
  });

  testWidgets('signs out of this phone only', (tester) async {
    final backend = crmBackend();
    await pumpApp(tester, backend: backend);
    await signInWithGoogle(tester);

    await tester.tap(find.byTooltip('Account'));
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(OutlinedButton, 'Sign out'));
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(TextButton, 'Sign out'));
    await tester.pumpAndSettle();

    expect(find.text('Continue with Google'), findsOneWidget);
    expect(backend.lastBody('POST', '/auth/logout/session'), {
      'refresh_token': 'refresh-1',
    });
  });
}
