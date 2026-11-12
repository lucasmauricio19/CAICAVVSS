
const express = require('express');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;
const publicDir = __dirname;

app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));

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

app.use((req, res, next) => {
  const fileName = path.basename(req.path).toLowerCase();

  if (
    blockedFiles.has(fileName) ||
    req.path.toLowerCase().startsWith('/.git') ||
    req.path.toLowerCase().startsWith('/node_modules')
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

// Arquivos públicos do site
app.use(express.static(publicDir, {
  dotfiles: 'deny',
  index: 'index.html'
}));

// Rota de fallback compatível com Express 5
app.get('/{*splat}', (req, res) => {
  res.sendFile(path.join(publicDir, 'index.html'));
});

// Inicialização
app.listen(PORT, () => {
  console.log(`CAICAVV iniciado na porta ${PORT}.`);
});
