import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../features/alerts/push_tap_handler.dart';
import '../features/lock/app_lock_gate.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';
import 'router.dart';

class Erp71App extends ConsumerWidget {
  const Erp71App({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return MaterialApp.router(
      title: 'ERP71',
      debugShowCheckedModeBanner: false,
      theme: buildAppTheme(),
      themeMode: ThemeMode.light,
      scaffoldMessengerKey: rootMessengerKey,
      routerConfig: ref.watch(routerProvider),
      builder: (context, child) =>
          AppLockGate(child: PushTapHandler(child: child!)),
    );
  }
}
