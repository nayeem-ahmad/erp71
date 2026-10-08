import 'dart:async';
import 'dart:convert';

import 'package:erp71_mobile/core/auth/google_auth.dart';
import 'package:erp71_mobile/core/push/push_channel.dart';
import 'package:erp71_mobile/core/security/app_lock.dart';
import 'package:erp71_mobile/core/voice/speech_input.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

const apiBase = 'https://api.test/api/v1';

typedef Handler = FutureOr<Object?> Function(http.Request request);

/// An in-memory ERP71 API. Routes answer with the backend's real envelopes:
/// `ok(data)` is `{"data": …}`, `page(items)` adds `meta`, `apiError(...)` is the
/// global exception filter's `{"error": {"code", "message"}}`.
class FakeBackend {
  final List<http.Request> requests = [];
  final Map<String, Handler> _routes = {};

  late final MockClient client = MockClient((request) async {
    requests.add(request);
    final path = request.url.path.replaceFirst('/api/v1', '');
    final handler = _match(request.method, path);
    if (handler == null) {
      return apiError(404, 'No fake route for ${request.method} $path');
    }
    final result = await handler(request);
    return result is http.Response ? result : jsonResponse(ok(result));
  });

  /// [path] may contain `:param` segments. A handler returning an
  /// [http.Response] is sent as-is; anything else is wrapped in `{data}`.
  void on(String method, String path, Handler handler) =>
      _routes['$method $path'] = handler;

  /// Requests to [path] (exact, after the API prefix), in order.
  List<http.Request> sent(String method, String path) => [
    for (final r in requests)
      if (r.method == method && r.url.path == '/api/v1$path') r,
  ];

  Map<String, dynamic> lastBody(String method, String path) =>
      jsonDecode(sent(method, path).last.body) as Map<String, dynamic>;

  Handler? _match(String method, String path) {
    final exact = _routes['$method $path'];
    if (exact != null) return exact;
    final parts = path.split('/');
    for (final entry in _routes.entries) {
      final space = entry.key.indexOf(' ');
      if (entry.key.substring(0, space) != method) continue;
      final pattern = entry.key.substring(space + 1).split('/');
      if (pattern.length != parts.length) continue;
      var matches = true;
      for (var i = 0; i < parts.length; i++) {
        if (!pattern[i].startsWith(':') && pattern[i] != parts[i]) {
          matches = false;
          break;
        }
      }
      if (matches) return entry.value;
    }
    return null;
  }
}

Map<String, Object?> ok(Object? data) => {'data': data};

http.Response jsonResponse(Object? body, [int status = 200]) =>
    http.Response.bytes(
      utf8.encode(jsonEncode(body)),
      status,
      headers: {'content-type': 'application/json; charset=utf-8'},
    );

http.Response page(
  List<Object?> items, {
  int page = 1,
  int pages = 1,
  int? total,
}) => jsonResponse({
  'data': items,
  'meta': {
    'total': total ?? items.length,
    'page': page,
    'limit': 20,
    'pages': pages,
  },
});

http.Response apiError(int status, String message, {String? code}) =>
    jsonResponse({
      'error': {'code': code ?? _statusName(status), 'message': message},
    }, status);

String _statusName(int status) => switch (status) {
  400 => 'BAD_REQUEST',
  401 => 'UNAUTHORIZED',
  403 => 'FORBIDDEN',
  404 => 'NOT_FOUND',
  429 => 'TOO_MANY_REQUESTS',
  _ => 'INTERNAL_SERVER_ERROR',
};

/// Google's picker, without the platform plugin.
class FakeGoogleAuth implements GoogleAuth {
  FakeGoogleAuth({this.idToken = 'google-id-token'});

  /// What the picker "returns": a token, or null for backing out.
  String? idToken;
  Object? error;
  String? lastServerClientId;
  int signOuts = 0;

  @override
  Future<String?> obtainIdToken({required String serverClientId}) async {
    lastServerClientId = serverClientId;
    if (error != null) throw error!;
    return idToken;
  }

  @override
  Future<void> signOut() async => signOuts++;
}

/// The phone's fingerprint, face or PIN check, answered by the test.
class FakeDeviceAuthenticator implements DeviceAuthenticator {
  FakeDeviceAuthenticator({
    this.available = true,
    this.result = DeviceAuthResult.passed,
  });

  bool available;
  DeviceAuthResult result;
  final List<String> reasons = [];

  @override
  Future<bool> isAvailable() async => available;

  @override
  Future<DeviceAuthResult> authenticate(String reason) async {
    reasons.add(reason);
    return result;
  }
}

/// Firebase, without Firebase: a test decides whether permission is given,
/// and plays taps and arrivals through the controllers.
class FakePushChannel implements PushChannel {
  FakePushChannel({this.token = 'fcm-token-1'});

  /// What `start` returns: a token, or null for "the person declined".
  String? token;
  final List<PushConfig> started = [];
  final tokenRefreshController = StreamController<String>.broadcast();
  final tapController = StreamController<PushTap>.broadcast();
  final arrivalController = StreamController<PushTap>.broadcast();
  PushTap? launch;

  @override
  Future<String?> start(PushConfig config) async {
    started.add(config);
    return token;
  }

  @override
  Stream<String> get tokenRefreshes => tokenRefreshController.stream;

  @override
  Stream<PushTap> get taps => tapController.stream;

  @override
  Stream<PushTap> get arrivals => arrivalController.stream;

  @override
  Future<PushTap?> launchTap() async => launch;
}

/// The microphone, played by the test: `say` delivers words as the
/// recognizer would, `finish` ends listening.
class FakeSpeechInput implements SpeechInput {
  FakeSpeechInput({this.available = true});

  bool available;
  String? lastLocale;
  void Function(String words, bool isFinal)? _onWords;
  void Function()? _onDone;
  bool listening = false;

  @override
  Future<bool> start({
    required String localeId,
    required void Function(String words, bool isFinal) onWords,
    required void Function() onDone,
  }) async {
    if (!available) return false;
    lastLocale = localeId;
    _onWords = onWords;
    _onDone = onDone;
    listening = true;
    return true;
  }

  void say(String words, {bool isFinal = false}) =>
      _onWords?.call(words, isFinal);

  void finish() {
    listening = false;
    _onDone?.call();
  }

  @override
  Future<void> stop() async => finish();
}
