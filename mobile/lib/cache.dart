import 'dart:convert';
import 'package:shared_preferences/shared_preferences.dart';

/// Cache local do FluxoryBox: guarda a última lista de mensagens por view/pasta e
/// a lista de contas, pra abrir o app INSTANTÂNEO (mostra o cache e sincroniza atrás).
///
/// Nada sensível aqui — só cabeçalhos (remetente/assunto/data/flags) que a API já
/// devolve; o corpo do email nunca é cacheado. Guardado em SharedPreferences como JSON.
class Cache {
  static const _accountsKey = 'cache_accounts';
  static const _prefix = 'cache_list_';
  // Limite pra não estourar o SharedPreferences (é feito pra valores pequenos).
  static const _maxItems = 60;

  // Chave estável por view+pasta. view = 'unified' ou o id (int) da conta.
  static String _key(dynamic view, String folder) => '$_prefix${view}_$folder';

  static Future<void> saveAccounts(List accounts) async {
    try {
      final p = await SharedPreferences.getInstance();
      await p.setString(_accountsKey, jsonEncode(accounts));
    } catch (_) {/* cache é best-effort */}
  }

  static Future<List> loadAccounts() async {
    try {
      final p = await SharedPreferences.getInstance();
      final s = p.getString(_accountsKey);
      if (s == null || s.isEmpty) return [];
      final v = jsonDecode(s);
      return v is List ? v : [];
    } catch (_) {
      return [];
    }
  }

  static Future<void> saveList(dynamic view, String folder, List messages) async {
    try {
      final p = await SharedPreferences.getInstance();
      final slice = messages.length > _maxItems ? messages.sublist(0, _maxItems) : messages;
      await p.setString(_key(view, folder), jsonEncode(slice));
    } catch (_) {/* best-effort */}
  }

  static Future<List> loadList(dynamic view, String folder) async {
    try {
      final p = await SharedPreferences.getInstance();
      final s = p.getString(_key(view, folder));
      if (s == null || s.isEmpty) return [];
      final v = jsonDecode(s);
      return v is List ? v : [];
    } catch (_) {
      return [];
    }
  }

  // Ao sair da conta / trocar login, limpa tudo que começa com o prefixo.
  static Future<void> clear() async {
    try {
      final p = await SharedPreferences.getInstance();
      final keys = p.getKeys().where((k) => k.startsWith(_prefix) || k == _accountsKey).toList();
      for (final k in keys) {
        await p.remove(k);
      }
    } catch (_) {}
  }
}
