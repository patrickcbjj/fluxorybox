// FluxoryBox — web client
const API = '';
let TOKEN = localStorage.getItem('mail_token') || '';
let accounts = [];
let currentMessages = [];
let view = 'unified';        // 'unified' | accountId(number)
let openUid = null;
let currentFolder = 'INBOX'; // pasta ativa quando uma conta está selecionada
let folders = [];            // pastas da conta selecionada
let offset = 0;              // paginação (conta+pasta)
let unifiedLimit = 40;       // limite da caixa unificada
const PAGE = 25;

const el = (id) => document.getElementById(id);

// ---------- Ícones SVG (stroke, currentColor) ----------
const S = (p, o = '') => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" ${o}>${p}</svg>`;
const ICONS = {
  mark: S('<path d="M3 8l9 6 9-6"/><rect x="3" y="5" width="18" height="14" rx="3"/>'),
  inbox: S('<path d="M3 12h5l2 3h4l2-3h5"/><path d="M5 6h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z"/>'),
  search: S('<circle cx="11" cy="11" r="7"/><path d="M21 21l-4-4"/>'),
  refresh: S('<path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/>'),
  pencil: S('<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>'),
  send: S('<path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4z"/>'),
  reply: S('<path d="M9 17l-6-5 6-5"/><path d="M3 12h10a6 6 0 0 1 6 6v1"/>'),
  archive: S('<rect x="3" y="4" width="18" height="4" rx="1"/><path d="M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8"/><path d="M10 12h4"/>'),
  trash: S('<path d="M3 6h18"/><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2"/><path d="M6 6l1 14a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-14"/>'),
  gear: S('<circle cx="12" cy="12" r="3.2"/><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V21a2 2 0 1 1-4 0v-.1A1.6 1.6 0 0 0 6.8 19.4l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0-1.1-2.7H2a2 2 0 1 1 0-4h.1A1.6 1.6 0 0 0 4.6 6.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V2a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 2.7 1.1l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H22a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z"/>'),
  logout: S('<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/>'),
  plus: S('<path d="M12 5v14M5 12h14"/>'),
  x: S('<path d="M18 6L6 18M6 6l12 12"/>'),
  back: S('<path d="M15 18l-6-6 6-6"/>'),
  attach: S('<path d="M21.4 11.05l-8.5 8.5a5 5 0 0 1-7.1-7.1l8.5-8.5a3.3 3.3 0 0 1 4.7 4.7l-8.5 8.5a1.7 1.7 0 0 1-2.4-2.4l7.9-7.9"/>'),
  folder: S('<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>'),
  star: S('<path d="M12 3l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8L3.5 9.2l5.9-.9z"/>'),
  starFill: '<svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"><path d="M12 3l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8L3.5 9.2l5.9-.9z"/></svg>',
  forward: S('<path d="M15 17l5-5-5-5"/><path d="M20 12H9a6 6 0 0 0-6 6v1"/>'),
  unread: S('<path d="M4 4h16v16H4z" opacity="0"/><path d="M3 7l9 6 9-6"/><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="19" cy="6" r="3" fill="currentColor" stroke="none"/>'),
  download: S('<path d="M12 3v12"/><path d="M7 12l5 5 5-5"/><path d="M5 21h14"/>'),
  chevron: S('<path d="M6 9l6 6 6-6"/>'),
  listUl: S('<path d="M8 6h13M8 12h13M8 18h13"/><circle cx="3.5" cy="6" r="1.2" fill="currentColor" stroke="none"/><circle cx="3.5" cy="12" r="1.2" fill="currentColor" stroke="none"/><circle cx="3.5" cy="18" r="1.2" fill="currentColor" stroke="none"/>'),
  listOl: S('<path d="M10 6h11M10 12h11M10 18h11"/><path d="M4 4v3.5M3 4h1.2M3 8h2M3 12.5h2l-2 3h2"/>'),
  link: S('<path d="M9 15l6-6"/><path d="M11 6l1-1a4 4 0 0 1 6 6l-1 1"/><path d="M13 18l-1 1a4 4 0 0 1-6-6l1-1"/>'),
  eraser: S('<path d="M4 4h16M6 8l4 12M14 8l-4 12M9 8h6"/>'),
  alert: S('<path d="M12 9v4"/><path d="M12 17h.01"/><path d="M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/>'),
};
const BRAND = {
  microsoft: '<svg viewBox="0 0 23 23"><path fill="#f25022" d="M1 1h10v10H1z"/><path fill="#7fba00" d="M12 1h10v10H12z"/><path fill="#00a4ef" d="M1 12h10v10H1z"/><path fill="#ffb900" d="M12 12h10v10H12z"/></svg>',
  google: '<svg viewBox="0 0 24 24"><path fill="#4285F4" d="M22.5 12.2c0-.7-.1-1.4-.2-2H12v3.9h5.9a5 5 0 0 1-2.2 3.3v2.7h3.6c2.1-2 3.2-4.9 3.2-7.9z"/><path fill="#34A853" d="M12 23c2.9 0 5.4-1 7.2-2.6l-3.6-2.7c-1 .7-2.3 1-3.6 1-2.8 0-5.1-1.9-6-4.4H2.3v2.8A11 11 0 0 0 12 23z"/><path fill="#FBBC05" d="M6 14.3a6.6 6.6 0 0 1 0-4.2V7.3H2.3a11 11 0 0 0 0 9.8z"/><path fill="#EA4335" d="M12 5.4c1.6 0 3 .5 4.1 1.6l3.1-3.1A11 11 0 0 0 2.3 7.3L6 10.1c.9-2.6 3.2-4.5 6-4.5z"/></svg>',
};
function ico(name, cls = '') { return `<span class="ic ${cls}">${ICONS[name] || ''}</span>`; }

