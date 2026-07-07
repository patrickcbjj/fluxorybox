import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'api.dart';

// Handler de mensagem em segundo plano (app fechado/background). Precisa ser top-level
// e anotado com vm:entry-point. Mensagens do tipo "notification" o Android já mostra
// sozinho na barra; aqui não precisa fazer nada, mas o handler tem que existir.
@pragma('vm:entry-point')
Future<void> firebaseBackgroundHandler(RemoteMessage message) async {
  // Sem trabalho extra: a notificação já é exibida pelo sistema.
}

/// Serviço de notificações push (FCM) do FluxoryBox.
/// Firebase entra SÓ como canal de entrega; o backend (Discloud) detecta o email novo.
class Notifications {
  static final _local = FlutterLocalNotificationsPlugin();
  static const _channel = AndroidNotificationChannel(
    'novos_emails',
    'Novos emails',
    description: 'Notifica quando chega um email novo.',
    importance: Importance.high,
  );
  static bool _ready = false;

  /// Inicializa Firebase + canal local. Chamar cedo no main().
  static Future<void> init() async {
    if (_ready) return;
    await Firebase.initializeApp();
    FirebaseMessaging.onBackgroundMessage(firebaseBackgroundHandler);

    const androidInit = AndroidInitializationSettings('@mipmap/ic_launcher');
    await _local.initialize(const InitializationSettings(android: androidInit));
    await _local
        .resolvePlatformSpecificImplementation<AndroidFlutterLocalNotificationsPlugin>()
        ?.createNotificationChannel(_channel);

    // Em foreground o sistema não mostra a notificação — mostramos manualmente.
    FirebaseMessaging.onMessage.listen((m) {
      final n = m.notification;
      if (n == null) return;
      _local.show(
        n.hashCode,
        n.title ?? 'Novo email',
        n.body ?? '',
        NotificationDetails(
          android: AndroidNotificationDetails(
            _channel.id, _channel.name,
            channelDescription: _channel.description,
            importance: Importance.high, priority: Priority.high,
            icon: '@mipmap/ic_launcher',
          ),
        ),
      );
    });
    _ready = true;
  }

  /// Pede permissão de notificação (Android 13+ / iOS) e registra o token no backend.
  /// Chamar depois do login (quando já há sessão pra associar o token).
  static Future<bool> requestAndRegister() async {
    final messaging = FirebaseMessaging.instance;
    final settings = await messaging.requestPermission(alert: true, badge: true, sound: true);
    final granted = settings.authorizationStatus == AuthorizationStatus.authorized ||
        settings.authorizationStatus == AuthorizationStatus.provisional;
    if (!granted) return false;

    final token = await messaging.getToken();
    if (token != null) await _safeRegister(token);
    // Re-registra se o token rotacionar.
    messaging.onTokenRefresh.listen(_safeRegister);
    return true;
  }

  /// Só o status atual da permissão (sem pedir), pra UI decidir mostrar o botão.
  static Future<bool> hasPermission() async {
    final s = await FirebaseMessaging.instance.getNotificationSettings();
    return s.authorizationStatus == AuthorizationStatus.authorized ||
        s.authorizationStatus == AuthorizationStatus.provisional;
  }

  static Future<void> _safeRegister(String token) async {
    try {
      await Api.registerPush(token);
    } catch (_) {/* silencioso — tenta de novo no próximo boot/refresh */}
  }

  /// Remove o token no backend (no logout).
  static Future<void> unregister() async {
    try {
      final token = await FirebaseMessaging.instance.getToken();
      if (token != null) await Api.unregisterPush(token);
    } catch (_) {}
  }
}
