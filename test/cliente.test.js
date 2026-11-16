'use strict';
// Simula o navegador (sem DOM real) para testar o módulo de autenticação do index.html.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const i = html.indexOf('<script id="caicavv-auth-script">');
const codigo = html.slice(html.indexOf('>', i) + 1, html.indexOf('</script>', i));

function ambiente({ sessao, respostas }) {
  const els = {};
  const el = (id) => (els[id] ||= { id, textContent: '', innerHTML: '', style: {}, contains: () => true });
  const chamadas = [];
  const timers = [];
  const listeners = {};
  const w = {
    el, chamadas, timers, listeners, usuarios: {}, entrou: null,
    window: null,
    document: {
      getElementById: el, addEventListener: (t, f) => { (listeners[t] ||= []).push(f); },
      createElement: () => ({}), body: { appendChild() {} }, title: ''
    },
    location: { origin: 'https://caicavvss.onrender.com', pathname: '/', search: '', hash: '', replace(u) { w.replaceu = u; }, reload() { w.recarregou = true; } },
    history: { replaceState() {} },
    crypto: { getRandomValues: (a) => a.fill(7) },
    URLSearchParams, console, setTimeout: (f, ms) => { timers.push(ms); return timers.length; }, clearTimeout() {},
    mostrarToast: (m, t) => { w.toast = [m, t]; },
    permissoes: { adm: {}, coordenacao: {}, recepcao: {}, tecnico: {} },
    entrarComo: async (k) => { w.entrou = k; },
    limparSessao() {},
    loginDiv: { style: {} }
  };
  w.usuarios = { 'josiane.caicavv': { nome: 'Josiane', role: 'tecnico' } };
  w.fetch = async (url, init = {}) => {
    chamadas.push({ url, init });
    const r = respostas[(init.method || 'GET') + ' ' + url] || respostas[url];
    if (!r) throw new Error('sem resposta para ' + url);
    return { ok: r.status < 400, status: r.status, headers: { get: () => r.etag || null }, json: async () => r.corpo };
  };
  w.window = w;
  w.supabase = { createClient: () => ({ auth: {
    getSession: async () => ({ data: { session: sessao ? { access_token: 'TOKEN123' } : null } }),
    onAuthStateChange() {}, signOut: async () => {}, signInWithOAuth: async () => ({}) } }) };
  vm.createContext(w);
  vm.runInContext(codigo, w);
  return w;
}
const config = { status: 200, corpo: { supabaseUrl: 'https://x.supabase.co', supabasePublishableKey: 'pk' } };
let n = 0; const t = async (nome, fn) => { await fn(); n++; console.log('ok -', nome); };