// Tooltip flutuante (email ao passar o mouse na bolinha)
let tipEl;
function attachTip(node, text) {
  if (!tipEl) { tipEl = document.createElement('div'); tipEl.className = 'tip'; document.body.appendChild(tipEl); }
  node.addEventListener('mouseenter', () => {
    tipEl.textContent = text; tipEl.style.display = 'block';
    const r = node.getBoundingClientRect();
    tipEl.style.top = (r.top + r.height / 2) + 'px';
    tipEl.style.left = (r.right + 12) + 'px';
  });
  node.addEventListener('mouseleave', () => { if (tipEl) tipEl.style.display = 'none'; });
}

// Confirmação própria (o confirm() nativo pode ser bloqueado pelo navegador)
function uiConfirm(message, okLabel = 'Remover') {
  return new Promise((resolve) => {
    const ov = document.createElement('div'); ov.className = 'modal';
    ov.innerHTML = `<div class="modal-card" style="width:340px">
      <div class="modal-head"><h2>Confirmar</h2></div>
      <p style="color:var(--muted);margin:0 0 18px;font-size:14px">${esc(message)}</p>
      <div class="modal-actions"><button class="ghost" data-no>Cancelar</button><button class="primary" data-yes>${esc(okLabel)}</button></div>
    </div>`;
    document.body.appendChild(ov);
    const done = (v) => { ov.remove(); resolve(v); };
    ov.querySelector('[data-yes]').onclick = () => done(true);
    ov.querySelector('[data-no]').onclick = () => done(false);
    ov.addEventListener('click', (e) => { if (e.target === ov) done(false); });
  });
}

// ---------- Utils ----------
async function api(path, opts = {}) {
  const headers = { ...(TOKEN ? { Authorization: 'Bearer ' + TOKEN } : {}), ...(opts.headers || {}) };
  if (opts.body) headers['Content-Type'] = 'application/json'; // sem corpo, não manda (evita 400 no DELETE)
  const res = await fetch(API + path, { ...opts, headers });
  if (res.status === 401) { showGate('Sua sessão expirou. Entre novamente.'); throw new Error('401'); }
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    const err = new Error(e.error || 'Não foi possível completar a ação. Tente de novo.');
    err.code = e.code; err.needsReconnect = !!e.needsReconnect;
    throw err;
  }
  return res.status === 204 ? null : res.json();
}
function esc(s) { return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function fmtDate(d) {
  if (!d) return '';
  const date = new Date(d), now = new Date();
  if (date.toDateString() === now.toDateString()) return date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  if (date.getFullYear() === now.getFullYear()) return date.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
  return date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' });
}
// Cor estável a partir de uma string.
function hue(str) { let h = 0; for (const c of String(str)) h = (h * 31 + c.charCodeAt(0)) % 360; return h; }
function accColor(email) { return `hsl(${hue(email)} 62% 52%)`; }
function initials(name, email) {
  const base = (name && name.trim()) || email || '?';
  const parts = base.replace(/[<>]/g, '').trim().split(/[\s@.]+/).filter(Boolean);
  return ((parts[0]?.[0] || '') + (parts[1]?.[0] || '')).toUpperCase() || base[0].toUpperCase();
}
function accountById(id) { return accounts.find((a) => a.id === id); }

// Avatar (foto ou iniciais). size opcional via classe.
function avatarHtml(acc, cls = 'msg-avatar') {
  if (acc?.avatarUrl) return `<span class="${cls}"><img src="${esc(acc.avatarUrl)}" alt="" referrerpolicy="no-referrer"></span>`;
  const email = acc?.email || '';
  return `<span class="${cls}" style="background:${accColor(email)}">${esc(initials(acc?.displayName, email))}</span>`;
}
// Avatar para um remetente qualquer (na lista), colorido pelo endereço.
function senderAvatar(name, address) {
  return `<span class="msg-avatar" style="background:${accColor(address || name)}">${esc(initials(name, address))}</span>`;
}

// ---------- Gate ----------
function showGate(msg) { el('gate').classList.remove('hidden'); el('app').classList.add('hidden'); if (msg) el('gateErr').textContent = msg; }
function hideGate() { el('gate').classList.add('hidden'); el('app').classList.remove('hidden'); }
el('gateMark').innerHTML = '<img src="/logo.svg" alt="FluxoryBox" style="width:100%;height:100%;border-radius:13px">';
el('brandMark').innerHTML = '<img src="/logo.svg" alt="FluxoryBox" style="width:100%;height:100%;border-radius:9px">';
async function doLogin() {
  el('gateErr').textContent = '';
  const username = el('userInput').value.trim();
  const password = el('passInput').value;
  try {
    const res = await fetch('/api/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    if (!res.ok) { const e = await res.json().catch(() => ({})); el('gateErr').textContent = e.error || 'Falha no login'; return; }
    const d = await res.json();
    TOKEN = d.token; localStorage.setItem('mail_token', TOKEN);
    await start();
  } catch (e) { el('gateErr').textContent = e.message; }
}
el('loginBtn').onclick = doLogin;
el('passInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') doLogin(); });
el('userInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') el('passInput').focus(); });
el('logoutBtn').onclick = () => { localStorage.removeItem('mail_token'); TOKEN = ''; showGate(''); };
el('logoutBtn').innerHTML = ICONS.logout;
el('manageBtn').innerHTML = ICONS.gear;
el('refreshBtn').innerHTML = ICONS.refresh;
el('searchIc').innerHTML = ICONS.search;
el('composeIc').innerHTML = ICONS.pencil;
el('sendIc').innerHTML = ICONS.send;
el('cpAttachIc').innerHTML = ICONS.attach;
// Ícones dos botões da barra do editor.
{
  const tbIcons = { insertUnorderedList: ICONS.listUl, insertOrderedList: ICONS.listOl, createLink: ICONS.link, removeFormat: ICONS.eraser };
  document.querySelectorAll('#cpToolbar .tb[data-cmd]').forEach((b) => { const i = tbIcons[b.dataset.cmd]; if (i) b.innerHTML = i; });
}

