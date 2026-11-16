'use strict';
const assert = require('assert');
const { mergeItens, mergeLogs, prepararEscritaMain, paraLeitura, HttpError } = require('../lib/dataRules');
const cfg = require('../lib/config');

let n = 0;
const t = (nome, fn) => { fn(); n++; console.log('ok -', nome); };
const falha = (fn, code) => assert.throws(fn, (e) => e instanceof HttpError && (!code || e.code === code));

const jo = { role: 'tecnico', tecnicoNome: 'Josiane', nome: 'Josiane', loginKey: 'josiane.caicavv' };
const rec = { role: 'recepcao', nome: 'Recepção', loginKey: 'g_abc' };
const adm = { role: 'adm', nome: 'Johanna', loginKey: 'g_adm' };
const coord = { role: 'coordenacao', nome: 'Coord', loginKey: 'g_co' };

const base = [
  { id: 'a1', tecnico: 'Josiane', pasta: '1', nome: 'X', data: '2026-01-01', hora: '08:00', status: 'agendado' },
  { id: 'a2', tecnico: 'Cintya', pasta: '2', nome: 'Y', data: '2026-01-01', hora: '09:00', status: 'agendado' },
  { id: 'u1', tecnico: 'Cintya', origem: 'upload', status: 'realizado' }
];

