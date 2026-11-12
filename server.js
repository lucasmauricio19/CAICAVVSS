const express = require('express');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;
const publicDir = __dirname;

app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));

// Cabeçalhos básicos de segurança. As políticas mais específicas serão
// configuradas quando implementarmos autenticação e autorização.
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  next();
});

// Cliente Supabase exclusivo do servidor. A chave service_role nunca deve
// ser colocada no index.html nem enviada ao navegador.
let supabase = null;
if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
  supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
  console.log('Configuração do Supabase encontrada.');
} else {
  console.log('Supabase ainda não configurado. O site pode iniciar normalmente.');
}

// Verificação de saúde usada pelo Render.
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

// Nesta etapa, o site continua servindo o index.html atual sem alterações.
app.use(express.static(publicDir));
app.get('*', (req, res) => {
  res.sendFile(path.join(publicDir, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`CAICAVV iniciado na porta ${PORT}.`);
});