// ---------- Régua de contas ----------
function renderRail() {
  const rail = el('rail');
  let html = `<div class="rail-item ${view === 'unified' ? 'active' : ''}" data-view="unified">
    <span class="avatar all">${ICONS.inbox}</span></div>`;
  for (const a of accounts) {
    const active = view === a.id ? 'active' : '';
    const warn = a.disconnected ? `<span class="rail-warn" title="Conta desconectada">!</span>` : '';
    html += `<div class="rail-item ${active} ${a.disconnected ? 'disc' : ''}" data-id="${a.id}" style="--pill:${accColor(a.email)}">
      ${avatarHtml(a, 'avatar')}${warn}</div>`;
  }
  html += `<div class="rail-item" id="railAdd"><span class="avatar add">${ICONS.plus}</span></div>`;
  rail.innerHTML = html;
  rail.querySelectorAll('.rail-item[data-view]').forEach((n) => { n.onclick = () => selectView('unified'); attachTip(n, 'Todas as contas'); });
  rail.querySelectorAll('.rail-item[data-id]').forEach((n) => {
    n.onclick = () => selectView(Number(n.dataset.id));
    const a = accountById(Number(n.dataset.id));
    attachTip(n, a ? a.email : '');
  });
  el('railAdd').onclick = openAddModal;
  attachTip(el('railAdd'), 'Adicionar conta');
}

function selectView(v) {
  view = v; openUid = null; currentFolder = 'INBOX'; offset = 0; unifiedLimit = 40; folders = [];
  renderRail();
  const acc = typeof v === 'number' ? accountById(v) : null;
  el('ctxTitle').textContent = acc ? (acc.displayName || acc.email) : 'Todas as contas';
  document.documentElement.style.setProperty('--pill', acc ? accColor(acc.email) : 'var(--accent)');
  el('reader').classList.remove('open');
  el('reader').innerHTML = `<div class="reader-empty">Selecione uma mensagem para ler</div>`;
  el('folderBtn').classList.toggle('hidden', !acc);
  el('folderMenu').classList.add('hidden');
  el('folderName').textContent = 'Caixa de entrada';
  el('folderChev').innerHTML = ICONS.chevron;
  loadList(true);
  if (acc) loadFolders(acc.id);
}

// ---------- Pastas ----------
const FOLDER_LABELS = { '\\Inbox': 'Caixa de entrada', '\\Sent': 'Enviados', '\\Drafts': 'Rascunhos', '\\Junk': 'Spam', '\\Trash': 'Lixeira', '\\Archive': 'Arquivo', '\\All': 'Todos os emails' };
function folderLabel(f) { return FOLDER_LABELS[f.specialUse] || (f.path === 'INBOX' ? 'Caixa de entrada' : f.name); }
async function loadFolders(id) { try { folders = await api(`/api/accounts/${id}/folders`); } catch { folders = []; } }
el('folderBtn').onclick = () => {
  const menu = el('folderMenu');
  if (!menu.classList.contains('hidden')) { menu.classList.add('hidden'); return; }
  const items = folders.length ? folders : [{ path: 'INBOX', name: 'INBOX' }];
  menu.innerHTML = items.map((f) => `<button data-path="${esc(f.path)}" class="${f.path === currentFolder ? 'active' : ''}">${ICONS.folder}${esc(folderLabel(f))}</button>`).join('');
  menu.querySelectorAll('button').forEach((b) => b.onclick = () => {
    currentFolder = b.dataset.path; offset = 0;
    el('folderName').textContent = b.textContent.trim();
    menu.classList.add('hidden');
    loadList(true);
  });
  menu.classList.remove('hidden');
};
document.addEventListener('click', (e) => {
  if (!el('folderBtn').contains(e.target) && !el('folderMenu').contains(e.target)) el('folderMenu').classList.add('hidden');
});

// ---------- Contas ----------
async function loadAccounts() {
  accounts = await api('/api/accounts');
  renderRail();
  el('cpFrom').innerHTML = accounts.map((a) => `<option value="${a.id}">${esc(a.displayName || a.email)} — ${esc(a.email)}</option>`).join('');
}

