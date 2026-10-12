import 'package:erp71_mobile/core/push/push_channel.dart';
import 'package:erp71_mobile/features/alerts/alerts_data.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import '../support/app_harness.dart';
import '../support/fake_backend.dart';
import '../support/fixtures.dart';

Map<String, Object?> pushConfigJson() => {
  'enabled': true,
  'project_id': 'erp71-test',
  'api_key': 'api-key',
  'sender_id': '1234',
  'android_app_id': '1:1234:android:abc',
  'ios_app_id': null,
};

Map<String, Object?> alertJson({
  String id = 'n-1',
  String type = 'LOW_STOCK',
  String title = 'Low stock: 3 items',
  String body = 'Rice 5kg is down to 2.',
  String? link = '/inventory',
  bool read = false,
}) => {
  'id': id,
  'type': type,
  'title': title,
  'body': body,
  'link': link,
  'read_at': read ? '2026-10-07T05:00:00.000Z' : null,
  'created_at': DateTime.now()
      .toUtc()
      .subtract(const Duration(minutes: 5))
      .toIso8601String(),
};

Finder tab(String label) =>
    find.descendant(of: find.byType(NavigationBar), matching: find.text(label));

void main() {
  group('push registration', () {
    testWidgets('signing in registers this phone against its session', (
      tester,
    ) async {
      final push = FakePushChannel();
      final backend = crmBackend()
        ..on('GET', '/push/config', (_) => pushConfigJson())
        ..on('POST', '/push/devices', (_) => null);
      await pumpApp(tester, backend: backend, push: push);
      await signInWithGoogle(tester);

      expect(push.started.single.androidAppId, '1:1234:android:abc');
      expect(backend.lastBody('POST', '/push/devices'), {
        'token': 'fcm-token-1',
        'platform': 'android',
        'refresh_token': 'refresh-1',
      });

      // Firebase rotates the token: the server hears the new one.
      push.tokenRefreshController.add('fcm-token-2');
      await tester.pumpAndSettle();
      expect(backend.lastBody('POST', '/push/devices')['token'], 'fcm-token-2');
    });

    testWidgets('a declined permission registers nothing', (tester) async {
      final backend = crmBackend()
        ..on('GET', '/push/config', (_) => pushConfigJson());
      await pumpApp(
        tester,
        backend: backend,
        push: FakePushChannel(token: null),
      );
      await signInWithGoogle(tester);

      expect(backend.sent('POST', '/push/devices'), isEmpty);
      // And the app is none the worse for it.
      expect(find.text('Open leads'), findsOneWidget);
    });

    testWidgets('a server without push asks the phone for nothing', (
      tester,
    ) async {
      final push = FakePushChannel();
      await pumpApp(tester, backend: crmBackend(), push: push);
      await signInWithGoogle(tester);
      expect(push.started, isEmpty);
    });

    testWidgets('signing out takes the phone off the list first', (
      tester,
    ) async {
      final backend = crmBackend()
        ..on('GET', '/push/config', (_) => pushConfigJson())
        ..on('POST', '/push/devices', (_) => null)
        ..on('POST', '/push/devices/unregister', (_) => null);
      await pumpApp(tester, backend: backend);
      await signInWithGoogle(tester);

      await tester.tap(find.byTooltip('Account'));
      await tester.pumpAndSettle();
      await tester.tap(find.widgetWithText(OutlinedButton, 'Sign out'));
      await tester.pumpAndSettle();
      await tester.tap(find.widgetWithText(TextButton, 'Sign out'));
      await tester.pumpAndSettle();

      final unregister = backend.sent('POST', '/push/devices/unregister');
      expect(unregister, hasLength(1));
      // Sent while the session could still authenticate it.
      expect(unregister.single.headers['Authorization'], 'Bearer access-1');
      expect(
        backend.requests.indexOf(unregister.single),
        lessThan(
          backend.requests.indexOf(
            backend.sent('POST', '/auth/logout/session').single,
          ),
        ),
      );
    });
  });

  group('alerts tab', () {
    testWidgets('lists the bell, badges the unread, and opens what it can', (
      tester,
    ) async {
      final backend = crmBackend()
        ..on(
          'GET',
          '/notifications',
          (_) => page([
            alertJson(
              id: 'n-1',
              type: 'CRM_FOLLOW_UP',
              title: 'Follow-up due: Rahim Uddin',
              link: '/crm/activities?highlight=act-1',
            ),
            alertJson(id: 'n-2', read: true, title: 'Payment received'),
          ]),
        )
        ..on('GET', '/notifications/unread-count', (_) => {'count': 1})
        ..on('PATCH', '/notifications/n-1/read', (_) => {'id': 'n-1'});
      await pumpApp(tester, backend: backend);
      await signInWithGoogle(tester);

      // A CRM-only member: the four CRM tabs and Alerts.
      expect(tab('Alerts'), findsOneWidget);
      expect(
        find.descendant(of: find.byType(Badge), matching: find.text('1')),
        findsWidgets,
      );

      await tester.tap(tab('Alerts'));
      await tester.pumpAndSettle();
      expect(find.text('Follow-up due: Rahim Uddin'), findsOneWidget);
      expect(find.text('Payment received'), findsOneWidget);
      expect(find.bySemanticsLabel('Unread'), findsOneWidget);

      await tester.tap(find.text('Follow-up due: Rahim Uddin'));
      await tester.pumpAndSettle();

      expect(backend.sent('PATCH', '/notifications/n-1/read'), hasLength(1));
      // The web's activities link opens the phone's Activities list.
      expect(find.widgetWithText(AppBar, 'Activities'), findsOneWidget);
    });

    testWidgets('mark all read', (tester) async {
      final backend = crmBackend()
        ..on('GET', '/notifications', (_) => page([alertJson()]))
        ..on('GET', '/notifications/unread-count', (_) => {'count': 1})
        ..on('PATCH', '/notifications/read-all', (_) => {'success': true});
      await pumpApp(tester, backend: backend);
      await signInWithGoogle(tester);
      await tester.tap(tab('Alerts'));
      await tester.pumpAndSettle();

      await tester.tap(find.byTooltip('Mark all read'));
      await tester.pumpAndSettle();

      expect(backend.sent('PATCH', '/notifications/read-all'), hasLength(1));
      expect(find.bySemanticsLabel('Unread'), findsNothing);
      expect(find.byTooltip('Mark all read'), findsNothing);
    });
  });

  group('tapping a push', () {
    testWidgets('opens its screen in its own workspace, and marks it read', (
      tester,
    ) async {
      final push = FakePushChannel();
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
        )
        ..on('GET', '/push/config', (_) => pushConfigJson())
        ..on('POST', '/push/devices', (_) => null)
        ..on('PATCH', '/notifications/n-9/read', (_) => {'id': 'n-9'});
      await pumpApp(tester, backend: backend, push: push);
      await signInWithGoogle(tester);
      await tester.tap(find.text('Rahman Traders'));
      await tester.pumpAndSettle();

      push.tapController.add(
        const PushTap({
          'notification_id': 'n-9',
          'tenant_id': 'tenant-2',
          'type': 'CRM_FOLLOW_UP',
          'link': '/crm/leads/lead-1',
        }),
      );
      await tester.pumpAndSettle();

      expect(find.text('Rahim Uddin'), findsWidgets);
      final read = backend.sent('PATCH', '/notifications/n-9/read').single;
      expect(read.headers['x-tenant-id'], 'tenant-2');
    });

    testWidgets('one for a workspace the person has left does nothing', (
      tester,
    ) async {
      final push = FakePushChannel();
      final backend = crmBackend()
        ..on('GET', '/push/config', (_) => pushConfigJson())
        ..on('POST', '/push/devices', (_) => null);
      await pumpApp(tester, backend: backend, push: push);
      await signInWithGoogle(tester);

      push.tapController.add(
        const PushTap({'tenant_id': 'tenant-gone', 'link': '/crm/leads'}),
      );
      await tester.pumpAndSettle();

      expect(find.text('Open leads'), findsOneWidget);
    });

    testWidgets('one arriving with the app open is shown and badged', (
      tester,
    ) async {
      var unread = 0;
      final push = FakePushChannel();
      final backend = crmBackend()
        ..on('GET', '/push/config', (_) => pushConfigJson())
        ..on('POST', '/push/devices', (_) => null)
        ..on('GET', '/notifications/unread-count', (_) => {'count': unread});
      await pumpApp(tester, backend: backend, push: push);
      await signInWithGoogle(tester);

      unread = 3;
      push.arrivalController.add(
        const PushTap({'tenant_id': 'tenant-1'}, title: 'Approval waiting'),
      );
      await tester.pumpAndSettle();

      expect(find.text('Approval waiting'), findsOneWidget);
      expect(
        find.descendant(of: find.byType(Badge), matching: find.text('3')),
        findsWidgets,
      );
    });
  });

  test('web links map to phone screens, and the rest stay on Alerts', () {
    expect(mobileRouteFor('/crm/activities?highlight=a1'), '/activities');
    expect(mobileRouteFor('/crm/leads/abc'), '/leads/abc');
    expect(mobileRouteFor('/crm/leads'), '/leads');
    expect(mobileRouteFor('/crm/contacts/c1'), '/contacts/c1');
    expect(mobileRouteFor('/crm'), '/crm');
    expect(mobileRouteFor('/sales/cashier-sessions'), '/cashiers');
    expect(mobileRouteFor('/approvals?kind=EXPENSE_CLAIM'), '/approvals');
    expect(mobileRouteFor('/dashboard'), '/home');
    expect(mobileRouteFor('/billing'), isNull);
    expect(mobileRouteFor('/inventory'), isNull);
    expect(mobileRouteFor('https://evil.example/crm/leads'), isNull);
    expect(mobileRouteFor(null), isNull);
  });
}
