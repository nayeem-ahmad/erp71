import 'package:erp71_mobile/core/api/api_client.dart';
import 'package:erp71_mobile/core/auth/token_store.dart';
import 'package:erp71_mobile/features/crm/data/crm_repository.dart';
import 'package:erp71_mobile/features/crm/data/models.dart';
import 'package:flutter_test/flutter_test.dart';

import '../support/fake_backend.dart';
import '../support/fixtures.dart';

void main() {
  late FakeBackend backend;
  late CrmRepository repo;

  setUp(() async {
    backend = FakeBackend();
    final tokens = TokenStore(InMemoryKeyValueStore());
    await tokens.saveTokens(
      SessionTokens(
        accessToken: 'access',
        refreshToken: 'refresh',
        accessTokenExpiresAt: DateTime.now().add(const Duration(hours: 1)),
      ),
    );
    await tokens.saveContext(tenantId: 'tenant-1', storeId: 'store-1');
    repo = CrmRepository(
      ApiClient(baseUrl: apiBase, tokens: tokens, httpClient: backend.client),
    );
  });

  Map<String, String> query(String path) =>
      backend.sent('GET', path).last.url.queryParameters;

  group('leads', () {
    test('lists with only the filters that are set', () async {
      backend.on(
        'GET',
        '/crm/leads',
        (_) => page([leadJson()], pages: 2, total: 25),
      );

      final result = await repo.leads(
        const LeadQuery(search: ' rahim '),
        page: 1,
      );

      expect(result.items.single.name, 'Rahim Uddin');
      expect(result.hasMore, isTrue);
      // The endpoint rejects unknown parameters, and `mine=false` is noise.
      expect(query('/crm/leads'), {
        'status': 'open',
        'search': 'rahim',
        'page': '1',
        'limit': '20',
      });
    });

    test('mine and stale filters', () async {
      backend.on('GET', '/crm/leads', (_) => page(const []));

      await repo.leads(
        const LeadQuery(status: null, mine: true, staleDays: 14),
      );

      expect(query('/crm/leads'), {
        'mine': 'true',
        'staleDays': '14',
        'page': '1',
        'limit': '20',
      });
    });

    test(
      'creates without empty fields, which the endpoint mishandles',
      () async {
        backend.on('POST', '/crm/leads', (_) => leadJson());

        await repo.createLead({
          'name': 'Rahim Uddin',
          'mobile': '',
          'email': null,
          'priority': 'HIGH',
          'next_step': 'Call back',
          'next_step_date': '2026-09-27T10:00:00',
        });

        expect(backend.lastBody('POST', '/crm/leads'), {
          'name': 'Rahim Uddin',
          'priority': 'HIGH',
          'next_step': 'Call back',
          'next_step_date': '2026-09-27T10:00:00',
        });
      },
    );

    test('losing a lead sends the reason with the status', () async {
      backend.on('PATCH', '/crm/leads/lead-1', (_) => leadJson(status: 'LOST'));

      final lead = await repo.setLeadStatus(
        'lead-1',
        LeadStatus.lost,
        lostReason: 'Too expensive',
      );

      expect(lead.status, LeadStatus.lost);
      expect(backend.lastBody('PATCH', '/crm/leads/lead-1'), {
        'status': 'LOST',
        'lost_reason': 'Too expensive',
      });
    });

    test(
      'converting goes through /convert, which creates the customer',
      () async {
        backend.on(
          'POST',
          '/crm/leads/lead-1/convert',
          (_) => {
            'lead': leadJson(status: 'CONVERTED', score: 100),
            'customer': {
              'id': 'cust-1',
              'name': 'Rahim Uddin',
              'total_spent': '0',
            },
          },
        );

        final lead = await repo.convertLead('lead-1');

        expect(lead.isConverted, isTrue);
        expect(backend.sent('PATCH', '/crm/leads/lead-1'), isEmpty);
      },
    );
  });

  group('activities', () {
    test('each view asks for the right slice', () async {
      backend.on('GET', '/crm/activities', (_) => page(const []));

      await repo.activities(const ActivityQuery(view: ActivityView.today));
      expect(query('/crm/activities'), {
        'mine': 'true',
        'dueToday': 'true',
        'page': '1',
        'limit': '20',
      });

      await repo.activities(
        const ActivityQuery(view: ActivityView.overdue, mine: false),
      );
      expect(query('/crm/activities'), {
        'overdue': 'true',
        'page': '1',
        'limit': '20',
      });

      await repo.activities(const ActivityQuery(view: ActivityView.done));
      expect(query('/crm/activities'), {
        'mine': 'true',
        'status': 'DONE',
        'sortBy': 'completed_at',
        'sortDir': 'desc',
        'page': '1',
        'limit': '20',
      });
    });

    test('logging sends a DONE activity with channel and summary', () async {
      backend.on(
        'POST',
        '/crm/activities',
        (_) => activityJson(status: 'DONE'),
      );

      await repo.logActivity(
        leadId: 'lead-1',
        channelId: 'channel-1',
        summary: 'Talked prices',
        outcome: '',
        inbound: true,
      );

      expect(backend.lastBody('POST', '/crm/activities'), {
        'lead_id': 'lead-1',
        'status': 'DONE',
        'channel': 'channel-1',
        'summary': 'Talked prices',
        'direction': 'INBOUND',
      });
    });

    test(
      'planning sends the picked wall-clock time without an offset',
      () async {
        backend.on('POST', '/crm/activities', (_) => activityJson());

        await repo.planActivity(
          leadId: 'lead-1',
          subject: 'Send quotation',
          dueAt: DateTime(2026, 9, 27, 10),
        );

        expect(backend.lastBody('POST', '/crm/activities'), {
          'lead_id': 'lead-1',
          'status': 'PLANNED',
          'subject': 'Send quotation',
          'due_at': '2026-09-27T10:00:00',
        });
      },
    );

    test('completing can plan the next one in the same request', () async {
      backend.on(
        'POST',
        '/crm/activities/act-1/complete',
        (_) => {
          'completed': activityJson(status: 'DONE', summary: 'Sent'),
          'next': activityJson(id: 'act-2'),
        },
      );

      final done = await repo.completeActivity(
        'act-1',
        channelId: 'channel-1',
        summary: 'Sent',
        nextSubject: 'Chase the order',
        nextDueAt: DateTime(2026, 10, 1, 11, 30),
      );

      expect(done.status, ActivityStatus.done);
      expect(backend.lastBody('POST', '/crm/activities/act-1/complete'), {
        'channel': 'channel-1',
        'summary': 'Sent',
        'next': {'subject': 'Chase the order', 'due_at': '2026-10-01T11:30:00'},
      });
    });

    test('a timeline puts what is planned first, then the newest', () async {
      backend.on('GET', '/crm/activities', (request) {
        expect(request.url.queryParameters['leadId'], 'lead-1');
        return page([
          activityJson(
            id: 'old',
            status: 'DONE',
            completedAt: '2026-09-01T00:00:00.000Z',
          ),
          activityJson(id: 'later', dueAt: '2026-10-05T00:00:00.000Z'),
          activityJson(
            id: 'new',
            status: 'DONE',
            completedAt: '2026-09-20T00:00:00.000Z',
          ),
          activityJson(id: 'soon', dueAt: '2026-09-28T00:00:00.000Z'),
          activityJson(id: 'undated', dueAt: null),
        ]);
      });

      final timeline = await repo.leadActivities('lead-1');

      expect(timeline.map((a) => a.id), [
        'soon',
        'later',
        'undated',
        'new',
        'old',
      ]);
      expect(backend.sent('GET', '/crm/activities'), hasLength(1));
    });

    test('a long timeline is read page by page, up to a cap', () async {
      backend.on('GET', '/crm/activities', (request) {
        final p = int.parse(request.url.queryParameters['page']!);
        return page([activityJson(id: 'p$p')], page: p, pages: 9);
      });

      final timeline = await repo.leadActivities('lead-1');

      expect(timeline, hasLength(3));
      expect(backend.sent('GET', '/crm/activities'), hasLength(3));
    });
  });

  group('contacts', () {
    test('create leaves blanks out; update sends them to clear', () async {
      backend.on('POST', '/crm/contacts', (_) => contactJson());
      backend.on('PATCH', '/crm/contacts/contact-1', (_) => contactJson());

      await repo.createContact({
        'name': 'Nusrat',
        'mobile': '',
        'company': ' Acme ',
      });
      await repo.updateContact('contact-1', {'company': ''});

      // A null mobile is a 500 on create; blank is the way to clear on update.
      expect(backend.lastBody('POST', '/crm/contacts'), {
        'name': 'Nusrat',
        'company': 'Acme',
      });
      expect(backend.lastBody('PATCH', '/crm/contacts/contact-1'), {
        'company': '',
      });
    });
  });

  test('taxonomy lists drop retired rows', () async {
    backend.on('GET', '/crm/lead-taxonomy/channels', (_) => channelsJson());

    final channels = await repo.taxonomy(TaxonomyKind.channels);

    expect(channels.map((c) => c.code), ['CALL', 'WHATSAPP']);
  });
}