// ---------- Lista de mensagens ----------
async function loadList(reset = true) {
  if (reset) { offset = 0; el('messageList').innerHTML = `<div class="loader"><div class="spinner"></div></div>`; }
  try {
    if (view === 'unified') {
      const data = await api(`/api/inbox?limit=${unifiedLimit}`);
      currentMessages = data.messages || [];
    } else {
      const data = await api(`/api/accounts/${view}/messages?folder=${encodeURIComponent(currentFolder)}&limit=${PAGE}&offset=${offset}`);
      const page = data.messages || [];
      currentMessages = (reset || offset === 0) ? page : currentMessages.concat(page);
    }
    markKnown(currentMessages); // baseline: não notifica o que já estava lá
    renderList(currentFiltered());
  } catch (e) {
    const acc = typeof view === 'number' ? accountById(view) : null;
    let html = `<div class="empty err">${esc(e.message)}`;
    if (e.needsReconnect && acc) html += `<div style="margin-top:14px"><button class="primary" id="reconnBtn">Reconectar ${esc(acc.email)}</button></div>`;
    html += `</div>`;
    el('messageList').innerHTML = html;
    const rb = el('reconnBtn'); if (rb) rb.onclick = () => reconnectAccount(acc);
  }
}
async function loadMore(btn) {
  btn.textContent = 'Carregando...';
  if (view === 'unified') { unifiedLimit += 40; } else { offset += PAGE; }
  await loadList(false);
}
function renderList(msgs) {
  el('ctxCount').textContent = msgs.length ? `${msgs.length} mensagens` : '';
  if (!msgs.length) { el('messageList').innerHTML = `<div class="empty">Nenhuma mensagem por aqui.</div>`; return; }
  const rows = msgs.map((m, i) => {
    const f = m.from[0] || {}; const from = f.name || f.address || '(desconhecido)';
    const showTag = view === 'unified';
    const star = m.flagged ? `<span class="star-dot" title="Favorito">${ICONS.starFill}</span>` : '';
    return `<div class="msg ${m.seen ? '' : 'unread'} ${m.uid === openUid ? 'active' : ''}" data-i="${i}"
        style="--pill:${accColor(m.accountEmail || '')}">
      ${senderAvatar(f.name, f.address)}
      <div class="msg-body">
        <div class="msg-row"><span class="msg-from">${esc(from)}</span><span class="msg-date">${star}${fmtDate(m.date)}</span></div>
        <div class="msg-subject">${esc(m.subject)}</div>
        ${showTag ? `<div class="msg-acc"><span class="tag" style="background:${accColor(m.accountEmail || '')}"></span>${esc(m.accountEmail || '')}</div>` : ''}
      </div>
    </div>`;
  }).join('');
  el('messageList').innerHTML = rows + `<div class="load-more"><button id="loadMoreBtn">Carregar mais</button></div>`;
  el('messageList').querySelectorAll('.msg').forEach((n) => n.onclick = () => openMessage(msgs[Number(n.dataset.i)]));
  const lm = el('loadMoreBtn'); if (lm) lm.onclick = () => loadMore(lm);
  renderReconnectBanner();
}

// ---------- Contas desconectadas / reconexão ----------
function disconnectedAccounts() {
  if (typeof view === 'number') { const a = accountById(view); return a && a.disconnected ? [a] : []; }
  return accounts.filter((a) => a.disconnected);
}
function renderReconnectBanner() {
  const old = el('reconnectBanner'); if (old) old.remove();
  const list = disconnectedAccounts();
  if (!list.length) return;
  const wrap = document.createElement('div');
  wrap.id = 'reconnectBanner'; wrap.className = 'reconnect-banner';
  wrap.innerHTML = list.map((a, i) => `
    <div class="rb-row">
      <span class="rb-ic">${ICONS.alert}</span>
      <div class="rb-text"><b>${esc(a.displayName || a.email)}</b> foi desconectada. ${esc(a.statusMessage || 'Reconecte para voltar a receber os emails.')}</div>
      <button class="rb-btn" data-i="${i}">Reconectar</button>
    </div>`).join('');
  el('messageList').prepend(wrap);
  wrap.querySelectorAll('.rb-btn').forEach((b) => b.onclick = () => reconnectAccount(list[Number(b.dataset.i)]));
}
function reconnectAccount(acc) {
  if (!acc) return;
  if (acc.authType === 'oauth' && acc.provider) {
    startOAuth(acc.provider); // reabre o fluxo Microsoft/Google
  } else {
    openAddModal();
    el('accEmail').value = acc.email;
    el('accName').value = acc.displayName || '';
    el('accResult').innerHTML = `Digite a senha de app novamente para reconectar <b>${esc(acc.email)}</b>.`;
    el('accPass').focus();
  }
}

