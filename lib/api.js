'use strict';

const express = require('express');
const cfg = require('./config');
const store = require('./store');
const { HttpError } = require('./dataRules');
const { normalizarEmail, limparTexto } = require('./auth');

function limitador(maxPorMinuto, chave) {
  const baldes = new Map();
  return (req, res, next) => {
    const k = chave(req);
    const agora = Date.now();
    let b = baldes.get(k);
    if (!b || b.fim < agora) { b = { n: 0, fim: agora + 60000 }; baldes.set(k, b); }
    b.n += 1;
    if (baldes.size > 5000) for (const [kk, v] of baldes) if (v.fim < agora) baldes.delete(kk);
    if (b.n > maxPorMinuto) {
      res.set('Retry-After', '30');
      throw new HttpError(429, 'MUITAS_REQUISICOES', 'Muitas requisições. Aguarde um instante.');
    }
    next();
  };
}

function criarRouter({ supabase, auth }) {
  const router = express.Router();
  const jsonDados = express.json({ limit: '2mb' });
  const T = auth.TABELA;

  const porIp = limitador(120, (req) => 'ip:' + req.ip);
  const porUsuario = limitador(900, (req) => 'u:' + (req.user ? req.user.id : req.ip));
  const porUsuarioEscrita = limitador(60, (req) => 'w:' + (req.user ? req.user.id : req.ip));

  // ---------- Pública: configuração do navegador (apenas valores públicos) ----------
  router.get('/config', porIp, (req, res) => {
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_PUBLISHABLE_KEY) {
      throw new HttpError(503, 'NAO_CONFIGURADO', 'Autenticação ainda não configurada no servidor.');
    }
    res.set('Cache-Control', 'no-store');
    res.json({
      supabaseUrl: process.env.SUPABASE_URL,
      supabasePublishableKey: process.env.SUPABASE_PUBLISHABLE_KEY
    });
  });

  // ---------- Sessão e solicitação de acesso (qualquer conta Google autenticada) ----------
  router.get('/me', auth.exigirSessao, porUsuario, async (req, res) => {
    const row = await auth.buscarAcesso(req.user);
    res.set('Cache-Control', 'no-store');
    if (!row) return res.json({ status: 'sem_cadastro', email: req.user.email });
    const resposta = { status: row.status, email: row.email, nome: row.nome };
    if (row.status === 'aprovado' && row.role) {
      resposta.perfil = auth.montarPerfil(row, req.user);
      resposta.tecnicos = Object.keys(cfg.TECNICOS);
    }
    res.json(resposta);
  });

  router.post('/access/request', auth.exigirSessao, porUsuarioEscrita, async (req, res) => {
    const row = await auth.solicitarAcesso(req.user);
    res.json({ status: row.status });
  });

  // ---------- Administração de acessos ----------
  const admin = express.Router();
  admin.use(auth.exigirSessao, porUsuarioEscrita, auth.exigirAprovado, auth.exigirGestor);

  const COLUNAS = 'id,email,nome,status,role,tecnico_nome,origem,solicitado_em,analisado_em,analisado_por_email,atualizado_em';

  admin.get('/acessos', async (req, res) => {
    const { data, error } = await supabase.from(T).select(COLUNAS).order('solicitado_em', { ascending: false }).limit(1000);
    if (error) throw new HttpError(500, 'ERRO_BANCO', 'Falha ao listar acessos.');
    res.set('Cache-Control', 'no-store');
    res.json({ acessos: data, eu: req.perfil.acessoId, tecnicos: Object.keys(cfg.TECNICOS) });
  });

  function validarPerfilEntrada(body, { obrigatorio }) {
    const out = {};
    if (body.role !== undefined || obrigatorio) {
      if (!cfg.ROLES.includes(body.role)) throw new HttpError(400, 'PERFIL_INVALIDO', 'Perfil inválido.');
      out.role = body.role;
      if (body.role === 'tecnico') {
        const nome = String(body.tecnicoNome || '');
        if (!Object.prototype.hasOwnProperty.call(cfg.TECNICOS, nome)) {
          throw new HttpError(400, 'TECNICO_INVALIDO', 'Escolha o técnico ao qual esta conta será vinculada.');
        }
        out.tecnico_nome = nome;
      } else {
        out.tecnico_nome = null;
      }
    }
    if (body.nome !== undefined) {
      const n = limparTexto(body.nome, 120);
      if (!n) throw new HttpError(400, 'NOME_INVALIDO', 'Nome inválido.');
      out.nome = n;
    }
    return out;
  }

  async function outrosGestoresAprovados(excluirId) {
    const { count, error } = await supabase.from(T).select('id', { count: 'exact', head: true })
      .eq('status', 'aprovado').in('role', cfg.ROLES_GERENCIAM_ACESSOS).neq('id', excluirId);
    if (error) throw new HttpError(500, 'ERRO_BANCO', 'Falha ao verificar administradores.');
    return count || 0;
  }

  async function carregarAlvo(req) {
    const id = String(req.params.id || '');
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new HttpError(400, 'ID_INVALIDO', 'Identificador inválido.');
    if (id === req.perfil.acessoId) {
      throw new HttpError(403, 'NAO_PODE_ALTERAR_PROPRIO', 'Você não pode alterar o seu próprio acesso.');
    }
    const { data, error } = await supabase.from(T).select('*').eq('id', id).maybeSingle();
    if (error) throw new HttpError(500, 'ERRO_BANCO', 'Falha ao consultar o acesso.');
    if (!data) throw new HttpError(404, 'NAO_ENCONTRADO', 'Cadastro não encontrado.');
    return data;
  }

  async function protegerUltimoGestor(alvo, vaiPerderGestao) {
    if (alvo.status === 'aprovado' && cfg.podeGerenciarAcessos(alvo.role) && vaiPerderGestao) {
      if ((await outrosGestoresAprovados(alvo.id)) < 1) {
        throw new HttpError(409, 'ULTIMO_GESTOR', 'Deve existir ao menos um administrador com acesso ao gerenciamento.');
      }
    }
  }

  const carimbo = (req) => ({ analisado_por_email: req.perfil.email, analisado_em: new Date().toISOString() });

  admin.post('/acessos', jsonDados, async (req, res) => {
    const email = normalizarEmail(req.body && req.body.email);
    if (!email) throw new HttpError(400, 'EMAIL_INVALIDO', 'E-mail inválido.');
    const dadosPerfil = validarPerfilEntrada(req.body, { obrigatorio: true });
    const { data: existente, error: e1 } = await supabase.from(T).select('*').eq('email', email).maybeSingle();
    if (e1) throw new HttpError(500, 'ERRO_BANCO', 'Falha ao consultar o acesso.');

    let row;
    if (existente) {
      if (existente.id === req.perfil.acessoId) throw new HttpError(403, 'NAO_PODE_ALTERAR_PROPRIO', 'Você não pode alterar o seu próprio acesso.');
      if (existente.status === 'aprovado') throw new HttpError(409, 'EMAIL_JA_CADASTRADO', 'Este e-mail já possui acesso aprovado.');
      const r = await supabase.from(T).update({ ...dadosPerfil, status: 'aprovado', ...carimbo(req) }).eq('id', existente.id).select(COLUNAS).single();
      if (r.error) throw new HttpError(500, 'ERRO_BANCO', 'Falha ao aprovar.');
      row = r.data;
    } else {
      const r = await supabase.from(T).insert({
        email, nome: dadosPerfil.nome || '', role: dadosPerfil.role, tecnico_nome: dadosPerfil.tecnico_nome,
        status: 'aprovado', origem: 'manual', ...carimbo(req)
      }).select(COLUNAS).single();
      if (r.error) throw new HttpError(500, 'ERRO_BANCO', 'Falha ao adicionar o usuário.');
      row = r.data;
    }
    await auth.registrarHistorico(row.id, 'adicionou_manual', req.perfil.email, { role: row.role });
    auth.limparCaches();
    res.status(201).json({ acesso: row });
  });

  admin.patch('/acessos/:id', jsonDados, async (req, res) => {
    const alvo = await carregarAlvo(req);
    const acao = String((req.body && req.body.acao) || '');
    let patch;

    switch (acao) {
      case 'aprovar':
      case 'reativar':
        if (!(acao === 'aprovar' ? ['pendente', 'recusado'] : ['revogado', 'recusado']).includes(alvo.status)) {
          throw new HttpError(409, 'ESTADO_INVALIDO', 'Esta ação não se aplica ao estado atual.');
        }
        patch = { ...validarPerfilEntrada(req.body, { obrigatorio: true }), status: 'aprovado', ...carimbo(req) };
        break;
      case 'recusar':
        if (alvo.status !== 'pendente') throw new HttpError(409, 'ESTADO_INVALIDO', 'Só é possível recusar solicitações pendentes.');
        patch = { status: 'recusado', ...carimbo(req) };
        break;
      case 'revogar':
        if (alvo.status !== 'aprovado') throw new HttpError(409, 'ESTADO_INVALIDO', 'Só é possível revogar acessos aprovados.');
        await protegerUltimoGestor(alvo, true);
        patch = { status: 'revogado', ...carimbo(req) };
        break;
      case 'atualizar': {
        if (alvo.status !== 'aprovado') throw new HttpError(409, 'ESTADO_INVALIDO', 'Só é possível editar acessos aprovados.');
        const novo = validarPerfilEntrada({ role: req.body.role || alvo.role, tecnicoNome: req.body.tecnicoNome !== undefined ? req.body.tecnicoNome : alvo.tecnico_nome, nome: req.body.nome }, { obrigatorio: true });
        await protegerUltimoGestor(alvo, !cfg.podeGerenciarAcessos(novo.role));
        patch = { ...novo, ...carimbo(req) };
        break;
      }
      default:
        throw new HttpError(400, 'ACAO_INVALIDA', 'Ação inválida.');
    }

    // Condição de estado evita sobrescrever uma decisão tomada por outra pessoa no mesmo instante.
    const r = await supabase.from(T).update(patch).eq('id', alvo.id).eq('status', alvo.status).select(COLUNAS).maybeSingle();
    if (r.error) throw new HttpError(500, 'ERRO_BANCO', 'Falha ao salvar.');
    if (!r.data) throw new HttpError(409, 'CONFLITO', 'Este cadastro foi alterado por outra pessoa. Atualize a lista.');
    await auth.registrarHistorico(alvo.id, acao, req.perfil.email, { de: alvo.status, para: r.data.status, role: r.data.role });
    auth.limparCaches();
    res.json({ acesso: r.data });
  });

  admin.delete('/acessos/:id', async (req, res) => {
    const alvo = await carregarAlvo(req);
    await protegerUltimoGestor(alvo, true);
    const r = await supabase.from(T).delete().eq('id', alvo.id);
    if (r.error) throw new HttpError(500, 'ERRO_BANCO', 'Falha ao excluir.');
    await auth.registrarHistorico(null, 'excluiu', req.perfil.email, { email: alvo.email, status: alvo.status });
    auth.limparCaches();
    res.json({ ok: true });
  });

  router.use('/admin', admin);

  // ---------- Dados (CAICAVV) — somente usuários aprovados ----------
  const dados = express.Router();
  dados.use(auth.exigirSessao, auth.exigirAprovado, porUsuario, (req, res, next) => {
    if (!store.disponivel()) throw new HttpError(503, 'DADOS_INDISPONIVEIS', 'Base de dados não configurada no servidor.');
    res.set('Cache-Control', 'no-store');
    next();
  });

  dados.get('/main', async (req, res) => {
    const r = await store.lerParaCliente();
    const etag = `W/"${r.versao}"`;
    res.set('ETag', etag);
    if (req.headers['if-none-match'] === etag) return res.status(304).end();
    res.json({ existe: r.existe, dados: r.dados });
  });

  dados.post('/main', jsonDados, porUsuarioEscrita, async (req, res) => {
    const modo = req.body && req.body.modo === 'update' ? 'update' : 'set';
    await store.escreverMain(req.perfil, req.body && req.body.dados, modo);
    res.json({ ok: true });
  });

  const exigirUploads = (req, res, next) => {
    if (!cfg.podeUsarUploads(req.perfil.role)) throw new HttpError(403, 'SEM_PERMISSAO', 'Seu perfil não pode alterar relatórios importados.');
    next();
  };

  dados.get('/relatorios', async (req, res) => {
    res.json({ relatorios: await store.listarRelatorios() });
  });
  dados.put('/relatorios/:id', jsonDados, exigirUploads, async (req, res) => {
    await store.gravarRelatorio(req.params.id, req.body && req.body.dados, req.body && req.body.modo);
    res.json({ ok: true });
  });
  dados.delete('/relatorios/:id', exigirUploads, async (req, res) => {
    await store.apagarRelatorio(req.params.id);
    res.json({ ok: true });
  });

  router.use('/data', dados);

  // ---------- Erros ----------
  router.use((req, res) => res.status(404).json({ erro: 'NAO_ENCONTRADO' }));
  // eslint-disable-next-line no-unused-vars
  router.use((err, req, res, next) => {
    if (err instanceof HttpError) {
      return res.status(err.status).json({ erro: err.code, mensagem: err.message });
    }
    if (err && err.type === 'entity.too.large') {
      return res.status(413).json({ erro: 'MUITO_GRANDE', mensagem: 'Dados grandes demais.' });
    }
    if (err instanceof SyntaxError) {
      return res.status(400).json({ erro: 'JSON_INVALIDO', mensagem: 'Requisição inválida.' });
    }
    console.error('Erro na API:', err && err.stack ? err.stack : err);
    res.status(500).json({ erro: 'ERRO_INTERNO', mensagem: 'Erro interno. Tente novamente.' });
  });

  return router;
}

module.exports = { criarRouter };
