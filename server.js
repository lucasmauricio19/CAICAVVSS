
const express = require('express');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const store = require('./lib/store');
const { criarAuth } = require('./lib/auth');
const { criarRouter } = require('./lib/api');

const app = express();
const PORT = process.env.PORT || 3000;
const publicDir = __dirname;

app.disable('x-powered-by');
app.set('trust proxy', 1); // Render fica atrás de um proxy

// Cabeçalhos básicos de segurança
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  next();
});

// Bloqueia o acesso público a arquivos internos
const blockedFiles = new Set([
  'server.js',
  'package.json',
  'package-lock.json',
  'render.yaml',
  '.env'
]);
const blockedPrefixes = ['/.git', '/node_modules', '/lib', '/data', '/sql', '/test'];

app.use((req, res, next) => {
  const fileName = path.basename(req.path).toLowerCase();

  if (
    blockedFiles.has(fileName) ||
    blockedPrefixes.some((p) => req.path.toLowerCase().startsWith(p))
  ) {
    return res.sendStatus(404);
  }

  next();
});

// Cliente Supabase exclusivo do servidor
// Nunca colocar a chave secreta no navegador.
const supabaseSecretKey =
  process.env.SUPABASE_SECRET_KEY ||
  process.env.SUPABASE_SERVICE_ROLE_KEY;

let supabase = null;

if (process.env.SUPABASE_URL && supabaseSecretKey) {
  supabase = createClient(
    process.env.SUPABASE_URL,
    supabaseSecretKey,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    }
  );

  console.log('Configuração do Supabase encontrada.');
} else {
  console.log(
    'Supabase ainda não configurado. Servidor iniciado sem conexão com o banco.'
  );
}

// Verificação de saúde do servidor
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok'
  });
});

// API protegida (login, solicitações de acesso, administração e dados)
if (supabase) {
  const auth = criarAuth(supabase);
  app.use('/api', criarRouter({ supabase, auth }));
} else {
  app.use('/api', (req, res) => {
    res.status(503).json({ erro: 'NAO_CONFIGURADO', mensagem: 'Servidor sem configuração do Supabase.' });
  });
}

// Acesso aos dados dos pacientes e atendimentos: somente pelo servidor (Firebase Admin SDK)
try {
  if (store.iniciar()) {
    store.semearSeNecessario().catch((e) => console.error('Falha ao preparar a base de cadastros:', e.message));
  }
} catch (e) {
  console.error('Falha ao iniciar o Firestore no servidor:', e.message);
}

// Arquivos públicos do site: apenas o que o navegador precisa (nada de pastas internas)
app.use('/img', express.static(path.join(publicDir, 'img'), { dotfiles: 'deny' }));
app.get('/favicon.png', (req, res) => res.sendFile(path.join(publicDir, 'favicon.png')));

// Rota de fallback compatível com Express 5 (a página inicial é o próprio sistema)
app.get('/{*splat}', (req, res) => {
  res.set('Cache-Control', 'no-cache');
  res.sendFile(path.join(publicDir, 'index.html'));
});

// Inicialização
app.listen(PORT, () => {
  console.log(`CAICAVV iniciado na porta ${PORT}.`);
});