// ---------- Leitor ----------
async function openMessage(m) {
  openUid = m.uid;
  el('messageList').querySelectorAll('.msg.active').forEach((n) => n.classList.remove('active'));
  el('messageList').querySelectorAll('.msg').forEach((n) => { if (currentMessages[Number(n.dataset.i)]?.uid === m.uid) { n.classList.add('active'); n.classList.remove('unread'); } });
  const reader = el('reader');
  reader.classList.add('open');
  reader.innerHTML = `<div class="loader"><div class="spinner"></div></div>`;
  try {
    const full = await api(`/api/accounts/${m.accountId}/messages/${m.uid}?folder=${encodeURIComponent(m.folder)}`);
    const f = full.from[0] || {};
    reader.innerHTML = `
      <div class="reader-inner">
        <button class="ghost reader-back" id="backBtn">${ico('back')} Voltar</button>
        <h1>${esc(full.subject)}</h1>
        <div class="reader-meta">
          ${senderAvatar(f.name, f.address)}
          <div><div class="reader-from">${esc(f.name || f.address)}</div>
          <div class="reader-sub">${esc(f.address || '')} · ${new Date(full.date).toLocaleString('pt-BR')}</div></div>
        </div>
        <div class="reader-actions">
          <button class="ghost star-btn ${m.flagged ? 'on' : ''}" id="starBtn">${m.flagged ? ICONS.starFill : ICONS.star} ${m.flagged ? 'Favorito' : 'Favoritar'}</button>
          <button class="ghost" id="replyBtn">${ico('reply')} Responder</button>
          <button class="ghost" id="replyAllBtn">${ico('reply')} Resp. todos</button>
          <button class="ghost" id="fwdBtn">${ico('forward')} Encaminhar</button>
          <button class="ghost" id="unreadBtn">${ico('unread')} Não lido</button>
          <button class="ghost" id="archiveBtn">${ico('archive')} Arquivar</button>
          <button class="ghost" id="delBtn">${ico('trash')} Lixeira</button>
        </div>
        ${full.attachments.length ? `<div class="reader-attach" id="attachBox">${ico('attach')} ${full.attachments.map((a, i) => `<a href="#" data-att="${i}">${ICONS.download}${esc(a.filename)}</a>`).join('')}</div>` : ''}
        <div id="mailBody"></div>
      </div>`;
    const body = el('mailBody');
    if (full.html) {
      const frameWrap = document.createElement('div'); frameWrap.className = 'mail-frame-wrap';
      const iframe = document.createElement('iframe');
      iframe.className = 'mail-frame'; iframe.setAttribute('sandbox', 'allow-same-origin'); iframe.style.height = '200px';
      frameWrap.appendChild(iframe); body.appendChild(frameWrap);
      iframe.onload = () => {
        try {
          const doc = iframe.contentDocument;
          const st = doc.createElement('style');
          st.textContent = 'html,body{margin:0;padding:14px;font-family:Segoe UI,Arial,sans-serif;color:#111;word-break:break-word}img{max-width:100%!important;height:auto}table{max-width:100%!important}*{max-width:100%!important;box-sizing:border-box}';
          (doc.head || doc.body).appendChild(st);
          iframe.style.height = Math.min(doc.body.scrollHeight + 20, 4000) + 'px';
        } catch (_) {}
      };
      iframe.srcdoc = full.html;
    } else {
      body.innerHTML = `<div class="mail-text">${esc(full.text || '(sem conteúdo)')}</div>`;
    }
    el('backBtn').onclick = () => reader.classList.remove('open');
    el('replyBtn').onclick = () => openCompose({ accountId: m.accountId, to: f.address, subject: reSubject(full.subject), body: quote(full) });
    el('replyAllBtn').onclick = () => openCompose({ accountId: m.accountId, to: f.address, cc: replyAllCc(full, m), subject: reSubject(full.subject), body: quote(full) });
    el('fwdBtn').onclick = () => openCompose({ accountId: m.accountId, subject: fwdSubject(full.subject), body: quote(full, true) });
    el('archiveBtn').onclick = () => moveMsg(m, 'Archive');
    el('delBtn').onclick = () => moveMsg(m, 'Trash');
    // Favoritar
    el('starBtn').onclick = async () => {
      const on = !m.flagged;
      await api(`/api/accounts/${m.accountId}/messages/${m.uid}/flags?folder=${encodeURIComponent(m.folder)}`, {
        method: 'POST', body: JSON.stringify(on ? { add: ['\\Flagged'] } : { remove: ['\\Flagged'] }),
      });
      m.flagged = on;
      el('starBtn').classList.toggle('on', on);
      el('starBtn').innerHTML = `${on ? ICONS.starFill : ICONS.star} ${on ? 'Favorito' : 'Favoritar'}`;
      const li = [...currentMessages].find((x) => x.uid === m.uid); if (li) li.flagged = on;
      renderList(currentFiltered());
    };
    // Marcar não lido e voltar
    el('unreadBtn').onclick = async () => {
      await api(`/api/accounts/${m.accountId}/messages/${m.uid}/flags?folder=${encodeURIComponent(m.folder)}`, {
        method: 'POST', body: JSON.stringify({ remove: ['\\Seen'] }),
      });
      m.seen = false; reader.classList.remove('open'); openUid = null; loadList(false);
    };
    // Baixar anexos (via fetch com token → blob)
    const attBox = el('attachBox');
    if (attBox) attBox.querySelectorAll('a[data-att]').forEach((a) => a.onclick = async (ev) => {
      ev.preventDefault();
      const idx = a.dataset.att;
      try {
        const res = await fetch(`/api/accounts/${m.accountId}/messages/${m.uid}/attachment/${idx}?folder=${encodeURIComponent(m.folder)}`, { headers: { Authorization: 'Bearer ' + TOKEN } });
        if (!res.ok) throw new Error('falha ao baixar');
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url; link.download = full.attachments[idx].filename || 'anexo';
        document.body.appendChild(link); link.click(); link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 4000);
      } catch (e) { alert('Falha ao baixar anexo: ' + e.message); }
    });
  } catch (e) {
    reader.innerHTML = `<div class="empty err">${esc(e.message)}</div>`;
  }
}

