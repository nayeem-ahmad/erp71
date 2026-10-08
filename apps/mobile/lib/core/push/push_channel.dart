import 'dart:async';

import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// GET /push/config: the client half of the Firebase project, served by the
/// API so the app ships no google-services.json and a deployment without push
/// simply leaves it off.
class PushConfig {
  const PushConfig({
    required this.enabled,
    this.projectId,
    this.apiKey,
    this.senderId,
    this.androidAppId,
    this.iosAppId,
  });

  factory PushConfig.fromJson(Map<String, dynamic> json) => PushConfig(
    enabled: json['enabled'] == true,
    projectId: json['project_id'] as String?,
    apiKey: json['api_key'] as String?,
    senderId: json['sender_id'] as String?,
    androidAppId: json['android_app_id'] as String?,
    iosAppId: json['ios_app_id'] as String?,
  );

  final bool enabled;
  final String? projectId;
  final String? apiKey;
  final String? senderId;
  final String? androidAppId;
  final String? iosAppId;

  /// The Firebase app id for [platform], or null when that platform is not
  /// set up on the server.
  String? appIdFor(TargetPlatform platform) => switch (platform) {
    TargetPlatform.android => androidAppId,
    TargetPlatform.iOS => iosAppId,
    _ => null,
  };
}

/// A notification the person tapped, or one that arrived with the app open.
/// The keys are those the backend's NotificationsService puts in `data`.
class PushTap {
  const PushTap(this.data, {this.title, this.body});

  final Map<String, String> data;
  final String? title;
  final String? body;

  String? get tenantId => data['tenant_id'];
  String? get notificationId => data['notification_id'];
  String? get link => data['link'];
}

/// The phone's push service. An interface so tests run without Firebase.
abstract class PushChannel {
  /// Starts push with [config] and asks the person's permission. Returns the
  /// device's token, or null when they declined or the platform is not set up.
  Future<String?> start(PushConfig config);

  /// New tokens after the first: Firebase rotates them now and then.
  Stream<String> get tokenRefreshes;

  /// Notifications tapped while the app was in the background.
  Stream<PushTap> get taps;

  /// Notifications that arrived while the app was open, which the system
  /// does not show on its own.
  Stream<PushTap> get arrivals;

  /// The notification whose tap launched the app, once.
  Future<PushTap?> launchTap();
}

class FirebasePushChannel implements PushChannel {
  bool _started = false;

  @override
  Future<String?> start(PushConfig config) async {
    final appId = config.appIdFor(defaultTargetPlatform);
    if (!config.enabled || appId == null) return null;
    if (!_started) {
      if (Firebase.apps.isEmpty) {
        await Firebase.initializeApp(
          options: FirebaseOptions(
            apiKey: config.apiKey!,
            appId: appId,
            messagingSenderId: config.senderId!,
            projectId: config.projectId!,
          ),
        );
      }
      _started = true;
    }
    final messaging = FirebaseMessaging.instance;
    final settings = await messaging.requestPermission();
    if (settings.authorizationStatus == AuthorizationStatus.denied) {
      return null;
    }
    return messaging.getToken();
  }

  @override
  Stream<String> get tokenRefreshes => _started
      ? FirebaseMessaging.instance.onTokenRefresh
      : const Stream.empty();

  @override
  Stream<PushTap> get taps => _started
      ? FirebaseMessaging.onMessageOpenedApp.map(_tap)
      : const Stream.empty();

  @override
  Stream<PushTap> get arrivals =>
      _started ? FirebaseMessaging.onMessage.map(_tap) : const Stream.empty();

  @override
  Future<PushTap?> launchTap() async {
    if (!_started) return null;
    final message = await FirebaseMessaging.instance.getInitialMessage();
    return message == null ? null : _tap(message);
  }

  static PushTap _tap(RemoteMessage message) => PushTap(
    {
      for (final entry in message.data.entries)
        entry.key: entry.value.toString(),
    },
    title: message.notification?.title,
    body: message.notification?.body,
  );
}

final pushChannelProvider = Provider<PushChannel>(
  (ref) => FirebasePushChannel(),
);
