import 'dart:convert';
import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:shared_preferences/shared_preferences.dart';
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

  // Handler que abre o email tocado. main.dart registra via setMessageHandler().
  // Se a notificação (app frio) chegar antes do handler existir, guarda em _pending.
  static void Function(Map<String, dynamic> data)? _onSelect;
  static Map<String, dynamic>? _pending;

  /// Registra quem abre o email ao tocar na notificação; drena o pendente (app frio).
  static void setMessageHandler(void Function(Map<String, dynamic> data) h) {
    _onSelect = h;
    final p = _pending;
    if (p != null) { _pending = null; h(p); }
  }

  // Roteia o toque: só age se tiver conta+uid (é um email de verdade).
  static void _dispatch(Map<String, dynamic>? data) {
    if (data == null) return;
    if (data['uid'] == null || data['accountId'] == null) return;
    if (_onSelect != null) { _onSelect!(data); } else { _pending = data; }
  }

  /// Inicializa Firebase + canal local. Chamar cedo no main().
  static Future<void> init() async {
    if (_ready) return;
    await Firebase.initializeApp();
    FirebaseMessaging.onBackgroundMessage(firebaseBackgroundHandler);

    const androidInit = AndroidInitializationSettings('@mipmap/ic_launcher');
    await _local.initialize(
      const InitializationSettings(android: androidInit),
      // Toque numa notificação LOCAL (foreground): payload traz o data do push.
      onDidReceiveNotificationResponse: (resp) {
        final p = resp.payload;
        if (p == null || p.isEmpty) return;
        try { _dispatch(Map<String, dynamic>.from(jsonDecode(p))); } catch (_) {}
      },
    );
    await _local
        .resolvePlatformSpecificImplementation<AndroidFlutterLocalNotificationsPlugin>()
        ?.createNotificationChannel(_channel);

    // Em foreground o sistema não mostra a notificação — mostramos manualmente,
    // carregando o data do push no payload pra saber qual email abrir no toque.
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
        payload: jsonEncode(m.data),
      );
    });

    // Toque na notificação do SISTEMA (app em background) e app aberto do zero (frio).
    FirebaseMessaging.onMessageOpenedApp.listen((m) => _dispatch(Map<String, dynamic>.from(m.data)));
    final initial = await FirebaseMessaging.instance.getInitialMessage();
    if (initial != null) _dispatch(Map<String, dynamic>.from(initial.data));

    _ready = true;
  }

  // Preferência do usuário, salva no aparelho. Sem isso o "desligado" só existia como
  // ausência do token no backend — e qualquer re-registro (boot, refresh de token)
  // ressuscitava as notificações. null = usuário nunca escolheu.
  static const _prefKey = 'notif_enabled';
  static bool _tokenListenerOn = false;

  static Future<bool?> _pref() async {
    final p = await SharedPreferences.getInstance();
    return p.containsKey(_prefKey) ? p.getBool(_prefKey) : null;
  }

  static Future<void> _setPref(bool v) async {
    final p = await SharedPreferences.getInstance();
    await p.setBool(_prefKey, v);
  }

  // Preferência de push POR CONTA, guardada no aparelho (chave = email, que é estável;
  // o `id` muda quando o backend re-semeia as contas). Guardamos só as contas SILENCIADAS
  // (ausência = ligada, o default). Necessário porque o banco da Discloud é recriado a cada
  // deploy e o `notify` de todas as contas volta ao default LIGADO — o aparelho é a fonte de
  // verdade e re-assere o silenciamento no boot (igual o token de push, que também é re-registrado).
  static const _acctOffKey = 'notif_accounts_off';

  static Future<Set<String>> _accountsOff() async {
    final p = await SharedPreferences.getInstance();
    return (p.getStringList(_acctOffKey) ?? const <String>[]).toSet();
  }

  /// Grava no aparelho se a conta (por email) deve ou não notificar.
  static Future<void> setAccountEnabled(String email, bool on) async {
    if (email.isEmpty) return;
    final p = await SharedPreferences.getInstance();
    final set = (p.getStringList(_acctOffKey) ?? const <String>[]).toSet();
    if (on) { set.remove(email); } else { set.add(email); }
    await p.setStringList(_acctOffKey, set.toList());
  }

  /// Re-aplica no backend os silenciamentos por-conta salvos no aparelho. Chamar no boot,
  /// depois de carregar as contas: se um deploy recriou o banco (notify → LIGADO), isto
  /// religa o silenciamento das contas que o usuário desativou. Corrige só o que divergir.
  static Future<void> syncAccountOverrides(List accounts) async {
    if (await _pref() == false) return; // push geral desligado: não há o que reasserir
    final off = await _accountsOff();
    if (off.isEmpty) return;
    for (final a in accounts) {
      if (a is! Map) continue;
      final email = a['email']?.toString() ?? '';
      final id = a['id'] is int ? a['id'] as int : int.tryParse('${a['id']}');
      if (email.isEmpty || id == null) continue;
      final wantOn = !off.contains(email);
      if ((a['notify'] != false) == wantOn) continue; // já está como o usuário quer
      try {
        await Api.setAccountNotify(id, wantOn);
        a['notify'] = wantOn; // reflete localmente pra a UI não mostrar divergência
      } catch (_) {/* tenta de novo no próximo boot */}
    }
  }

  /// Estado do toggle na UI: só está ligado se o usuário quer E o Android permite.
  static Future<bool> isEnabled() async {
    if (await _pref() == false) return false;
    return hasPermission();
  }

  /// Chamada no boot. Respeita o "desligado" — nunca re-registra por conta própria.
  static Future<void> registerIfEnabled() async {
    if (await _pref() == false) return;
    if (!await hasPermission()) return; // sem permissão, não insiste a cada abertura
    await requestAndRegister();
  }

  /// Pede permissão de notificação (Android 13+ / iOS) e registra o token no backend.
  /// Só deve ser chamada por ação do usuário ou por registerIfEnabled().
  static Future<bool> requestAndRegister() async {
    final messaging = FirebaseMessaging.instance;
    final settings = await messaging.requestPermission(alert: true, badge: true, sound: true);
    final granted = settings.authorizationStatus == AuthorizationStatus.authorized ||
        settings.authorizationStatus == AuthorizationStatus.provisional;
    if (!granted) return false;

    await _setPref(true);
    final token = await messaging.getToken();
    if (token != null) await _safeRegister(token);
    // Re-registra se o token rotacionar (um listener só, senão empilha a cada chamada).
    if (!_tokenListenerOn) {
      _tokenListenerOn = true;
      messaging.onTokenRefresh.listen(_safeRegister);
    }
    return true;
  }

  /// Só o status atual da permissão (sem pedir), pra UI decidir mostrar o botão.
  static Future<bool> hasPermission() async {
    final s = await FirebaseMessaging.instance.getNotificationSettings();
    return s.authorizationStatus == AuthorizationStatus.authorized ||
        s.authorizationStatus == AuthorizationStatus.provisional;
  }

  static Future<void> _safeRegister(String token) async {
    if (await _pref() == false) return; // desligado pelo usuário: não ressuscita
    try {
      await Api.registerPush(token);
    } catch (_) {/* silencioso — tenta de novo no próximo boot/refresh */}
  }

  /// Desliga o push a pedido do usuário: grava a escolha e remove o token no backend.
  static Future<void> disable() async {
    await _setPref(false);
    await unregister();
  }

  /// Remove o token no backend (no logout). Não mexe na preferência.
  static Future<void> unregister() async {
    try {
      final token = await FirebaseMessaging.instance.getToken();
      if (token != null) await Api.unregisterPush(token);
    } catch (_) {}
  }
}
