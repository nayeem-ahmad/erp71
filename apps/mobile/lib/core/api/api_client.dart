import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;

import '../auth/token_store.dart';
import 'api_exception.dart';

/// One page of a list endpoint: the backend answers
/// `{"data": [...], "meta": {"total", "page", "limit", "pages"}}`.
class ApiPage {
  const ApiPage({
    required this.items,
    required this.total,
    required this.page,
    required this.pages,
  });

  factory ApiPage.fromEnvelope(Map<String, dynamic> envelope) {
    final meta = envelope['meta'];
    final items = envelope['data'];
    final list = items is List ? items : const <dynamic>[];
    int read(String key, int fallback) =>
        meta is Map<String, dynamic> && meta[key] is num
        ? (meta[key] as num).toInt()
        : fallback;
    return ApiPage(
      items: list,
      total: read('total', list.length),
      page: read('page', 1),
      pages: read('pages', 1),
    );
  }

  final List<dynamic> items;
  final int total;
  final int page;
  final int pages;

  bool get hasMore => page < pages;
}

/// JSON over HTTP to the ERP71 API.
///
/// Every authenticated request carries the access token, the chosen
/// workspace (`x-tenant-id`) and, for staff limited to certain branches, the
/// branch (`x-store-id`) whose permissions the request is checked against.
/// Every success is enveloped as `{"data": …}` — lists add `meta` — and the
/// convenience methods return what is inside it.
///
/// An access token close to expiry is renewed first; one the server rejects
/// is renewed once and the request replayed. Renewal is single-flight because
/// `/auth/refresh` rotates the refresh token: two concurrent renewals would
/// each present the same token and the loser would be refused.
class ApiClient {
  ApiClient({
    required this.baseUrl,
    required this.tokens,
    http.Client? httpClient,
    this.timeout = const Duration(seconds: 30),
    DateTime Function()? clock,
  }) : _http = httpClient ?? http.Client(),
       _now = clock ?? DateTime.now;

  final String baseUrl;
  final TokenStore tokens;
  final Duration timeout;
  final http.Client _http;
  final DateTime Function() _now;

  /// Renew this long before the access token actually lapses, so a request
  /// already in flight does not arrive with a token that just expired.
  static const renewalWindow = Duration(seconds: 60);

  /// Called when the refresh token itself is refused, i.e. the session is
  /// over and the app must return to sign-in.
  void Function()? onSessionExpired;

  Future<void>? _refreshing;

  Future<dynamic> get(
    String path, {
    Map<String, Object?>? query,
    bool authenticated = true,
  }) async => (await _send(
    'GET',
    path,
    query: query,
    authenticated: authenticated,
  ))?['data'];

  Future<ApiPage> getPage(String path, {Map<String, Object?>? query}) async =>
      ApiPage.fromEnvelope(
        (await _send('GET', path, query: query)) ?? const <String, dynamic>{},
      );

  Future<dynamic> post(
    String path, {
    Object? body,
    bool authenticated = true,
  }) async => (await _send(
    'POST',
    path,
    body: body,
    authenticated: authenticated,
  ))?['data'];

  Future<dynamic> patch(String path, {Object? body}) async =>
      (await _send('PATCH', path, body: body))?['data'];

  Future<dynamic> delete(String path) async =>
      (await _send('DELETE', path))?['data'];

  /// Builds `baseUrl + path`, dropping null and empty query values so callers
  /// can pass every filter unconditionally. Dates must already be strings:
  /// the CRM's date filters want the workspace's `YYYY-MM-DD`, which only the
  /// caller knows how to produce.
  Uri uri(String path, [Map<String, Object?>? query]) {
    final params = <String, String>{};
    query?.forEach((key, value) {
      if (value == null) return;
      assert(value is! DateTime, 'Format dates before passing them: $key');
      final text = '$value';
      if (text.isNotEmpty) params[key] = text;
    });
    final base = Uri.parse('$baseUrl$path');
    return params.isEmpty ? base : base.replace(queryParameters: params);
  }

