import 'package:erp71_mobile/app/router.dart';
import 'package:erp71_mobile/core/auth/auth_controller.dart';
import 'package:erp71_mobile/core/auth/models.dart';
import 'package:erp71_mobile/core/format/format.dart';
import 'package:erp71_mobile/features/crm/access.dart';
import 'package:erp71_mobile/features/crm/data/crm_repository.dart';
import 'package:erp71_mobile/features/crm/data/models.dart';
import 'package:erp71_mobile/ui/launch.dart';
import 'package:flutter_test/flutter_test.dart';

import '../support/fixtures.dart';

void main() {
  group('Workspace', () {
    test('reads role, permissions, branches and plan', () {
      final w = Workspace.fromJson(
        workspaceJson(
          stores: const [
            {'id': 's1', 'name': 'Main'},
            {'id': 's2', 'name': 'Uttara'},
          ],
        ),
      );

      expect(w.roleLabel, 'CRM User');
      expect(w.can(CrmPermission.viewActivities), isTrue);
      expect(w.can('APPROVE_CRM_ACTIVITY'), isFalse);
      expect(w.branches.map((b) => b.name), ['Main', 'Uttara']);
      expect(w.timezone, 'Asia/Dhaka');
    });

    test('an owner can do everything', () {
      final w = Workspace.fromJson(
        workspaceJson(role: 'OWNER', permissions: const []),
      );
      expect(w.can('APPROVE_CRM_ACTIVITY'), isTrue);
      expect(w.roleLabel, 'Owner');
    });

    test('reads plan flags the way the web does', () {
      for (final (value, expected) in [
        (true, true),
        ('true', true),
        ('1', true),
        (1, true),
        (false, false),
        (0, false),
        ('no', false),
        (null, false),
      ]) {
        final w = Workspace.fromJson(workspaceJson(premiumCrm: value));
        expect(w.hasPlanFeature('premiumCrm'), expected, reason: '$value');
      }
    });
  });

  group('canUseCrm', () {
    test('needs the plan flag and an active or trial subscription', () {
      bool crm({Object? premium = true, String status = 'ACTIVE'}) => canUseCrm(
        Workspace.fromJson(workspaceJson(premiumCrm: premium, status: status)),
      );

      expect(crm(), isTrue);
      expect(crm(status: 'TRIALING'), isTrue);
      // A new workspace waits in PAST_DUE until paid for; every CRM call
      // would be refused with PENDING_ACTIVATION.
      expect(crm(status: 'PAST_DUE'), isFalse);
      expect(crm(premium: false), isFalse);
    });
  });

  group('redirectFor', () {
    final crmWorkspace = Workspace.fromJson(workspaceJson());
    final plainWorkspace = Workspace.fromJson(workspaceJson(premiumCrm: false));
    const user = AuthUser(id: 'u', email: 'a@b.c');
    AuthSignedIn signedIn(Workspace? w, [List<Workspace>? all]) =>
        AuthSignedIn(user: user, workspaces: all ?? [?w], workspace: w);

    test('holds everyone on the step they are on', () {
      expect(redirectFor(const AuthRestoring(), '/leads'), '/splash');
      expect(redirectFor(const AuthSignedOut(), '/leads/x'), '/sign-in');
      expect(redirectFor(const AuthSignedOut(), '/sign-in'), isNull);
      expect(
        redirectFor(const AuthNeedsTwoFactor('u'), '/home'),
        '/two-factor',
      );
    });

    test('sends a signed-in user to a workspace, then into the CRM', () {
      expect(redirectFor(signedIn(null, const []), '/home'), '/no-workspace');
      expect(
        redirectFor(signedIn(null, [crmWorkspace, crmWorkspace]), '/home'),
        '/workspaces',
      );
      expect(redirectFor(signedIn(crmWorkspace), '/sign-in'), '/home');
      expect(redirectFor(signedIn(crmWorkspace), '/leads/abc'), isNull);
      expect(redirectFor(signedIn(crmWorkspace), '/workspaces'), isNull);
    });

    test('keeps a workspace without the CRM out of it', () {
      expect(redirectFor(signedIn(plainWorkspace), '/leads'), '/no-crm');
      expect(redirectFor(signedIn(plainWorkspace), '/account'), isNull);
    });
  });

  group('links from the overview', () {
    test('become lead filters, and nonsense becomes the default list', () {
      expect(leadQueryFromLink({'status': 'LOST'}).status, 'LOST');
      expect(
        leadQueryFromLink({'status': 'open', 'stale': '14'}).staleDays,
        14,
      );
      expect(leadQueryFromLink({'status': 'WON'}).status, LeadQuery.openStatus);
      expect(leadQueryFromLink({'stale': '-3'}).staleDays, isNull);
      expect(leadQueryFromLink(const {}), const LeadQuery());
    });
  });

  group('formatting', () {
    setUp(() => setActiveTimeZone('Asia/Dhaka'));
    tearDown(() => setActiveTimeZone(null));

    test('money in taka with two decimals', () {
      expect(formatBDT(1234.5), '৳ 1,234.50');
      expect(formatBDT(null), '৳ 0.00');
      expect(formatBDT(-50), '৳ -50.00');
    });

    test('dates in the workspace zone, not the phone\'s', () {
      // 20:30 UTC is already the next morning in Dhaka (UTC+6).
      final instant = DateTime.utc(2026, 9, 25, 20, 30);
      expect(formatDate(instant), '26/09/2026');
      expect(formatDateTime(instant), '26/09/2026, 02:30');
    });

    test('due labels count days on the workspace calendar', () {
      final now = DateTime(2026, 9, 26, 9); // wall clock in Dhaka
      expect(
        formatDueLabel(DateTime.utc(2026, 9, 26, 8), now: now),
        'Today 14:00',
      );
      expect(
        formatDueLabel(DateTime.utc(2026, 9, 27, 4), now: now),
        'Tomorrow 10:00',
      );
      expect(
        formatDueLabel(DateTime.utc(2026, 9, 25, 4), now: now),
        'Yesterday 10:00',
      );
      expect(
        formatDueLabel(DateTime.utc(2026, 10, 12, 4), now: now),
        '12 Oct 10:00',
      );
    });

    test(
      'a picked time is sent without an offset, for the server to read in the workspace zone',
      () {
        expect(
          wallClockIso(DateTime(2026, 9, 27, 10, 5)),
          '2026-09-27T10:05:00',
        );
      },
    );

    test('initials', () {
      expect(initialsOf('Karim Rahman'), 'KR');
      expect(initialsOf('karim@rahman.com.bd'), 'KR');
      expect(initialsOf('রহিম উদ্দিন'), 'রউ');
      expect(initialsOf('  '), '?');
    });

    test('decimals arrive as strings or numbers', () {
      expect(parseDecimal('1500.5'), 1500.5);
      expect(parseDecimal(3), 3.0);
      expect(parseDecimal(null), isNull);
    });
  });

  group('WhatsApp numbers', () {
    test('local Bangladeshi numbers gain the country code', () {
      expect(whatsAppDigits('01712-345678'), '8801712345678');
      expect(whatsAppDigits('+880 1712 345678'), '8801712345678');
      expect(whatsAppDigits('00880 1712 345678'), '8801712345678');
    });
  });

  group('CRM models', () {
    test('a lead reads its relations and ignores blank columns', () {
      final lead = Lead.fromJson(leadJson());

      expect(lead.status, LeadStatus.contacted);
      expect(lead.priority, LeadPriority.high);
      expect(lead.source!.name, 'Facebook');
      expect(lead.category!.name, 'Retail');
      expect(lead.assignee!.displayName, 'Karim Rahman');
      expect(
        lead.remarks,
        isNull,
        reason: 'the server keeps "" in some columns',
      );
      expect(lead.nextActivityId, 'act-1');
    });

    test('an activity shows its subject, else what was logged', () {
      final planned = Activity.fromJson(activityJson());
      final logged = Activity.fromJson(
        activityJson(
          status: 'DONE',
          subject: null,
          summary: 'Talked prices',
          completedAt: '2026-09-25T10:00:00.000Z',
        ),
      );

      expect(planned.title, 'Call back about pricing');
      expect(logged.title, 'Talked prices');
      expect(logged.channel!.label, '📞 Call');
      expect(planned.targetPhone, '01712-345678');
    });

    test('overdue means planned and due before the workspace\'s today', () {
      setActiveTimeZone('Asia/Dhaka');
      addTearDown(() => setActiveTimeZone(null));
      final a = Activity.fromJson(
        activityJson(dueAt: '2026-09-25T17:00:00.000Z'),
      );
      // 17:00 UTC on the 25th is 23:00 in Dhaka: yesterday, seen from the 26th.
      expect(a.isOverdue(now: DateTime(2026, 9, 26, 9)), isTrue);
      // ...but not from the evening of the 25th in Dhaka.
      expect(a.isOverdue(now: DateTime(2026, 9, 25, 22)), isFalse);
    });

    test('the overview reads its snake_case sections', () {
      final o = CrmOverview.fromJson(overviewJson());

      expect(o.statusCounts[LeadStatus.converted], 9);
      expect(o.open, 13);
      expect(o.overdue, 4);
      expect(o.conversionRatePct, 66.7);
      expect(o.staleAfterDays, 14);
    });

    test('score bands follow the web', () {
      expect(scoreTone(70).name, 'success');
      expect(scoreTone(40).name, 'warning');
      expect(scoreTone(39).name, 'neutral');
    });
  });
}
