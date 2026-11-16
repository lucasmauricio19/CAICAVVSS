'use strict';

const fs = require('fs');
const path = require('path');
const { prepararEscritaMain, paraLeitura, HttpError } = require('./dataRules');

// O Firestore passa a ser acessado SOMENTE pelo servidor (Firebase Admin SDK).
// As regras do Firestore devem ser fechadas (allow read, write: if false) — ver IMPLEMENTACAO-LOGIN.md.

let admin = null;
let ref = null;
let colRelatorios = null;
let FieldValue = null;

let cache = { pronto: false, existe: false, dados: null, versao: 0 };
let versaoSeq = 0;
let fila = Promise.resolve();

function lerCredencial() {
  const bruto = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!bruto) return null;
  const texto = bruto.trim().startsWith('{') ? bruto : Buffer.from(bruto, 'base64').toString('utf8');
  return JSON.parse(texto);
}

function iniciar() {
  const credencial = lerCredencial();
  if (!credencial) {
    console.log('FIREBASE_SERVICE_ACCOUNT_JSON ausente: acesso aos dados desativado.');
    return false;
  }
  admin = require('firebase-admin');
  admin.initializeApp({ credential: admin.credential.cert(credencial) });
  const db = admin.firestore();
  FieldValue = admin.firestore.FieldValue;
  ref = db.collection('caicavv').doc('atendimentos');
  colRelatorios = ref.collection('relatoriosImportados');
  escutar();
  console.log('Firestore (servidor) configurado.');
  return true;
}

const disponivel = () => !!ref;

function aplicarSnapshot(snap) {
  cache = { pronto: true, existe: snap.exists, dados: snap.exists ? snap.data() : null, versao: ++versaoSeq };
}

// Mantém o documento em memória e atualizado em tempo real: os navegadores consultam o
// servidor com frequência (campainha de "Aguardando"), mas o Firestore só é lido quando algo muda.
function escutar() {
  ref.onSnapshot(
    (snap) => { aplicarSnapshot(snap); },
    (erro) => {
      console.error('Escuta do Firestore interrompida:', erro && erro.message);
      cache.pronto = false;
      setTimeout(escutar, 5000);
    }
  );
}

async function lerMain() {
  if (!cache.pronto) aplicarSnapshot(await ref.get());
  return cache;
}

function comFila(tarefa) {
  const proxima = fila.then(tarefa, tarefa);
  fila = proxima.catch(() => {});
  return proxima;
}

// Equivale ao que o navegador fazia sozinho: se não há cadastros no banco, usa a lista inicial.
async function semearSeNecessario() {
  const seedPath = path.join(__dirname, '..', 'data', 'cadastros-seed.json');
  if (!fs.existsSync(seedPath)) return;
  const seed = JSON.parse(fs.readFileSync(seedPath, 'utf8'));
  await comFila(() => ref.firestore.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const dados = snap.exists ? snap.data() : null;
    const agora = new Date().toISOString();
    if (!snap.exists) {
      tx.set(ref, { itens: [], logs: [], cadastros: seed, criadoEm: agora }, { merge: true });
    } else if (!dados.cadastros || typeof dados.cadastros !== 'object') {
      tx.update(ref, { cadastros: seed, atualizadoEm: agora });
    }
  }));
  aplicarSnapshot(await ref.get());
}

async function lerParaCliente() {
  const c = await lerMain();
  return { existe: c.existe, dados: paraLeitura(c.dados), versao: c.versao };
}

async function escreverMain(perfil, entrada, modo) {
  await comFila(() => ref.firestore.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const atual = snap.exists ? snap.data() : {};
    const { campos, modo: m } = prepararEscritaMain(perfil, atual, entrada, modo);
    const finais = { ...campos };
    // Remove do banco as senhas que existiam em texto puro.
    if (atual.senhas !== undefined) finais.senhas = FieldValue.delete();
    if (atual.senhasAtualizadasEm !== undefined) finais.senhasAtualizadasEm = FieldValue.delete();
    if (Object.keys(finais).length === 0) return;
    if (snap.exists && m === 'update') tx.update(ref, finais);
    else tx.set(ref, finais, { merge: true });
  }));
  aplicarSnapshot(await ref.get());
}

// ---------- Subcoleção de relatórios importados ----------
const ID_VALIDO = /^[A-Za-z0-9_-]{1,64}$/;

function validarIdRelatorio(id) {
  if (!ID_VALIDO.test(String(id || ''))) throw new HttpError(400, 'ID_INVALIDO', 'Identificador inválido.');
  return id;
}

function validarDocRelatorio(dados) {
  if (!dados || typeof dados !== 'object' || Array.isArray(dados)) {
    throw new HttpError(400, 'DADOS_INVALIDOS', 'Relatório inválido.');
  }
  if (dados.itens !== undefined && !Array.isArray(dados.itens)) {
    throw new HttpError(400, 'DADOS_INVALIDOS', 'Itens do relatório inválidos.');
  }
  return dados;
}

async function listarRelatorios() {
  const snap = await colRelatorios.get();
  return snap.docs.map((d) => ({ id: d.id, dados: d.data() }));
}

async function gravarRelatorio(id, dados, modo) {
  validarIdRelatorio(id);
  validarDocRelatorio(dados);
  if (modo === 'update') await colRelatorios.doc(id).update(dados);
  else await colRelatorios.doc(id).set(dados);
}

async function apagarRelatorio(id) {
  validarIdRelatorio(id);
  await colRelatorios.doc(id).delete();
}

module.exports = {
  iniciar, disponivel, semearSeNecessario, lerParaCliente,
  escreverMain, listarRelatorios, gravarRelatorio, apagarRelatorio
};