(async () => {
  await t('sem sessão: mostra o botão Entrar com Google', async () => {
    const w = ambiente({ sessao: false, respostas: { '/api/config': config } });
    await w.CAICAVV_AUTH.boot();
    assert.strictEqual(w.el('authTitulo').textContent, 'Entrar no sistema');
    assert.ok(w.el('authConteudo').innerHTML.includes('Entrar com Google'));
  });
  await t('conta sem cadastro: mensagem exigida + botão Solicitar acesso; nada de dados', async () => {
    const w = ambiente({ sessao: true, respostas: { '/api/config': config, '/api/me': { status: 200, corpo: { status: 'sem_cadastro', email: 'novo@gmail.com' } } } });
    await w.CAICAVV_AUTH.boot();
    assert.strictEqual(w.el('authDescricao').textContent, 'Seu acesso ainda não foi autorizado. Sua solicitação poderá ser analisada pela administração do CAICAVV.');
    assert.ok(w.el('authConteudo').innerHTML.includes('Solicitar acesso'));
    assert.strictEqual(w.entrou, null);
    assert.ok(w.chamadas.every(c => !c.url.includes('/data/')));
    assert.strictEqual(w.chamadas.find(c => c.url === '/api/me').init.headers.Authorization, 'Bearer TOKEN123');
  });
  await t('solicitar acesso -> tela de pendente', async () => {
    const w = ambiente({ sessao: true, respostas: { '/api/config': config, '/api/me': { status: 200, corpo: { status: 'sem_cadastro', email: 'a@b.com' } }, 'POST /api/access/request': { status: 200, corpo: { status: 'pendente' } } } });
    await w.CAICAVV_AUTH.boot(); await w.CAICAVV_AUTH.solicitar();
    assert.strictEqual(w.el('authTitulo').textContent, 'Acesso pendente');
  });
  for (const [st, titulo] of [['recusado', 'Acesso recusado'], ['revogado', 'Acesso revogado'], ['pendente', 'Acesso pendente']]) {
    await t('estado ' + st, async () => {
      const w = ambiente({ sessao: true, respostas: { '/api/config': config, '/api/me': { status: 200, corpo: { status: st, email: 'a@b.com' } } } });
      await w.CAICAVV_AUTH.boot();
      assert.strictEqual(w.el('authTitulo').textContent, titulo); assert.strictEqual(w.entrou, null);
    });
  }
  await t('técnico aprovado entra pelo cadastro existente (josiane.caicavv)', async () => {
    const w = ambiente({ sessao: true, respostas: { '/api/config': config, '/api/me': { status: 200, corpo: { status: 'aprovado', perfil: { role: 'tecnico', nome: 'Josiane', loginKey: 'josiane.caicavv', tecnicoNome: 'Josiane' } } } } });
    await w.CAICAVV_AUTH.boot();
    assert.strictEqual(w.entrou, 'josiane.caicavv');
  });
  await t('coordenação aprovada ganha identidade própria, sem virar técnico', async () => {
    const w = ambiente({ sessao: true, respostas: { '/api/config': config, '/api/me': { status: 200, corpo: { status: 'aprovado', perfil: { role: 'coordenacao', nome: 'Chefe', loginKey: 'g_abc123', podeGerenciarAcessos: true } } } } });
    await w.CAICAVV_AUTH.boot();
    assert.strictEqual(w.entrou, 'g_abc123');
    assert.deepStrictEqual({ ...w.usuarios['g_abc123'] }, { nome: 'Chefe', role: 'coordenacao' });
  });
  await t('ponte de dados: envia token, mesma API do Firestore', async () => {
    const w = ambiente({ sessao: true, respostas: { '/api/config': config, '/api/me': { status: 200, corpo: { status: 'sem_cadastro' } },
      '/api/data/main': { status: 200, corpo: { existe: true, dados: { itens: [1] } } }, 'POST /api/data/main': { status: 200, corpo: { ok: true } } } });
    await w.CAICAVV_AUTH.boot();
    const snap = await w.DOC_ATENDIMENTOS.get();
    assert.ok(snap.exists); assert.deepStrictEqual(snap.data().itens, [1]);
    await w.DOC_ATENDIMENTOS.set({ itens: [] }, { merge: true });
    const post = w.chamadas.find(c => c.init.method === 'POST' && c.url === '/api/data/main');
    assert.deepStrictEqual(JSON.parse(post.init.body), { dados: { itens: [] }, modo: 'set' });
    assert.throws(() => w.DOC_ATENDIMENTOS.collection('outra'));
    assert.ok(w.DOC_ATENDIMENTOS.collection('relatoriosImportados').doc().id.length === 20);
  });
  await t('acesso revogado no meio do uso (403) força nova verificação', async () => {
    const w = ambiente({ sessao: true, respostas: { '/api/config': config, '/api/me': { status: 200, corpo: { status: 'sem_cadastro' } },
      '/api/data/main': { status: 403, corpo: { erro: 'ACESSO_REVOGADO', mensagem: 'x' } } } });
    await w.CAICAVV_AUTH.boot();
    await assert.rejects(() => w.DOC_ATENDIMENTOS.get());
    assert.ok(w.timers.includes(1600));
  });
  console.log(`\n${n} testes do navegador passaram.`);
})().catch((e) => { console.error(e); process.exit(1); });