t('técnico: não apaga nem altera atendimento de outro técnico', () => {
  const r = mergeItens(jo, base, [{ ...base[0], status: 'realizado' }]); // stale: sem a2/u1
  assert.strictEqual(r.length, 3);
  assert.strictEqual(r.find(i => i.id === 'a2').status, 'agendado');
  assert.strictEqual(r.find(i => i.id === 'a1').status, 'realizado');
});
t('técnico: tentativa de criar atendimento para outro técnico é ignorada', () => {
  const r = mergeItens(jo, base, [...base, { id: 'n1', tecnico: 'Cintya' }]);
  assert.ok(!r.find(i => i.id === 'n1'));
});
t('técnico: cria o próprio e apaga o próprio', () => {
  let r = mergeItens(jo, base, [{ id: 'n2', tecnico: 'Josiane' }, ...base]);
  assert.strictEqual(r[0].id, 'n2');
  r = mergeItens(jo, base, base.filter(i => i.id !== 'a1'));
  assert.ok(!r.find(i => i.id === 'a1') && r.find(i => i.id === 'a2'));
});
t('técnico: não consegue alterar item alheio mudando o campo tecnico', () => {
  const r = mergeItens(jo, base, [{ ...base[1], tecnico: 'Josiane', status: 'cancelado' }]);
  assert.strictEqual(r.find(i => i.id === 'a2').status, 'agendado');
  assert.strictEqual(r.find(i => i.id === 'a2').tecnico, 'Cintya');
});
t('técnico sem vínculo é bloqueado', () => falha(() => mergeItens({ role: 'tecnico' }, base, []), 'SEM_VINCULO'));
t('recepção: marca status mas não muda data/hora/técnico, não cria nem apaga', () => {
  const r = mergeItens(rec, base, [
    { ...base[0], status: 'aguardando', hora: '10:00', tecnico: 'Outro' },
    { id: 'novo', tecnico: 'Josiane' }
  ]);
  const a1 = r.find(i => i.id === 'a1');
  assert.strictEqual(a1.status, 'aguardando');
  assert.strictEqual(a1.hora, '08:00');
  assert.strictEqual(a1.tecnico, 'Josiane');
  assert.ok(!r.find(i => i.id === 'novo'));
  assert.ok(r.find(i => i.id === 'a2')); // não foi apagado
  assert.ok(!r.find(i => i.id === 'u1')); // sobra antiga de upload pode ser limpa
});
t('adm e coordenação substituem a lista (comportamento atual)', () => {
  assert.deepStrictEqual(mergeItens(adm, base, [base[0]]), [base[0]]);
  assert.deepStrictEqual(mergeItens(coord, base, []), []);
});
t('itens inválidos são recusados', () => {
  falha(() => mergeItens(adm, [], 'x'), 'DADOS_INVALIDOS');
  falha(() => mergeItens(adm, [], [1]), 'DADOS_INVALIDOS');
  falha(() => mergeItens(adm, [], [{ id: 5 }]), 'DADOS_INVALIDOS');
});
t('histórico só cresce e é carimbado pelo servidor', () => {
  const antigos = [{ id: 'l1', usuario: 'Fulano' }];
  const r = mergeLogs(jo, antigos, [{ id: 'l2', usuario: 'FORJADO', perfil: 'adm' }]);
  assert.strictEqual(r.length, 2);
  assert.strictEqual(r[0].usuario, 'Josiane');
  assert.strictEqual(r[0].perfil, 'tecnico');
  assert.deepStrictEqual(mergeLogs(jo, antigos, []), antigos); // apagar não funciona
});
t('campos: senhas são descartadas; campo desconhecido é recusado', () => {
  const { campos } = prepararEscritaMain(adm, {}, { senhas: { x: 1 }, atualizadoEm: '2026-01-01' }, 'set');
  assert.ok(!('senhas' in campos) && campos.atualizadoEm);
  falha(() => prepararEscritaMain(adm, {}, { hack: 1 }, 'set'), 'CAMPO_NAO_PERMITIDO');
});
t('campos por perfil: abas passadas, entradas e uploads', () => {
  falha(() => prepararEscritaMain(jo, {}, { abasPassadas: [] }, 'set'), 'SEM_PERMISSAO');
  falha(() => prepararEscritaMain(rec, {}, { entradasManuaisCAICAVV: [] }, 'set'), 'SEM_PERMISSAO');
  falha(() => prepararEscritaMain(jo, {}, { uploadsMigradosEm: 'x' }, 'set'), 'SEM_PERMISSAO');
  prepararEscritaMain(rec, {}, { abasPassadas: [] }, 'set');
  prepararEscritaMain(coord, {}, { entradasManuaisCAICAVV: [] }, 'set');
});
t('preferências: só a própria chave é gravada', () => {
  const { campos } = prepararEscritaMain(jo, { preferenciasSons: { outro: 'som9' } },
    { preferenciasSons: { 'josiane.caicavv': 'som2', outro: 'HACK' } }, 'set');
  assert.deepStrictEqual(campos.preferenciasSons, { outro: 'som9', 'josiane.caicavv': 'som2' });
});
t('cadastros: validação de formato', () => {
  prepararEscritaMain(rec, {}, { cadastros: { '1': ['MARIA'] } }, 'update');
  falha(() => prepararEscritaMain(rec, {}, { cadastros: { '1': 'MARIA' } }, 'update'), 'DADOS_INVALIDOS');
});
t('leitura nunca devolve senhas', () => {
  const l = paraLeitura({ itens: [], senhas: { a: 'b' }, senhasAtualizadasEm: 'x' });
  assert.ok(!('senhas' in l) && !('senhasAtualizadasEm' in l) && 'itens' in l);
});
t('config: perfis e vínculo de técnico', () => {
  assert.ok(cfg.podeGerenciarAcessos('adm') && cfg.podeGerenciarAcessos('coordenacao'));
  assert.ok(!cfg.podeGerenciarAcessos('recepcao') && !cfg.podeGerenciarAcessos('tecnico'));
  assert.strictEqual(cfg.loginKeyDe({ role: 'tecnico', tecnico_nome: 'Cláudia' }), 'claudia.caicavv');
  assert.ok(/^g_[0-9a-f]{12}$/.test(cfg.loginKeyDe({ role: 'adm', id: '123e4567-e89b-12d3-a456-426614174000' })));
});
console.log(`\n${n} grupos de testes passaram.`);
