import 'dart:convert';

/// A request the API refused, or one that never reached it.
///
/// [message] is always safe to put in front of the user as-is.
class ApiException implements Exception {
  const ApiException({
    required this.statusCode,
    required this.message,
    this.code,
    this.retryAfterSeconds,
  });

  /// A request that never got an answer: no network, DNS failure, timeout.
  factory ApiException.offline() =>
      const ApiException(statusCode: 0, message: offlineMessage);

  /// The session is over and the user has to sign in again.
  factory ApiException.sessionEnded() =>
      const ApiException(statusCode: 401, message: sessionEndedMessage);

  /// The backend's global exception filter answers every error as
  /// `{"error": {"code", "message", "retry_after"?}}`, with `message` always a
  /// string. Anything else — a proxy's error page, an empty body — falls back
  /// to a generic message for the status.
  factory ApiException.fromResponse(int statusCode, String body) {
    String? message;
    String? code;
    int? retryAfter;
    try {
      final decoded = jsonDecode(body);
      final error = decoded is Map<String, dynamic> ? decoded['error'] : null;
      if (error is Map<String, dynamic>) {
        final rawMessage = error['message'];
        if (rawMessage is String) message = rawMessage.trim();
        final rawCode = error['code'];
        if (rawCode is String && rawCode.isNotEmpty) code = rawCode;
        final rawRetry = error['retry_after'];
        if (rawRetry is num) retryAfter = rawRetry.ceil();
      }
    } on FormatException {
      // Not JSON: fall through to the generic text.
    }

    // On CRM routes a missing or foreign `x-tenant-id` is a 401 too. It is not
    // an expired session, and must not be handled as one: refreshing cannot
    // fix it, and signing the user out would be the wrong cure.
    if (statusCode == 401 &&
        message != null &&
        tenantContextMessages.contains(message)) {
      return const ApiException(
        statusCode: 403,
        code: tenantContextCode,
        message:
            'You no longer have access to this workspace. '
            'Switch workspace from your account.',
      );
    }

    return ApiException(
      statusCode: statusCode,
      message: (message == null || message.isEmpty)
          ? fallbackMessage(statusCode)
          : message,
      code: code,
      retryAfterSeconds: retryAfter,
    );
  }

  static const String offlineMessage =
      "Can't reach ERP71. Check your connection and try again.";
  static const String sessionEndedMessage =
      'Your session has ended. Sign in again.';

  /// See [ApiException.fromResponse].
  static const String tenantContextCode = 'TENANT_CONTEXT';
  static const Set<String> tenantContextMessages = {
    'Missing tenant context',
    'Invalid tenant context',
  };

  /// The status the server answered with, or 0 when it could not be reached.
  final int statusCode;

  final String message;

  /// The error's `code`: the exception's own code when it set one
  /// (`PENDING_ACTIVATION`, `PASSWORD_CHANGE_REQUIRED`, …), otherwise the
  /// status name (`NOT_FOUND`, `FORBIDDEN`, …).
  final String? code;

  /// How long a rate-limited caller should wait (429s only).
  final int? retryAfterSeconds;

  bool get isOffline => statusCode == 0;
  bool get isUnauthorized => statusCode == 401;
  bool get isForbidden => statusCode == 403;
  bool get isNotFound => statusCode == 404;
  bool get isRateLimited => statusCode == 429;

  static String fallbackMessage(int statusCode) => switch (statusCode) {
    401 => sessionEndedMessage,
    403 => "You don't have permission to do that.",
    404 => 'That record no longer exists.',
    429 => 'Too many requests. Wait a minute and try again.',
    >= 500 => 'ERP71 ran into a problem. Try again in a moment.',
    _ => 'Something went wrong. Try again.',
  };

  @override
  String toString() =>
      'ApiException($statusCode${code == null ? '' : ', $code'}): $message';
}
