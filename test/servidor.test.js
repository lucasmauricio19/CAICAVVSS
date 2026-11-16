'use strict';
// Testa lib/auth.js + lib/api.js com um Express e um Supabase simulados (nada de rede).
const assert = require('assert');
const Module = require('module');

/* ---------- Express mínimo ---------- */
function Router() {
  const camadas = [];
  const r = (req, res, done) => r.tratar(req, res, done);
  const add = (metodo) => (caminho, ...hs) => { camadas.push({ metodo, caminho, hs }); return r; };
  ['get', 'post', 'put', 'patch', 'delete'].forEach((m) => { r[m] = add(m.toUpperCase()); });
  r.use = (a, ...hs) => { if (typeof a === 'string') camadas.push({ metodo: '*', prefixo: a, hs }); else camadas.push({ metodo: '*', hs: [a, ...hs] }); return r; };
  r.tratar = async (req, res, done) => {
    const original = req.path;
    const fila = [];
    for (const c of camadas) {
      if (c.metodo === '*') {
        if (c.prefixo) { if (original === c.prefixo || original.startsWith(c.prefixo + '/')) fila.push({ hs: c.hs, resto: original.slice(c.prefixo.length) || '/' }); }
        else fila.push({ hs: c.hs, resto: original });
      } else if (c.metodo === req.method) {
        const nomes = []; const re = new RegExp('^' + c.caminho.replace(/:([a-z]+)/g, (_, n) => { nomes.push(n); return '([^/]+)'; }) + '$');
        const m = re.exec(original);
        if (m) fila.push({ hs: c.hs, resto: original, params: Object.fromEntries(nomes.map((n, i) => [n, decodeURIComponent(m[i + 1])])) });
      }
    }
    let erro = null; let terminou = false;
    outer: for (const f of fila) {
      for (const h of f.hs) {
        if (res.enviado) break outer;
        const aridade4 = h.length === 4;
        if (erro && !aridade4) continue;
        if (!erro && aridade4) continue;
        req.path = f.resto; if (f.params) req.params = { ...req.params, ...f.params };
        try {
          let seguiu = false;
          if (aridade4) await h(erro, req, res, () => { seguiu = true; erro = null; });
          else await h(req, res, (e) => { seguiu = true; if (e) erro = e; });
          if (!seguiu && !erro) { terminou = true; break outer; }
        } catch (e) { erro = e; }
      }
    }
    req.path = original;
    if (!terminou && !res.enviado && done) done(erro);
  };
  return r;
}
const fakeExpress = () => ({}); fakeExpress.Router = Router; fakeExpress.json = () => (req, res, next) => next();
const carregar = Module._load;
Module._load = function (nome, ...r) { return nome === 'express' ? fakeExpress : carregar.call(this, nome, ...r); };

/* ---------- Supabase em memória ---------- */
function criarSupabase(usuariosPorToken) {
  const tabelas = { caicavv_acessos: [], caicavv_acessos_historico: [] };
  let seq = 0;
  class Q {
    constructor(t) { this.t = t; this.f = []; this.op = 'select'; }
    select(c, o) { this.o = o || {}; if (this.op === 'select') this.op = 'select'; else this.ret = true; return this; }
    insert(r) { this.op = 'insert'; this.row = r; return this; }
    update(p) { this.op = 'update'; this.patch = p; return this; }
    delete() { this.op = 'delete'; return this; }
    eq(c, v) { this.f.push((r) => r[c] === v); return this; }
    neq(c, v) { this.f.push((r) => r[c] !== v); return this; }
    in(c, a) { this.f.push((r) => a.includes(r[c])); return this; }
    order() { return this; } limit() { return this; }
    maybeSingle() { return this.exec(true); } single() { return this.exec(true); }
    then(ok, ko) { return this.exec(false).then(ok, ko); }
    async exec(unico) {
      const tab = tabelas[this.t]; const ok = (r) => this.f.every((f) => f(r));
      if (this.op === 'insert') {
        if (this.t === 'caicavv_acessos') {
          if (tab.some((r) => r.email === this.row.email || (this.row.auth_user_id && r.auth_user_id === this.row.auth_user_id)))
            return { data: null, error: { code: '23505', message: 'dup' } };
          const novo = { id: '00000000-0000-4000-8000-' + String(++seq).padStart(12, '0'), nome: '', status: 'pendente', role: null, tecnico_nome: null, auth_user_id: null, solicitado_em: new Date().toISOString(), ...this.row };
          tab.push(novo); return { data: novo, error: null };
        }
        tab.push({ ...this.row }); return { data: null, error: null };
      }
      if (this.op === 'update') {
        const alvos = tab.filter(ok); alvos.forEach((r) => Object.assign(r, this.patch));
        return { data: unico ? (alvos[0] || null) : alvos, error: null };
      }
      if (this.op === 'delete') { tabelas[this.t] = tab.filter((r) => !ok(r)); return { error: null }; }
      const rows = tab.filter(ok);
      if (this.o.head) return { count: rows.length, error: null };
      return { data: unico ? (rows[0] || null) : rows, error: null };
    }
  }
  return { tabelas, from: (t) => new Q(t), auth: { getUser: async (tok) => usuariosPorToken[tok] ? { data: { user: usuariosPorToken[tok] }, error: null } : { data: null, error: { message: 'inválido' } } } };
}