// Helpers de resposta/encaminhamento
function reSubject(s) { return /^re:/i.test(s || '') ? s : 'Re: ' + (s || ''); }
function fwdSubject(s) { return /^fwd?:/i.test(s || '') ? s : 'Fwd: ' + (s || ''); }
function quote(full, forward = false) {
  const f = full.from[0] || {};
  const header = forward
    ? `\n\n---------- Mensagem encaminhada ----------\nDe: ${f.name || ''} <${f.address || ''}>\nData: ${full.date ? new Date(full.date).toLocaleString('pt-BR') : ''}\nAssunto: ${full.subject || ''}\n\n`
    : `\n\nEm ${full.date ? new Date(full.date).toLocaleString('pt-BR') : ''}, ${f.name || f.address || ''} escreveu:\n`;
  const text = (full.text || '').split('\n').map((l) => '> ' + l).join('\n');
  return header + (forward ? (full.text || '') : text);
}
function replyAllCc(full, m) {
  const mine = (accountById(m.accountId) || {}).email;
  const all = [...(full.to || []), ...(full.cc || [])].map((x) => x.address).filter((a) => a && a.toLowerCase() !== (mine || '').toLowerCase());
  return [...new Set(all)].join(', ');
}
async function moveMsg(m, target) {
  try {
    await api(`/api/accounts/${m.accountId}/messages/${m.uid}/move?folder=${encodeURIComponent(m.folder)}`, { method: 'POST', body: JSON.stringify({ target }) });
    el('reader').innerHTML = `<div class="reader-empty">Mensagem movida.</div>`;
    el('reader').classList.remove('open'); loadList();
  } catch (e) { alert('Falha ao mover: ' + e.message); }
}

// ---------- Busca ----------
// Filtro instantâneo (client-side) sobre o que já está carregado.
function currentFiltered() {
  if (serverSearching) return currentMessages; // já são resultados do servidor
  const q = el('search').value.trim().toLowerCase();
  if (!q) return currentMessages;
  return currentMessages.filter((m) => {
    const f = m.from[0] || {};
    return (m.subject || '').toLowerCase().includes(q) || (f.address || '').toLowerCase().includes(q) || (f.name || '').toLowerCase().includes(q);
  });
}
let serverSearching = false;
el('search').oninput = () => {
  if (serverSearching) { if (!el('search').value.trim()) clearServerSearch(); return; }
  renderList(currentFiltered());
};
// Enter → busca no servidor (IMAP SEARCH), inclusive no corpo das mensagens.
el('search').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); serverSearch(); }
  if (e.key === 'Escape') clearServerSearch();
});
async function serverSearch() {
  const q = el('search').value.trim();
  if (!q) { clearServerSearch(); return; }
  serverSearching = true;
  el('messageList').innerHTML = `<div class="loader"><div class="spinner"></div></div>`;
  try {
    const path = view === 'unified'
      ? `/api/search?q=${encodeURIComponent(q)}`
      : `/api/accounts/${view}/search?folder=${encodeURIComponent(currentFolder)}&q=${encodeURIComponent(q)}`;
    const data = await api(path);
    currentMessages = data.messages || [];
    renderList(currentMessages);
    renderSearchBanner(q, currentMessages.length); // depois do renderList (que reescreve a lista)
  } catch (e) {
    el('messageList').innerHTML = `<div class="empty err">${esc(e.message)}</div>`;
  }
}
function renderSearchBanner(q, n) {
  const head = el('messageList');
  // O renderList substitui o innerHTML; o banner é injetado antes.
  const wrap = document.createElement('div');
  wrap.id = 'searchBanner'; wrap.className = 'search-banner';
  wrap.innerHTML = `<span>Resultados no servidor para "<b>${esc(q)}</b>" · ${n}</span><button id="clearSearch">Limpar</button>`;
  head.prepend(wrap);
  el('clearSearch').onclick = clearServerSearch;
}
function clearServerSearch() {
  serverSearching = false;
  el('search').value = '';
  loadList(true);
}
el('refreshBtn').onclick = () => { serverSearching = false; loadList(true); };

// ---------- Notificações (Web Notifications API) ----------
let knownIds = null; // Set de "accountId:uid" já conhecidos (null até o 1º carregamento)
function msgKey(m) { return `${m.accountId}:${m.uid}`; }
function markKnown(msgs) { knownIds = new Set(msgs.map(msgKey)); }
// Pede permissão de notificação (uma vez, se ainda não decidido).
function ensureNotifyPermission() {
  try {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  } catch (_) {}
}
function notifyNew(msgs) {
  if (!('Notification' in window) || Notification.permission !== 'granted' || knownIds === null) return;
  const novos = msgs.filter((m) => !knownIds.has(msgKey(m)) && m.seen !== true).slice(0, 5);
  for (const m of novos) {
    const f = (m.from && m.from[0]) || {};
    try {
      const n = new Notification(f.name || f.address || 'Novo email', {
        body: m.subject || '(sem assunto)', tag: msgKey(m), icon: '/favicon-180.png',
      });
      n.onclick = () => { window.focus(); openMessage(m); n.close(); };
    } catch (_) {}
  }
}

