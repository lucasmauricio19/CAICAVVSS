'use strict';

const cfg = require('./config');

class HttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const str = (v, max) => (typeof v === 'string' && v.length <= max ? v : null);

// Campos que o sistema atual grava no documento principal (caicavv/atendimentos).
// Qualquer campo fora desta lista é recusado.
const CAMPOS_META = new Set([
  'atualizadoEm',
  'criadoEm',
  'uploadsMigradosEm',
  'uploadsInvalidosRemovidosEm',
  'abasPassadasAtualizadasEm',
  'preferenciasSonsAtualizadasEm',
  'entradasAtualizadasEm'
]);

// Campos de identidade do agendamento que a Recepção não pode alterar (ela só marca status).
const CAMPOS_FIXOS_RECEPCAO = ['id', 'pasta', 'nome', 'tecnico', 'data', 'hora', 'descricao'];

function itemKey(item) {
  return item && typeof item.id === 'string' && item.id ? item.id : '__' + JSON.stringify(item);
}

function validarItens(lista) {
  if (!Array.isArray(lista) || lista.length > 20000) {
    throw new HttpError(400, 'DADOS_INVALIDOS', 'Lista de atendimentos inválida.');
  }
  lista.forEach((i) => {
    if (!isObj(i)) throw new HttpError(400, 'DADOS_INVALIDOS', 'Atendimento inválido.');
    if (i.id !== undefined && str(i.id, 160) === null) {
      throw new HttpError(400, 'DADOS_INVALIDOS', 'Identificador de atendimento inválido.');
    }
  });
  return lista;
}

/**
 * Decide como a lista de atendimentos fica depois de uma gravação.
 * - Administrador e Coordenação: a lista enviada substitui a atual (comportamento de hoje).
 * - Técnico: só altera, cria ou remove atendimentos do próprio nome; o resto vem do servidor.
 * - Recepção: só altera campos de status dos atendimentos existentes; não cria nem apaga
 *   (exceto sobras antigas de importação marcadas como origem "upload").
 */
function mergeItens(perfil, armazenados, recebidos) {
  validarItens(recebidos);
  const atuais = Array.isArray(armazenados) ? armazenados : [];

  if (perfil.role === 'adm' || perfil.role === 'coordenacao') return recebidos;

  if (perfil.role === 'tecnico') {
    const nome = perfil.tecnicoNome;
    if (!nome) throw new HttpError(403, 'SEM_VINCULO', 'Conta de técnico sem vínculo.');
    const doTecnico = (i) => i && i.tecnico === nome;
    const idsAtuaisDoTecnico = new Set(atuais.filter(doTecnico).map(itemKey));
    const todosIdsAtuais = new Set(atuais.map(itemKey));
    const recebidosPorId = new Map();
    const novos = [];
    const idsNovos = new Set();
    recebidos.forEach((i) => {
      const k = itemKey(i);
      if (idsAtuaisDoTecnico.has(k)) recebidosPorId.set(k, i); // pode até reatribuir o próprio atendimento
      // Atendimento novo: precisa ser do próprio técnico e não pode reutilizar o id de um existente.
      else if (doTecnico(i) && !todosIdsAtuais.has(k) && !idsNovos.has(k)) { novos.push(i); idsNovos.add(k); }
    });
    const resultado = [];
    atuais.forEach((a) => {
      if (!doTecnico(a)) resultado.push(a);
      else if (recebidosPorId.has(itemKey(a))) resultado.push(recebidosPorId.get(itemKey(a)));
    });
    return [...novos, ...resultado];
  }

  if (perfil.role === 'recepcao') {
    const recebidosPorId = new Map(recebidos.map((i) => [itemKey(i), i]));
    const resultado = [];
    atuais.forEach((a) => {
      const r = recebidosPorId.get(itemKey(a));
      if (!r) {
        if (a && a.origem === 'upload') return; // limpeza de importações antigas
        resultado.push(a);
        return;
      }
      const mesclado = { ...r };
      CAMPOS_FIXOS_RECEPCAO.forEach((c) => {
        if (a[c] === undefined) delete mesclado[c];
        else mesclado[c] = a[c];
      });
      resultado.push(mesclado);
    });
    return resultado;
  }

  throw new HttpError(403, 'SEM_PERMISSAO', 'Perfil sem permissão.');
}