const { criarAuth } = require('../lib/auth');
const { criarRouter } = require('../lib/api');
const store = require('../lib/store');

const U = (id, email, nome) => ({ id, email, email_confirmed_at: '2026-01-01', user_metadata: { full_name: nome } });
const users = {
  tChefe: U('11111111-1111-4111-8111-111111111111', 'MattosMay@Gmail.com', 'Mayara Chefe'),
  tNovo: U('22222222-2222-4222-8222-222222222222', 'novo@gmail.com', 'Pessoa Nova'),
  tTec: U('33333333-3333-4333-8333-333333333333', 'tec@gmail.com', 'Técnica'),
  tNaoVerif: { ...U('44444444-4444-4444-8444-444444444444', 'x@gmail.com', 'X'), email_confirmed_at: null }
};
process.env.SUPABASE_URL = 'https://x.supabase.co'; process.env.SUPABASE_PUBLISHABLE_KEY = 'pk';
const sb = criarSupabase(users);
sb.tabelas.caicavv_acessos.push({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', email: 'mattosmay@gmail.com', nome: '', status: 'aprovado', role: 'coordenacao', tecnico_nome: null, auth_user_id: null, origem: 'inicial' });
const auth = criarAuth(sb);
const router = criarRouter({ supabase: sb, auth });
store.disponivel = () => true;
store.lerParaCliente = async () => ({ existe: true, dados: { itens: [] }, versao: 1 });
store.escreverMain = async () => {};

async function req(metodo, caminho, { token, body } = {}) {
  const r = { method: metodo, path: caminho, url: caminho, headers: token ? { authorization: 'Bearer ' + token } : {}, body, params: {}, ip: '1.1.1.1' };
  const res = { codigo: 200, corpo: null, enviado: false, cab: {}, status(c) { this.codigo = c; return this; }, set(k, v) { this.cab[k] = v; return this; }, json(c) { this.corpo = c; this.enviado = true; return this; }, end() { this.enviado = true; return this; } };
  await router(r, res, () => {});
  return res;
}

let n = 0; const t = async (nome, fn) => { await fn(); n++; console.log('ok -', nome); };

(async () => {
  await t('/config só expõe URL e chave PÚBLICA', async () => {
    const r = await req('GET', '/config');
    assert.deepStrictEqual(Object.keys(r.corpo).sort(), ['supabasePublishableKey', 'supabaseUrl']);
  });
  await t('sem token / token inválido / e-mail não verificado => bloqueado', async () => {
    assert.strictEqual((await req('GET', '/me')).codigo, 401);
    assert.strictEqual((await req('GET', '/me', { token: 'lixo' })).codigo, 401);
    assert.strictEqual((await req('GET', '/me', { token: 'tNaoVerif' })).codigo, 403);
    assert.strictEqual((await req('GET', '/data/main')).codigo, 401);
    assert.strictEqual((await req('GET', '/admin/acessos')).codigo, 401);
  });
  await t('administrador inicial: conta é vinculada no 1º login (e-mail em maiúsculas funciona)', async () => {
    const r = await req('GET', '/me', { token: 'tChefe' });
    assert.strictEqual(r.corpo.status, 'aprovado');
    assert.strictEqual(r.corpo.perfil.role, 'coordenacao');
    assert.strictEqual(r.corpo.perfil.podeGerenciarAcessos, true);
    const linha = sb.tabelas.caicavv_acessos[0];
    assert.strictEqual(linha.auth_user_id, users.tChefe.id);
    assert.strictEqual(linha.nome, 'Mayara Chefe');
  });
  await t('qualquer Google autenticado NÃO ganha acesso (sem_cadastro) e não lê dados', async () => {
    assert.strictEqual((await req('GET', '/me', { token: 'tNovo' })).corpo.status, 'sem_cadastro');
    const d = await req('GET', '/data/main', { token: 'tNovo' });
    assert.strictEqual(d.codigo, 403); assert.strictEqual(d.corpo.erro, 'ACESSO_SEM_CADASTRO');
    assert.strictEqual((await req('POST', '/data/main', { token: 'tNovo', body: { dados: {} } })).codigo, 403);
    assert.strictEqual((await req('GET', '/admin/acessos', { token: 'tNovo' })).codigo, 403);
  });
  await t('solicitação não duplica e nasce pendente, sem perfil', async () => {
    assert.strictEqual((await req('POST', '/access/request', { token: 'tNovo' })).corpo.status, 'pendente');
    await req('POST', '/access/request', { token: 'tNovo' });
    await req('POST', '/access/request', { token: 'tNovo' });
    const linhas = sb.tabelas.caicavv_acessos.filter((x) => x.email === 'novo@gmail.com');
    assert.strictEqual(linhas.length, 1);
    assert.strictEqual(linhas[0].role, null); assert.strictEqual(linhas[0].status, 'pendente');
    assert.strictEqual((await req('GET', '/data/main', { token: 'tNovo' })).corpo.erro, 'ACESSO_PENDENTE');
  });
  const idNovo = () => sb.tabelas.caicavv_acessos.find((x) => x.email === 'novo@gmail.com').id;
  await t('quem não é administrador não consegue aprovar (nem a si mesmo)', async () => {
    const r = await req('PATCH', '/admin/acessos/' + idNovo(), { token: 'tNovo', body: { acao: 'aprovar', role: 'adm' } });
    assert.strictEqual(r.codigo, 403);
    assert.strictEqual(sb.tabelas.caicavv_acessos.find((x) => x.email === 'novo@gmail.com').status, 'pendente');
  });
  await t('aprovação valida perfil e vínculo do técnico', async () => {
    const p = (body) => req('PATCH', '/admin/acessos/' + idNovo(), { token: 'tChefe', body });
    assert.strictEqual((await p({ acao: 'aprovar' })).corpo.erro, 'PERFIL_INVALIDO');
    assert.strictEqual((await p({ acao: 'aprovar', role: 'superuser' })).corpo.erro, 'PERFIL_INVALIDO');
    assert.strictEqual((await p({ acao: 'aprovar', role: 'tecnico' })).corpo.erro, 'TECNICO_INVALIDO');
    assert.strictEqual((await p({ acao: 'aprovar', role: 'tecnico', tecnicoNome: 'Qualquer' })).corpo.erro, 'TECNICO_INVALIDO');
    assert.strictEqual((await p({ acao: 'xpto' })).codigo, 400);
    const ok = await p({ acao: 'aprovar', role: 'tecnico', tecnicoNome: 'Cláudia' });
    assert.strictEqual(ok.codigo, 200); assert.strictEqual(ok.corpo.acesso.status, 'aprovado');
    const me = await req('GET', '/me', { token: 'tNovo' });
    assert.strictEqual(me.corpo.perfil.loginKey, 'claudia.caicavv'); assert.strictEqual(me.corpo.perfil.podeGerenciarAcessos, false);
    assert.strictEqual((await req('GET', '/data/main', { token: 'tNovo' })).codigo, 200);
  });
  await t('técnico aprovado NÃO acessa o painel administrativo nem se promove', async () => {
    assert.strictEqual((await req('GET', '/admin/acessos', { token: 'tNovo' })).codigo, 403);
    assert.strictEqual((await req('PATCH', '/admin/acessos/' + idNovo(), { token: 'tNovo', body: { acao: 'atualizar', role: 'adm' } })).codigo, 403);
    assert.strictEqual((await req('POST', '/admin/acessos', { token: 'tNovo', body: { email: 'a@b.com', role: 'adm' } })).codigo, 403);
    assert.strictEqual(sb.tabelas.caicavv_acessos.find((x) => x.email === 'novo@gmail.com').role, 'tecnico');
  });
  await t('administrador não altera o próprio acesso', async () => {
    const meu = sb.tabelas.caicavv_acessos[0].id;
    for (const [m, b] of [['PATCH', { acao: 'revogar' }], ['PATCH', { acao: 'atualizar', role: 'recepcao' }], ['DELETE', undefined]]) {
      const r = await req(m, '/admin/acessos/' + meu, { token: 'tChefe', body: b });
      assert.strictEqual(r.corpo.erro, 'NAO_PODE_ALTERAR_PROPRIO');
    }
    assert.strictEqual(sb.tabelas.caicavv_acessos[0].role, 'coordenacao');
  });
  await t('adicionar manualmente por e-mail; duplicado é recusado', async () => {
    const r = await req('POST', '/admin/acessos', { token: 'tChefe', body: { email: ' Tec@Gmail.com ', role: 'recepcao', nome: 'Recepção <b>1</b>' } });
    assert.strictEqual(r.codigo, 201); assert.strictEqual(r.corpo.acesso.email, 'tec@gmail.com');
    assert.ok(!/[<>]/.test(r.corpo.acesso.nome));
    assert.strictEqual((await req('POST', '/admin/acessos', { token: 'tChefe', body: { email: 'tec@gmail.com', role: 'adm' } })).corpo.erro, 'EMAIL_JA_CADASTRADO');
    assert.strictEqual((await req('POST', '/admin/acessos', { token: 'tChefe', body: { email: 'invalido', role: 'adm' } })).corpo.erro, 'EMAIL_INVALIDO');
    assert.strictEqual((await req('GET', '/me', { token: 'tTec' })).corpo.perfil.role, 'recepcao');
  });
  await t('relatórios importados: recepção pode gravar, técnico não', async () => {
    store.gravarRelatorio = async () => {}; store.listarRelatorios = async () => [];
    assert.strictEqual((await req('PUT', '/data/relatorios/abc', { token: 'tTec', body: { dados: {} } })).codigo, 200);
    assert.strictEqual((await req('PUT', '/data/relatorios/abc', { token: 'tNovo', body: { dados: {} } })).codigo, 403);
    assert.strictEqual((await req('GET', '/data/relatorios', { token: 'tNovo' })).codigo, 200);
  });
  await t('revogar tira o acesso na hora; reativar devolve; excluir remove', async () => {
    const id = idNovo();
    const rv = await req('PATCH', '/admin/acessos/' + id, { token: 'tChefe', body: { acao: 'revogar' } });
    assert.strictEqual(rv.corpo.acesso.status, 'revogado');
    assert.strictEqual((await req('GET', '/data/main', { token: 'tNovo' })).corpo.erro, 'ACESSO_REVOGADO');
    assert.strictEqual((await req('GET', '/me', { token: 'tNovo' })).corpo.status, 'revogado');
    assert.strictEqual((await req('POST', '/access/request', { token: 'tNovo' })).corpo.status, 'revogado'); // não se auto-reativa
    assert.strictEqual((await req('PATCH', '/admin/acessos/' + id, { token: 'tChefe', body: { acao: 'revogar' } })).corpo.erro, 'ESTADO_INVALIDO');
    const re = await req('PATCH', '/admin/acessos/' + id, { token: 'tChefe', body: { acao: 'reativar', role: 'tecnico', tecnicoNome: 'Cintya' } });
    assert.strictEqual(re.corpo.acesso.status, 'aprovado');
    assert.strictEqual((await req('DELETE', '/admin/acessos/' + id, { token: 'tChefe' })).codigo, 200);
    assert.strictEqual((await req('GET', '/me', { token: 'tNovo' })).corpo.status, 'sem_cadastro');
  });
  await t('recusar só vale para pendentes e a pessoa não se re-solicita', async () => {
    await req('POST', '/access/request', { token: 'tNovo' });
    assert.strictEqual((await req('PATCH', '/admin/acessos/' + idNovo(), { token: 'tChefe', body: { acao: 'recusar' } })).corpo.acesso.status, 'recusado');
    assert.strictEqual((await req('POST', '/access/request', { token: 'tNovo' })).corpo.status, 'recusado');
    assert.strictEqual((await req('GET', '/data/main', { token: 'tNovo' })).corpo.erro, 'ACESSO_RECUSADO');
  });
  await t('histórico de decisões é registrado', async () => {
    const acoes = sb.tabelas.caicavv_acessos_historico.map((h) => h.acao);
    ['solicitou', 'aprovar', 'revogar', 'reativar', 'excluiu', 'recusar', 'adicionou_manual'].forEach((a) => assert.ok(acoes.includes(a), a));
  });
  console.log(`\n${n} grupos de testes do servidor passaram.`);
})().catch((e) => { console.error(e); process.exit(1); });