// ---------- Tempo real (polling + foco) ----------
let pollTimer = null;
function startPolling() { if (pollTimer) clearInterval(pollTimer); pollTimer = setInterval(refreshSilent, 30000); }
async function refreshSilent() {
  if (!el('gate').classList.contains('hidden')) return; // só quando logado (roda mesmo com aba em 2º plano)
  // Atualiza o estado de conexão das contas (aviso de desconectada) sem barulho.
  try { const fresh = await api('/api/accounts'); if (Array.isArray(fresh)) { accounts = fresh; renderRail(); } } catch (_) {}
  const listEl = el('messageList');
  const scroll = listEl.scrollTop;
  try {
    if (view === 'unified') {
      const data = await api(`/api/inbox?limit=${unifiedLimit}`);
      currentMessages = data.messages || [];
    } else {
      const span = Math.max(PAGE, offset + PAGE);
      const data = await api(`/api/accounts/${view}/messages?folder=${encodeURIComponent(currentFolder)}&limit=${span}&offset=0`);
      currentMessages = data.messages || [];
    }
    notifyNew(currentMessages);  // avisa antes de atualizar a baseline
    markKnown(currentMessages);
    if (!serverSearching) { renderList(currentFiltered()); listEl.scrollTop = scroll; }
  } catch (_) { /* silencioso */ }
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshSilent(); });

// ---------- Modais util ----------
document.querySelectorAll('[data-close]').forEach((b) => b.onclick = () => el(b.dataset.close).classList.add('hidden'));
document.querySelectorAll('.x').forEach((b) => b.innerHTML = ICONS.x);
document.querySelectorAll('.modal').forEach((m) => m.addEventListener('click', (e) => { if (e.target === m) m.classList.add('hidden'); }));

// ---------- Adicionar conta ----------
function openAddModal() { el('accResult').textContent = ''; el('accModal').classList.remove('hidden'); renderOAuthButtons(); }
el('manageAdd').onclick = () => { el('manageModal').classList.add('hidden'); openAddModal(); };

async function renderOAuthButtons() {
  const box = el('oauthButtons'); box.innerHTML = '';
  let status = {};
  try { status = await api('/api/oauth/status'); } catch { }
  const provs = [{ key: 'microsoft', label: 'Entrar com a Microsoft' }, { key: 'google', label: 'Entrar com o Google' }];
  let any = false;
  for (const p of provs) {
    if (!status[p.key]) continue; any = true;
    const b = document.createElement('button'); b.className = 'oauth-btn';
    b.innerHTML = `<span class="brand">${BRAND[p.key]}</span>${p.label}`;
    b.onclick = () => startOAuth(p.key); box.appendChild(b);
  }
  el('oauthSep').classList.toggle('hidden', !any);
}
function startOAuth(provider) {
  const popup = window.open(`/api/oauth/${provider}/start?token=${encodeURIComponent(TOKEN)}`, 'oauth', 'width=520,height=650');
  const t = setInterval(async () => {
    if (popup && popup.closed) { clearInterval(t); el('accModal').classList.add('hidden'); await loadAccounts(); loadList(); }
  }, 800);
}
function accPayload() { return { displayName: el('accName').value.trim(), email: el('accEmail').value.trim(), password: el('accPass').value }; }
el('accTest').onclick = async () => {
  el('accResult').textContent = 'Testando...';
  try {
    const r = await api('/api/accounts/test', { method: 'POST', body: JSON.stringify(accPayload()) });
    el('accResult').innerHTML = `IMAP ${r.imap ? '✓' : '✕ ' + esc(r.imapError || '')} · SMTP ${r.smtp ? '✓' : '✕ ' + esc(r.smtpError || '')}`;
  } catch (e) { el('accResult').innerHTML = `<span class="err">${esc(e.message)}</span>`; }
};
el('accSave').onclick = async () => {
  el('accResult').textContent = 'Salvando...';
  try {
    await api('/api/accounts', { method: 'POST', body: JSON.stringify(accPayload()) });
    el('accModal').classList.add('hidden'); el('accName').value = el('accEmail').value = el('accPass').value = '';
    await loadAccounts(); loadList();
  } catch (e) { el('accResult').innerHTML = `<span class="err">${esc(e.message)}</span>`; }
};

// ---------- Gerenciar contas ----------
el('manageBtn').onclick = () => { renderManage(); el('manageModal').classList.remove('hidden'); };
function renderManage() {
  el('manageList').innerHTML = accounts.length ? accounts.map((a) => `
    <li>${avatarHtml(a)}
      <div class="info"><b>${esc(a.displayName || a.email)}</b><span>${esc(a.email)} · ${a.authType === 'oauth' ? esc(a.provider) : 'senha'}</span></div>
      <button class="del" data-id="${a.id}" title="Remover">${ICONS.trash}</button></li>`).join('')
    : `<li style="justify-content:center;color:var(--muted)">Nenhuma conta ainda.</li>`;
  el('manageList').querySelectorAll('.del').forEach((b) => b.onclick = async () => {
    const id = b.dataset.id;
    const acc = accountById(Number(id));
    if (!(await uiConfirm(`Remover ${acc ? acc.email : 'esta conta'} do FluxoryBox?`))) return;
    b.disabled = true;
    try {
      await api('/api/accounts/' + id, { method: 'DELETE' });
      if (view === Number(id)) view = 'unified';
      await loadAccounts(); renderManage(); loadList();
    } catch (e) { alert('Falha ao remover: ' + e.message); b.disabled = false; }
  });
}

