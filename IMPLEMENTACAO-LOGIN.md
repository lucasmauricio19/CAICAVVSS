# CAICAVV — Login Google e controle de acesso

## O que mudou (e o que NÃO mudou)

**Não mudou:** layout, abas, menus, pacientes, atendimentos, históricos, relatórios, números de pastas e as
permissões por perfil. Nenhum paciente é criado, importado ou alterado pelo login.

**Mudou:**

| Arquivo | O que foi feito |
|---|---|
| `index.html` | Seletor de perfil sem senha → botão "Entrar com Google" + telas (login, pendente, recusado, revogado, erro). Novo bloco em Configurações: **Minha conta** e **Gerenciamento de acessos**. Removidos: senhas padrão e tela "Alterar senha". Removida a lista de 953 pastas/pacientes que estava dentro do HTML público. O SDK do Firebase saiu do navegador: o sistema chama `DOC_ATENDIMENTOS...` como antes, mas agora isso conversa com o servidor. |
| `server.js` | Monta a API (`/api`), inicia o acesso ao Firestore pelo servidor, serve só `index.html`, `/img` e `favicon.png` (antes servia a pasta inteira). |
| `lib/*.js` (novos) | Sessão, autorização, rotas administrativas e regras de dados (verificadas no servidor). |
| `data/cadastros-seed.json` (novo) | A lista de pacientes que estava no HTML, agora só no servidor (usada apenas se o banco não tiver cadastros). |
| `sql/01_acessos.sql` (novo) | Tabelas, RLS e administrador inicial. |
| `package.json` / `render.yaml` | Dependência `firebase-admin` e variável `FIREBASE_SERVICE_ACCOUNT_JSON`. |
| `test/*.js` (novos) | 39 testes automáticos (`npm test`). |

## Como a proteção funciona

1. Quem entra com Google só tem **sessão**. Acesso só existe se o e-mail estiver `aprovado` em `caicavv_acessos`.
2. Toda rota de dados (`/api/data/*`) e de administração (`/api/admin/*`) valida o token no Supabase e consulta o
   status **a cada chamada** (cache de 5 s). Revogou? Em segundos a pessoa perde o acesso.
3. O Firestore deixa de ser acessado pelo navegador. Só o servidor lê/grava (Firebase Admin SDK).
4. Regras no servidor por perfil (espelham o que o sistema já fazia na tela):
   - **Técnico:** só cria/edita/apaga atendimentos do próprio nome (o servidor ignora o resto).
   - **Recepção:** só altera status; não muda data/hora/técnico, não cria nem apaga atendimentos.
   - **Administrador / Coordenação:** como hoje. Abas passadas: adm e recepção. Entradas: adm e coordenação.
   - Histórico (`logs`) só cresce e o usuário/perfil são carimbados pelo servidor (não dá para forjar).
5. Gerenciamento de acessos: só adm/coordenação; ninguém altera o **próprio** acesso; sempre sobra ao menos um
   administrador; tudo fica registrado em `caicavv_acessos_historico`.

## Perfis e a regra "Johanna"

O código já tinha uma regra: o lembrete de reagendamento aparece para técnicos e para o **adm chamado "Johanna"**.
Isso continua valendo: ao aprovar a conta dela, escolha **Administrador** e deixe o nome como **Johanna**
(editável em "Editar perfil").

Contas de **Técnico** precisam ser vinculadas a um nome (Josiane, Cláudia, Cintya, Angélica). A agenda e as
preferências continuam no mesmo cadastro de antes.

## Passo a passo de implantação (nesta ordem)

### 1) Supabase — criar as tabelas
Supabase > **SQL Editor** > New query > cole `sql/01_acessos.sql` > **Run**.
Já cadastra `mattosmay@gmail.com` como **Coordenação** aprovada (vincula-se sozinha no primeiro login).

### 2) Conferir o Google no Supabase (já feito por você)
Authentication > Sign In / Providers > Google ativo. Authentication > URL Configuration: Site URL
`https://caicavvss.onrender.com` e Redirect URL `https://caicavvss.onrender.com/**` (já estão).

### 3) Firebase — chave do servidor
Console do Firebase > ⚙ Configurações do projeto > **Contas de serviço** > **Gerar nova chave privada**
(baixa um `.json`). **Não coloque esse arquivo no GitHub.**

### 4) Render — variáveis de ambiente
Service > **Environment** > Add:

| Variável | Valor |
|---|---|
| `FIREBASE_SERVICE_ACCOUNT_JSON` | **Todo o conteúdo** do `.json` do passo 3 |

Já existentes e usadas: `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`
(a chave secreta fica só no servidor; nada de chave secreta vai para o navegador).

### 5) Publicar
Suba os arquivos para o GitHub (mantendo `package.json` novo) e faça o deploy no Render. Confira nos logs:
`Configuração do Supabase encontrada.` e `Firestore (servidor) configurado.`

### 6) Fechar o Firestore (IMPORTANTE — só depois do passo 5 funcionar)
Firebase > Firestore Database > **Regras**:
```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} { allow read, write: if false; }
  }
}
```
Publicar. O servidor continua funcionando (o Admin SDK não usa essas regras); o navegador não acessa mais nada.
Sem este passo, o banco continua aberto a quem tiver a chave que estava no site.

## Como testar

1. **Login:** abra o site > "Entrar com Google" > escolha `mattosmay@gmail.com`. Deve entrar direto como Coordenação.
   Atualize a página (F5): continua logada. Menu lateral > Sair: volta ao login.
2. **Solicitação:** em outra janela anônima, entre com outra conta Google. Deve aparecer
   "Seu acesso ainda não foi autorizado…" e o botão **Solicitar acesso**. Clique: vira "Acesso pendente".
   Clique de novo/atualize: continua uma única solicitação.
3. **Aprovação:** com a conta da coordenadora: Configurações > Gerenciamento de acessos > Pendentes > Aprovar >
   escolha o perfil (técnico pede o vínculo). Na janela anônima, "Verificar novamente": entra no sistema.
4. **Revogação:** Aprovados > Revogar > confirmar. Em até ~6 s a outra pessoa é avisada e, ao recarregar,
   vê "Acesso revogado". Em "Recusados e revogados" dá para Reativar ou Excluir.
5. **Manual:** "+ Adicionar usuário" com um e-mail e perfil; a pessoa entra já aprovada.
6. **Permissões:** entre como Técnico: não aparece "Gerenciamento de acessos" e, mesmo chamando a API
   direto, o servidor responde 403.
7. **Dados:** confira que pacientes, agenda e relatórios aparecem iguais aos de antes.

Testes automáticos locais: `npm install && npm test`.

## Pontos de atenção

- **Senhas antigas:** o campo `senhas` (texto puro) é apagado do Firestore na primeira gravação feita pelo servidor.
  Confirme no console do Firebase (documento `caicavv/atendimentos`) e apague manualmente se ainda existir.
- **Atualização em tempo real:** a campainha de "Aguardando" passou a consultar o servidor a cada 6 s
  (antes era instantâneo). O servidor mantém o documento em memória, então isso não aumenta a leitura do Firestore.
- **Dois técnicos ao mesmo tempo:** agora um não sobrescreve mais a agenda do outro (antes isso podia acontecer).
- **Testes locais (localhost):** para logar em `http://localhost:3000` é preciso incluir essa URL em
  Redirect URLs no Supabase. Em produção não é necessário.
- Não foi adicionada CSP (política de conteúdo) para não quebrar os scripts inline existentes.