  Future<Map<String, dynamic>?> _send(
    String method,
    String path, {
    Map<String, Object?>? query,
    Object? body,
    bool authenticated = true,
  }) async {
    if (!authenticated) {
      return _decode(await _perform(method, path, query, body, null));
    }

    final current = tokens.tokens;
    if (current == null) {
      _expire();
      throw ApiException.sessionEnded();
    }
    if (current.expiresWithin(renewalWindow, _now())) {
      try {
        await refresh();
      } on ApiException catch (e) {
        // A refused refresh token ends the session. Anything else (offline,
        // throttled) leaves the old access token worth one try.
        if (e.isUnauthorized) rethrow;
      }
    }

    var usedToken = tokens.tokens?.accessToken;
    var response = await _perform(method, path, query, body, usedToken);
    if (_isExpiredToken(response)) {
      // Another request may have renewed while this one was in flight; only
      // spend a refresh if the token we sent is still the current one.
      if (tokens.tokens?.accessToken == usedToken) {
        await refresh();
      }
      usedToken = tokens.tokens?.accessToken;
      response = await _perform(method, path, query, body, usedToken);
      if (_isExpiredToken(response)) {
        // A brand-new token refused too: the account's sessions were revoked
        // (password changed, signed out everywhere).
        _expire();
        throw ApiException.sessionEnded();
      }
    }
    return _decode(response);
  }

  /// A 401 about the token, as opposed to the workspace header — see
  /// [ApiException.fromResponse].
  static bool _isExpiredToken(http.Response response) {
    if (response.statusCode != 401) return false;
    final parsed = ApiException.fromResponse(401, response.body);
    return parsed.code != ApiException.tenantContextCode;
  }

  Future<http.Response> _perform(
    String method,
    String path,
    Map<String, Object?>? query,
    Object? body,
    String? accessToken,
  ) async {
    final request = http.Request(method, uri(path, query));
    request.headers['Accept'] = 'application/json';
    if (accessToken != null) {
      request.headers['Authorization'] = 'Bearer $accessToken';
      final tenantId = tokens.tenantId;
      if (tenantId != null) request.headers['x-tenant-id'] = tenantId;
      final storeId = tokens.storeId;
      if (storeId != null) request.headers['x-store-id'] = storeId;
    }
    if (body != null) {
      request.headers['Content-Type'] = 'application/json';
      request.body = jsonEncode(body);
    }

    try {
      final streamed = await _http.send(request).timeout(timeout);
      return await http.Response.fromStream(streamed).timeout(timeout);
    } on TimeoutException {
      throw ApiException.offline();
    } on http.ClientException {
      throw ApiException.offline();
    }
  }

  Map<String, dynamic>? _decode(http.Response response) {
    final status = response.statusCode;
    if (status < 200 || status >= 300) {
      throw ApiException.fromResponse(status, response.body);
    }
    if (response.bodyBytes.isEmpty) return null;
    try {
      final decoded = jsonDecode(utf8.decode(response.bodyBytes));
      if (decoded is Map<String, dynamic>) return decoded;
    } on FormatException {
      // Handled below.
    }
    throw const ApiException(
      statusCode: 502,
      message: 'ERP71 sent a response the app could not read.',
    );
  }

  /// Renews the access token with the stored refresh token. Concurrent callers
  /// share one renewal.
  Future<void> refresh() => _refreshing ??= _renew().whenComplete(() {
    _refreshing = null;
  });

  Future<void> _renew() async {
    final refreshToken = tokens.tokens?.refreshToken;
    if (refreshToken == null) {
      _expire();
      throw ApiException.sessionEnded();
    }

    final http.Response response;
    try {
      response = await _http
          .post(
            uri('/auth/refresh'),
            headers: const {
              'Accept': 'application/json',
              'Content-Type': 'application/json',
            },
            body: jsonEncode({'refresh_token': refreshToken}),
          )
          .timeout(timeout);
    } on TimeoutException {
      throw ApiException.offline();
    } on http.ClientException {
      throw ApiException.offline();
    }

    if (response.statusCode >= 200 && response.statusCode < 300) {
      final data = _decode(response)?['data'];
      if (data is! Map<String, dynamic>) {
        throw const ApiException(
          statusCode: 502,
          message: 'ERP71 sent a response the app could not read.',
        );
      }
      await tokens.saveTokens(
        SessionTokens.fromAuthResponse(data, now: _now()),
      );
      return;
    }
    if (response.statusCode == 400 ||
        response.statusCode == 401 ||
        response.statusCode == 403) {
      _expire();
      throw ApiException.sessionEnded();
    }
    // Throttled or a server fault: the session may be fine, so keep it.
    throw ApiException.fromResponse(response.statusCode, response.body);
  }

  void _expire() => onSessionExpired?.call();

  void close() => _http.close();
}