// ---------- Escrever ----------
let cpAttachments = []; // { filename, contentType, data(base64), size }

// Transforma texto puro (citações de resposta/encaminhamento) em HTML seguro.
function textToHtml(t) {
  return esc(t || '').replace(/\n/g, '<br>');
}
function openCompose(pre = {}) {
  el('composeModal').classList.remove('hidden'); el('cpResult').textContent = '';
  if (pre.accountId) el('cpFrom').value = pre.accountId;
  else if (typeof view === 'number') el('cpFrom').value = view;
  el('cpTo').value = pre.to || ''; el('cpSubject').value = pre.subject || '';
  // Corpo pré-preenchido (resposta/encaminhamento) entra como texto citado; o usuário escreve acima.
  el('cpBody').innerHTML = pre.body ? '<br><br>' + textToHtml(pre.body) : '';
  el('cpCc').value = pre.cc || ''; el('cpBcc').value = pre.bcc || '';
  cpAttachments = []; renderAttachChips();
  const showCc = !!(pre.cc || pre.bcc);
  el('cpCcWrap').classList.toggle('hidden', !showCc);
  el('cpBccWrap').classList.toggle('hidden', !showCc);
  el('cpTo').focus();
}
el('cpCcToggle').onclick = () => {
  el('cpCcWrap').classList.toggle('hidden');
  el('cpBccWrap').classList.toggle('hidden');
};
el('composeBtn').onclick = () => openCompose();

// Barra de formatação (execCommand no contenteditable).
el('cpToolbar').querySelectorAll('.tb[data-cmd]').forEach((b) => {
  // mousedown preventDefault: não perde a seleção do editor ao clicar no botão.
  b.addEventListener('mousedown', (e) => e.preventDefault());
  b.onclick = () => {
    const cmd = b.dataset.cmd;
    el('cpBody').focus();
    if (cmd === 'createLink') {
      const url = prompt('URL do link:', 'https://');
      if (url) document.execCommand('createLink', false, url);
    } else {
      document.execCommand(cmd, false, null);
    }
  };
});

// Anexos: lê arquivos como base64 e guarda em memória.
function fmtSize(n) { if (n < 1024) return n + ' B'; if (n < 1048576) return (n / 1024).toFixed(0) + ' KB'; return (n / 1048576).toFixed(1) + ' MB'; }
function renderAttachChips() {
  const box = el('cpAttachList');
  box.innerHTML = cpAttachments.map((a, i) => `<span class="chip">${esc(a.filename)} <small>${fmtSize(a.size)}</small><button type="button" data-i="${i}" title="Remover">×</button></span>`).join('');
  box.querySelectorAll('button[data-i]').forEach((b) => b.onclick = () => { cpAttachments.splice(Number(b.dataset.i), 1); renderAttachChips(); });
}
el('cpAttachBtn').onclick = () => el('cpFile').click();
el('cpFile').onchange = () => {
  const files = [...el('cpFile').files];
  const MAX = 20 * 1024 * 1024; // limite prático por request (bodyLimit 25MB)
  const total = () => cpAttachments.reduce((s, a) => s + a.size, 0);
  for (const file of files) {
    if (total() + file.size > MAX) { el('cpResult').innerHTML = `<span class="err">Anexos excedem 20MB.</span>`; break; }
    const reader = new FileReader();
    reader.onload = () => {
      cpAttachments.push({ filename: file.name, contentType: file.type || 'application/octet-stream', data: String(reader.result), size: file.size });
      renderAttachChips();
    };
    reader.readAsDataURL(file); // gera "data:<type>;base64,...."
  }
  el('cpFile').value = '';
};

el('cpSend').onclick = async () => {
  const to = el('cpTo').value.trim();
  if (!to) { el('cpResult').innerHTML = `<span class="err">Informe o destinatário.</span>`; return; }
  el('cpResult').textContent = 'Enviando...';
  const html = el('cpBody').innerHTML.trim();
  const text = el('cpBody').innerText;
  try {
    await api(`/api/accounts/${el('cpFrom').value}/send`, {
      method: 'POST',
      body: JSON.stringify({
        to, cc: el('cpCc').value.trim() || undefined, bcc: el('cpBcc').value.trim() || undefined,
        subject: el('cpSubject').value,
        text, html: html || undefined,
        attachments: cpAttachments.length ? cpAttachments : undefined,
      }),
    });
    el('cpResult').innerHTML = `<span style="color:var(--ok)">Enviada.</span>`;
    cpAttachments = [];
    setTimeout(() => el('composeModal').classList.add('hidden'), 800);
  } catch (e) { el('cpResult').innerHTML = `<span class="err">${esc(e.message)}</span>`; }
};

// ---------- Start ----------
async function start() {
  try {
    await api('/api/accounts'); hideGate();
    await loadAccounts(); selectView('unified'); startPolling(); ensureNotifyPermission();
  } catch (e) { if (e.message !== '401') showGate(e.message); }
}
start();