/** O histórico só cresce: entradas novas entram na frente, as antigas nunca são removidas. */
function mergeLogs(perfil, armazenados, recebidos) {
  if (!Array.isArray(recebidos) || recebidos.length > 2000) {
    throw new HttpError(400, 'DADOS_INVALIDOS', 'Histórico inválido.');
  }
  const atuais = Array.isArray(armazenados) ? armazenados : [];
  const ids = new Set(atuais.map((l) => l && l.id));
  const novos = recebidos
    .filter((l) => isObj(l) && typeof l.id === 'string' && !ids.has(l.id))
    .map((l) => ({ ...l, usuario: perfil.nome, perfil: perfil.role })); // carimbo feito pelo servidor
  return [...novos, ...atuais].slice(0, 500);
}

function validarCadastros(c) {
  if (!isObj(c) || Object.keys(c).length > 20000) {
    throw new HttpError(400, 'DADOS_INVALIDOS', 'Cadastros inválidos.');
  }
  Object.entries(c).forEach(([pasta, nomes]) => {
    if (pasta.length > 20 || !Array.isArray(nomes) || nomes.length > 100 ||
        nomes.some((n) => str(n, 220) === null)) {
      throw new HttpError(400, 'DADOS_INVALIDOS', 'Cadastro de paciente inválido.');
    }
  });
  return c;
}

function exigir(condicao, campo) {
  if (!condicao) {
    throw new HttpError(403, 'SEM_PERMISSAO', `Seu perfil não pode alterar "${campo}".`);
  }
}

/**
 * Valida e prepara uma gravação no documento principal.
 * Retorna { campos, modo } com os valores finais de cada campo permitido.
 */
function prepararEscritaMain(perfil, atual, entrada, modo) {
  if (!isObj(entrada)) throw new HttpError(400, 'DADOS_INVALIDOS', 'Dados inválidos.');
  const doc = isObj(atual) ? atual : {};
  const campos = {};
  const role = perfil.role;

  for (const [campo, valor] of Object.entries(entrada)) {
    if (campo === 'senhas' || campo === 'senhasAtualizadasEm') continue; // senhas não existem mais

    if (CAMPOS_META.has(campo)) {
      if (str(valor, 40) === null) throw new HttpError(400, 'DADOS_INVALIDOS', `Campo "${campo}" inválido.`);
      if (campo === 'uploadsMigradosEm' || campo === 'uploadsInvalidosRemovidosEm') exigir(cfg.podeUsarUploads(role), campo);
      if (campo === 'abasPassadasAtualizadasEm') exigir(cfg.podeGerenciarAbasPassadas(role), campo);
      if (campo === 'entradasAtualizadasEm') exigir(cfg.podeAlterarEntradas(role), campo);
      campos[campo] = valor;
      continue;
    }

    switch (campo) {
      case 'itens':
        campos.itens = mergeItens(perfil, doc.itens, valor);
        break;
      case 'logs':
        campos.logs = mergeLogs(perfil, doc.logs, valor);
        break;
      case 'cadastros':
        campos.cadastros = validarCadastros(valor); // ação aberta a todos os perfis hoje
        break;
      case 'abasPassadas':
        exigir(cfg.podeGerenciarAbasPassadas(role), campo);
        if (!Array.isArray(valor) || valor.length > 500) throw new HttpError(400, 'DADOS_INVALIDOS', 'Abas inválidas.');
        campos.abasPassadas = valor;
        break;
      case 'entradasManuaisCAICAVV':
        exigir(cfg.podeAlterarEntradas(role), campo);
        if (!Array.isArray(valor) || valor.length > 20000) throw new HttpError(400, 'DADOS_INVALIDOS', 'Entradas inválidas.');
        campos.entradasManuaisCAICAVV = valor;
        break;
      case 'preferenciasSons': {
        if (!isObj(valor)) throw new HttpError(400, 'DADOS_INVALIDOS', 'Preferências inválidas.');
        const minha = valor[perfil.loginKey];
        // Cada pessoa só grava a própria preferência; as demais permanecem como estão.
        campos.preferenciasSons = { ...(isObj(doc.preferenciasSons) ? doc.preferenciasSons : {}) };
        if (minha !== undefined) {
          if (JSON.stringify(minha).length > 2000) throw new HttpError(400, 'DADOS_INVALIDOS', 'Preferência inválida.');
          campos.preferenciasSons[perfil.loginKey] = minha;
        }
        break;
      }
      default:
        throw new HttpError(400, 'CAMPO_NAO_PERMITIDO', `Campo "${campo}" não é aceito.`);
    }
  }
  return { campos, modo: modo === 'update' ? 'update' : 'set' };
}

/** O que o navegador recebe do documento principal: nunca senhas. */
function paraLeitura(doc) {
  const copia = { ...(doc || {}) };
  delete copia.senhas;
  delete copia.senhasAtualizadasEm;
  return copia;
}

module.exports = { HttpError, mergeItens, mergeLogs, prepararEscritaMain, paraLeitura, validarCadastros };
