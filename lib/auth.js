'use strict';

const cfg = require('./config');
const { HttpError } = require('./dataRules');

const TABELA = 'caicavv_acessos';
const HISTORICO = 'caicavv_acessos_historico';

const TTL_TOKEN_MS = 60 * 1000;
const TTL_ACESSO_MS = 5 * 1000;

function limparTexto(v, max) {
  return String(v == null ? '' : v)
    .replace(/[\u0000-\u001f\u007f<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalizarEmail(v) {
  const e = String(v || '').trim().toLowerCase();
  if (!e || e.length > 254 || !EMAIL_RE.test(e)) return null;
  return e;
}

function criarAuth(supabase) {
  const tokens = new Map();
  const acessos = new Map();

  function limparCaches() { acessos.clear(); }

  async function usuarioDoToken(token) {
    const agora = Date.now();
    const guardado = tokens.get(token);
    if (guardado && guardado.exp > agora) return guardado.user;

    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data || !data.user) throw new HttpError(401, 'SESSAO_INVALIDA', 'Sessão inválida ou expirada.');

    tokens.set(token, { user: data.user, exp: agora + TTL_TOKEN_MS });
    if (tokens.size > 500) {
      for (const [k, v] of tokens) if (v.exp < agora) tokens.delete(k);
    }
    return data.user;
  }

  function nomeDoGoogle(user) {
    const m = user.user_metadata || {};
    return limparTexto(m.full_name || m.name || (user.email || '').split('@')[0], 120);
  }

  /** Procura o cadastro de acesso do usuário (pelo id ou, na primeira vez, pelo e-mail) e vincula o id. */
  async function buscarAcesso(user) {
    const email = normalizarEmail(user.email);
    if (!email) throw new HttpError(403, 'EMAIL_AUSENTE', 'Conta sem e-mail válido.');
    if (!user.email_confirmed_at) throw new HttpError(403, 'EMAIL_NAO_VERIFICADO', 'E-mail não verificado.');

    const em = Date.now();
    const c = acessos.get(user.id);
    if (c && c.exp > em) return c.row;

    let { data: row, error } = await supabase.from(TABELA).select('*').eq('auth_user_id', user.id).maybeSingle();
    if (error) throw new HttpError(500, 'ERRO_BANCO', 'Falha ao consultar acessos.');

    if (!row) {
      const r2 = await supabase.from(TABELA).select('*').eq('email', email).maybeSingle();
      if (r2.error) throw new HttpError(500, 'ERRO_BANCO', 'Falha ao consultar acessos.');
      row = r2.data;
      if (row) {
        // Cadastro feito antes do primeiro login (administrador inicial ou adição manual): vincula a conta.
        const patch = { auth_user_id: user.id };
        if (!row.nome) patch.nome = nomeDoGoogle(user);
        const up = await supabase.from(TABELA).update(patch).eq('id', row.id).select('*').single();
        if (up.error) throw new HttpError(500, 'ERRO_BANCO', 'Falha ao vincular a conta.');
        row = up.data;
      }
    }
    acessos.set(user.id, { row: row || null, exp: em + TTL_ACESSO_MS });
    return row || null;
  }

  function montarPerfil(row, user) {
    const nome = row.nome || nomeDoGoogle(user);
    return {
      acessoId: row.id,
      authUserId: user.id,
      email: row.email,
      nome,
      role: row.role,
      roleLabel: cfg.ROLE_LABELS[row.role],
      tecnicoNome: row.tecnico_nome || null,
      loginKey: cfg.loginKeyDe(row),
      podeGerenciarAcessos: cfg.podeGerenciarAcessos(row.role)
    };
  }

  function token(req) {
    const h = req.headers.authorization || '';
    const m = /^Bearer\s+(\S+)$/i.exec(h);
    return m ? m[1] : null;
  }

  // ---------- Middlewares ----------
  async function exigirSessao(req, res, next) {
    const t = token(req);
    if (!t) throw new HttpError(401, 'SEM_SESSAO', 'Faça login para continuar.');
    req.user = await usuarioDoToken(t);
    next();
  }

  async function exigirAprovado(req, res, next) {
    const row = await buscarAcesso(req.user);
    if (!row || row.status !== 'aprovado' || !row.role) {
      const status = row ? row.status : 'sem_cadastro';
      throw new HttpError(403, 'ACESSO_' + status.toUpperCase(), 'Acesso não autorizado.');
    }
    req.perfil = montarPerfil(row, req.user);
    next();
  }

  function exigirGestor(req, res, next) {
    if (!req.perfil || !req.perfil.podeGerenciarAcessos) {
      throw new HttpError(403, 'SEM_PERMISSAO', 'Apenas administradores podem fazer isso.');
    }
    next();
  }

  // ---------- Solicitação de acesso ----------
  async function solicitarAcesso(user) {
    const existente = await buscarAcesso(user);
    if (existente) return existente; // evita solicitações duplicadas

    const email = normalizarEmail(user.email);
    const novo = {
      auth_user_id: user.id,
      email,
      nome: nomeDoGoogle(user),
      status: 'pendente',
      origem: 'solicitacao'
    };
    const { data, error } = await supabase.from(TABELA).insert(novo).select('*').single();
    if (error) {
      if (error.code === '23505') { // corrida: outra requisição já criou
        limparCaches();
        return buscarAcesso(user);
      }
      throw new HttpError(500, 'ERRO_BANCO', 'Não foi possível registrar a solicitação.');
    }
    await registrarHistorico(data.id, 'solicitou', email, {});
    limparCaches();
    return data;
  }

  async function registrarHistorico(acessoId, acao, porEmail, detalhes) {
    const { error } = await supabase.from(HISTORICO).insert({
      acesso_id: acessoId, acao, por_email: porEmail, detalhes: detalhes || {}
    });
    if (error) console.error('Falha ao registrar histórico de acesso:', error.message);
  }

  return {
    TABELA, limparCaches, usuarioDoToken, buscarAcesso, montarPerfil, solicitarAcesso,
    registrarHistorico, exigirSessao, exigirAprovado, exigirGestor
  };
}

module.exports = { criarAuth, normalizarEmail, limparTexto };
