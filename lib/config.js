'use strict';

// Perfis aceitos pelo sistema. Os valores são os mesmos usados hoje no index.html
// (tecnico, recepcao, adm, coordenacao). "Administrador" na interface = "adm".
const ROLES = ['adm', 'coordenacao', 'recepcao', 'tecnico'];

const ROLE_LABELS = {
  adm: 'Administrador',
  coordenacao: 'Coordenação',
  recepcao: 'Recepção',
  tecnico: 'Técnico'
};

const STATUS = ['pendente', 'aprovado', 'recusado', 'revogado'];

// Técnicos existentes no catálogo do index.html (objeto "usuarios").
// A agenda filtra pelo NOME, então cada conta Google de técnico é vinculada a um deles.
// A chave (login) é a mesma do catálogo antigo, para as preferências por login continuarem valendo.
const TECNICOS = {
  Josiane: 'josiane.caicavv',
  'Cláudia': 'claudia.caicavv',
  Cintya: 'cintya.caicavv',
  'Angélica': 'angelica.caicavv'
};

// Quem pode abrir o "Gerenciamento de acessos" (mesma regra que já valia para trocar senhas).
const ROLES_GERENCIAM_ACESSOS = ['adm', 'coordenacao'];

// Permissões por perfil, espelhando o objeto "permissoes" e as funções pode*() do index.html.
const PERMISSOES = {
  tecnico: { add: true, del: true, marcar: true },
  recepcao: { add: false, del: false, marcar: true },
  adm: { add: true, del: true, marcar: true },
  coordenacao: { add: true, del: true, marcar: true }
};

const podeGerenciarAcessos = (role) => ROLES_GERENCIAM_ACESSOS.includes(role);
const podeGerenciarAbasPassadas = (role) => role === 'adm' || role === 'recepcao';
const podeAlterarEntradas = (role) => role === 'adm' || role === 'coordenacao';
const podeUsarUploads = (role) => role === 'adm' || role === 'recepcao' || role === 'coordenacao';

// Chave usada nas preferências por login (tema, som de "Aguardando"...).
function loginKeyDe(acesso) {
  if (acesso.role === 'tecnico' && TECNICOS[acesso.tecnico_nome]) {
    return TECNICOS[acesso.tecnico_nome];
  }
  return 'g_' + String(acesso.id || acesso.auth_user_id || '').replace(/-/g, '').slice(0, 12);
}

module.exports = {
  ROLES,
  ROLE_LABELS,
  STATUS,
  TECNICOS,
  PERMISSOES,
  podeGerenciarAcessos,
  podeGerenciarAbasPassadas,
  podeAlterarEntradas,
  podeUsarUploads,
  loginKeyDe
};
