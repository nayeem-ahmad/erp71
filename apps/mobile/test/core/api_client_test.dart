import 'dart:async';
import 'dart:convert';

import 'package:erp71_mobile/core/api/api_client.dart';
import 'package:erp71_mobile/core/api/api_exception.dart';
import 'package:erp71_mobile/core/auth/token_store.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

import '../support/fake_backend.dart';

void main() {
  late FakeBackend backend;
  late TokenStore tokens;
  late ApiClient api;
  late int expiries;
  var now = DateTime.utc(2026, 9, 26, 6);

  Future<void> signIn({
    String access = 'access-1',
    String refresh = 'refresh-1',
    Duration validFor = const Duration(hours: 1),
  }) async {
    await tokens.saveTokens(
      SessionTokens(
        accessToken: access,
        refreshToken: refresh,
        accessTokenExpiresAt: now.add(validFor),
      ),
    );
    await tokens.saveContext(tenantId: 'tenant-1', storeId: 'store-1');
  }

  setUp(() {
    now = DateTime.utc(2026, 9, 26, 6);
    backend = FakeBackend();
    tokens = TokenStore(InMemoryKeyValueStore());
    api = ApiClient(
      baseUrl: apiBase,
      tokens: tokens,
      httpClient: backend.client,
      clock: () => now,
    );
    expiries = 0;
    api.onSessionExpired = () => expiries++;
  });

  group('envelopes', () {
    test('returns what is inside "data"', () async {
      await signIn();
      backend.on('GET', '/crm/leads/lead-1', (_) => {'id': 'lead-1'});

      expect(await api.get('/crm/leads/lead-1'), {'id': 'lead-1'});
    });

    test('reads a list page and its meta', () async {
      await signIn();
      backend.on(
        'GET',
        '/crm/leads',
        (_) => page(
          [
            {'id': 'a'},
            {'id': 'b'},
          ],
          page: 1,
          pages: 3,
          total: 41,
        ),
      );

      final result = await api.getPage('/crm/leads');

      expect(result.items, hasLength(2));
      expect(result.total, 41);
      expect(result.hasMore, isTrue);
    });

    test('turns an error envelope into its message and code', () async {
      await signIn();
      backend.on(
        'POST',
        '/crm/leads',
        (_) => apiError(400, 'A lead with this mobile number already exists.'),
      );

      await expectLater(
        api.post('/crm/leads', body: {'name': 'x'}),
        throwsA(
          isA<ApiException>()
              .having((e) => e.statusCode, 'status', 400)
              .having((e) => e.code, 'code', 'BAD_REQUEST')
              .having(
                (e) => e.message,
                'message',
                'A lead with this mobile number already exists.',
              ),
        ),
      );
    });
  });

  group('headers', () {
    test('sends the token, the workspace and the branch', () async {
      await signIn();
      backend.on('GET', '/crm/activities', (_) => page(const []));

      await api.getPage('/crm/activities');

      final headers = backend.requests.single.headers;
      expect(headers['Authorization'], 'Bearer access-1');
      expect(headers['x-tenant-id'], 'tenant-1');
      expect(headers['x-store-id'], 'store-1');
    });

    test('sends no credentials on unauthenticated calls', () async {
      await signIn();
      backend.on(
        'POST',
        '/auth/google',
        (_) => {'requires_2fa': true, 'user_id': 'u'},
      );

      await api.post(
        '/auth/google',
        authenticated: false,
        body: {'credential': 't'},
      );

      final headers = backend.requests.single.headers;
      expect(headers.containsKey('Authorization'), isFalse);
      expect(headers.containsKey('x-tenant-id'), isFalse);
    });

    test('drops null and empty query values', () {
      final uri = api.uri('/crm/leads', {
        'status': 'open',
        'search': '',
        'priority': null,
        'page': 2,
      });

      expect(uri.toString(), '$apiBase/crm/leads?status=open&page=2');
    });
  });

  group('renewal', () {
    test('renews once on a 401, saves the rotated pair, and replays', () async {
      await signIn();
      var calls = 0;
      backend.on('GET', '/crm/leads/lead-1', (request) {
        calls++;
        return request.headers['Authorization'] == 'Bearer access-2'
            ? {'id': 'lead-1'}
            : apiError(401, 'Unauthorized');
      });
      backend.on(
        'POST',
        '/auth/refresh',
        (_) => {
          'access_token': 'access-2',
          'refresh_token': 'refresh-2',
          'expires_in': 3600,
        },
      );

      expect(await api.get('/crm/leads/lead-1'), {'id': 'lead-1'});

      expect(calls, 2);
      expect(backend.lastBody('POST', '/auth/refresh'), {
        'refresh_token': 'refresh-1',
      });
      expect(tokens.tokens!.accessToken, 'access-2');
      expect(tokens.tokens!.refreshToken, 'refresh-2');
      expect(expiries, 0);
    });

    test('shares one renewal between requests that fail together', () async {
      await signIn();
      final release = Completer<void>();
      backend.on('GET', '/crm/leads/:id', (request) async {
        if (request.headers['Authorization'] == 'Bearer access-2') {
          return {'ok': true};
        }
        return apiError(401, 'Unauthorized');
      });
      backend.on('POST', '/auth/refresh', (_) async {
        await release.future;
        return {
          'access_token': 'access-2',
          'refresh_token': 'refresh-2',
          'expires_in': 3600,
        };
      });

      final both = Future.wait([
        api.get('/crm/leads/a'),
        api.get('/crm/leads/b'),
      ]);
      await Future<void>.delayed(Duration.zero);
      release.complete();
      await both;

      // A second renewal would present an already-rotated token and be
      // refused, signing the user out.
      expect(backend.sent('POST', '/auth/refresh'), hasLength(1));
    });

    test('renews ahead of expiry instead of waiting for a 401', () async {
      await signIn(validFor: const Duration(seconds: 30));
      backend.on(
        'POST',
        '/auth/refresh',
        (_) => {
          'access_token': 'access-2',
          'refresh_token': 'refresh-2',
          'expires_in': 3600,
        },
      );
      backend.on('GET', '/crm/leads', (_) => page(const []));

      await api.getPage('/crm/leads');

      expect(backend.requests.map((r) => r.url.path), [
        '/api/v1/auth/refresh',
        '/api/v1/crm/leads',
      ]);
      expect(
        backend.sent('GET', '/crm/leads').single.headers['Authorization'],
        'Bearer access-2',
      );
    });

    test('ends the session when the refresh token is refused', () async {
      await signIn();
      backend.on('GET', '/crm/leads', (_) => apiError(401, 'Unauthorized'));
      backend.on(
        'POST',
        '/auth/refresh',
        (_) => apiError(401, 'Session revoked'),
      );

      await expectLater(
        api.getPage('/crm/leads'),
        throwsA(
          isA<ApiException>().having((e) => e.isUnauthorized, '401', isTrue),
        ),
      );
      expect(expiries, 1);
    });

    test(
      'keeps the session when renewal only fails for being offline',
      () async {
        await signIn();
        final offline = MockClient((request) async {
          if (request.url.path.endsWith('/auth/refresh')) {
            throw http.ClientException('Network is unreachable');
          }
          return apiError(401, 'Unauthorized');
        });
        api = ApiClient(
          baseUrl: apiBase,
          tokens: tokens,
          httpClient: offline,
          clock: () => now,
        )..onSessionExpired = () => expiries++;

        await expectLater(
          api.getPage('/crm/leads'),
          throwsA(
            isA<ApiException>().having((e) => e.isOffline, 'offline', isTrue),
          ),
        );
        expect(expiries, 0);
        expect(tokens.tokens, isNotNull);
      },
    );
  });

  group('workspace errors', () {
    test(
      'a 401 about the workspace header is not an expired session',
      () async {
        await signIn();
        backend.on(
          'GET',
          '/crm/leads',
          (_) => apiError(401, 'Invalid tenant context'),
        );

        await expectLater(
          api.getPage('/crm/leads'),
          throwsA(
            isA<ApiException>()
                .having((e) => e.code, 'code', ApiException.tenantContextCode)
                .having((e) => e.isUnauthorized, '401', isFalse),
          ),
        );
        expect(backend.sent('POST', '/auth/refresh'), isEmpty);
        expect(expiries, 0);
      },
    );
  });

  group('failures', () {
    test('reports an unreachable server as offline', () async {
      await signIn();
      api = ApiClient(
        baseUrl: apiBase,
        tokens: tokens,
        httpClient: MockClient(
          (_) => throw http.ClientException('Failed host lookup'),
        ),
        clock: () => now,
      );

      await expectLater(
        api.get('/crm/leads/x'),
        throwsA(
          isA<ApiException>()
              .having((e) => e.isOffline, 'offline', isTrue)
              .having((e) => e.message, 'message', ApiException.offlineMessage),
        ),
      );
    });

    test('passes on how long to wait when rate limited', () async {
      await signIn();
      backend.on(
        'GET',
        '/crm/leads',
        (_) => jsonResponse({
          'error': {
            'code': 'TOO_MANY_REQUESTS',
            'message':
                'Too many requests. Please wait 12 seconds and try again.',
            'retry_after': 12,
          },
        }, 429),
      );

      await expectLater(
        api.getPage('/crm/leads'),
        throwsA(
          isA<ApiException>()
              .having((e) => e.isRateLimited, '429', isTrue)
              .having((e) => e.retryAfterSeconds, 'retry', 12)
              .having((e) => e.message, 'message', contains('12 seconds')),
        ),
      );
    });

    test('falls back to a plain message when the body is not the API\'s', () {
      final e = ApiException.fromResponse(502, '<html>Bad gateway</html>');
      expect(e.message, ApiException.fallbackMessage(502));
    });

    test('decodes UTF-8 bodies', () async {
      await signIn();
      backend.on('GET', '/crm/leads/bn', (_) => {'name': 'রহিম উদ্দিন'});

      final data = await api.get('/crm/leads/bn') as Map<String, dynamic>;

      expect(data['name'], 'রহিম উদ্দিন');
      expect(jsonEncode(data), contains('রহিম'));
    });
  });
}
