# Relatório da auditoria — CAICAVV (login Google, Supabase e inicialização)

## Resumo

Todos os pontos da auditoria foram verificados **no código real, em um navegador de verdade** (Chromium), e não só
por testes simulados. Os erros dos itens 1, 2 e 3 foram **reproduzidos antes de corrigir**: na tela de login, a versão
anterior gerava **19 erros JavaScript em 5 segundos** e chamava `aplicarPermissoesNaTela()` 17 vezes sem ninguém logado.
Depois da correção: **0 erros e 0 chamadas** na tela de login.

## Problemas encontrados e correções

| # | Problema | Causa real | Correção |
|---|---|---|---|
| 1 | `TypeError … reading 'role'` em `aplicarPermissoesNaTela()` | Confirmado. Quem disparava era o `init()` do módulo de abas passadas (temporizador de 300 ms + `DOMContentLoaded`), que rodava na tela de login com `tecnicoLogado = null`. | Novo validador único `perfilValidoCaicavv()`: exige usuário carregado, `role` do tipo texto e **existente de verdade** em `permissoes` (a checagem usa `hasOwnProperty`, então valores como `constructor` ou `__proto__` não passam). Sem perfil válido, nenhuma permissão é concedida, nenhum perfil alternativo é assumido e, se o sistema estiver aberto, ele é fechado e a tela de acesso volta (`bloquearSemPerfilCaicavv`). Antes do login (sistema oculto) a função apenas retorna, sem erro. |
| 2 | `montarMenu()` acessava `tecnicoLogado.role` sem checar | Confirmado. | Usa o mesmo validador. Sem perfil, nenhum menu é montado. O nome e o perfil exibidos vêm do perfil retornado pelo servidor. |
| 3 | Ordem de inicialização do `init()` | Confirmado, e havia **mais um problema**: o módulo de abas passadas e o de entradas **liam o banco antes do login**, gerando "Sessão ausente." e um aviso de erro na tela de login. | `init()` foi dividido em `initVisual()` (pode rodar a qualquer momento) e a parte que depende do usuário (só roda com perfil válido). `entrarComo()` agora dispara o evento `caicavv:perfil-pronto`, que reaplica permissões, abas e entradas após o login ou a recuperação da sessão. As leituras antes do login foram removidas, e a ponte de dados recusa pedidos `/data` sem perfil (sem rede, sem erro). `render()` também passou a usar o validador. |
| 4 | Integração Google OAuth × Supabase | Verificada. O cliente é criado antes de o botão aparecer e o fluxo PKCE está correto. **Dois defeitos reais:** (a) se `/api/config` falhasse, "Tentar novamente" levava ao botão de login com o cliente inexistente; (b) a mensagem de erro do Google na URL era lida depois de o SDK limpar a URL. | (a) O botão de login só existe com o cliente criado e "Tentar novamente" recria o cliente. (b) O erro da URL é lido antes de criar o cliente. O `redirectTo` agora é sempre o endereço oficial (`Auth.urlBase()`). |
| 5 | GitHub Pages × Render | Confirmado: o GitHub Pages só serve arquivos estáticos, não existe API lá. | A página lê o endereço oficial da meta `caicavv-url-producao` (`https://caicavvss.onrender.com`). Se for aberta em outro domínio (como o GitHub Pages), leva o usuário ao endereço oficial e **não faz nenhuma chamada de API ao domínio errado**. No Render e em `localhost` continuam os caminhos relativos. Não foi criada API duplicada nem CORS. Conferido no `server.js`: página, `/img`, `/favicon.png`, `/health` e `/api` saem do mesmo domínio, e `/api` é montado antes do fallback da página. |
| 6 | Recuperação do perfil (`/api/me`) | Fluxo completo verificado nos testes do servidor e no navegador (login, sessão, `/api/me`, status, perfil, `tecnicoLogado`, permissões). | Nenhuma correção necessária. Foi ajustado o perfil perdido durante o uso (fail-closed). |
| 7 | Regras de segurança | Nada foi removido ou enfraquecido. Os 14 testes do servidor continuam passando (acesso negado a não aprovados, rotas administrativas restritas, nenhuma alteração do próprio acesso etc.). | — |
| + | Atribuição de perfil "alternativo" em importações | Duas rotinas de upload usavam `"Recepção"`/`"recepcao"` como valor padrão quando não havia usuário. | O padrão agora é vazio. Sem perfil não se assume nenhuma função. |

## Arquivos modificados

- `index.html`: validador de perfil, `montarMenu`, `aplicarPermissoesNaTela`, `render`, `entrarComo`, `init()` das abas passadas, leitura de entradas, módulo de autenticação (endereço oficial, boot, retry, bloqueio sem perfil), meta `caicavv-url-producao`.
- `package.json`: script `test:navegador`.
- `test/cliente.test.js`: atualizado e ampliado (GitHub Pages, localhost, leitura sem perfil, função inválida).
- **Novos:** `test/browser/harness.py`, `test/browser/browser_test.py`, `RELATORIO-AUDITORIA.md`.
- Não foram alterados: `server.js`, `lib/*`, `sql/*`, layout, design do login, dados, módulos, permissões e regras de pacientes.

## Testes executados

| Suíte | Resultado |
|---|---|
| `npm test`: regras de dados (15), navegador simulado (14), servidor (14) | **43 aprovados** |
| `npm run test:navegador`: Chromium real com o `index.html` verdadeiro | **112 verificações, 0 falhas** |
| Mesma suíte do navegador contra a versão anterior | **falha** (reproduz o `TypeError` e o "Sessão ausente."), o que confirma que os testes detectam os defeitos |

O que o teste em navegador cobre: sem usuário autenticado; sessão recuperada ao atualizar a página (F5); clique em
"Entrar com Google" (provider, `prompt`, `redirectTo`, PKCE); servidor sem configuração; usuário sem cadastro, pendente,
recusado e revogado; aprovado sem perfil (ausente, função inventada, `constructor`, vazia); perfil perdido com o sistema
aberto; menus e permissões de **técnico, recepção, administrador e coordenação** (menu, formulário, relatórios, Entradas,
"Gerenciamento de acessos"); ordem das requisições (dados só depois de `/api/me`); e abertura pelo GitHub Pages.

## O que os testes NÃO conseguem provar

O ambiente de teste não tem acesso à rede. O SDK do Supabase, o Google e o Express foram **simulados**. Portanto **não
foram exercitados** o login real com o Google, o Supabase real e o Render real. Faça este teste final em produção:
1. Abra `https://caicavvss.onrender.com`, entre com Google e confira que o sistema abre.
2. Atualize a página (F5): deve continuar logado.
3. Abra o endereço do GitHub Pages: deve levar ao endereço do Render.
4. No Render, confira nos logs `Configuração do Supabase encontrada.` e `Firestore (servidor) configurado.`

## ⚠ Alerta de segurança (fora do escopo pedido, mas importante)

O **GitHub Pages publica todos os arquivos do repositório**. Isso inclui `data/cadastros-seed.json` (nomes de pacientes),
`sql/`, `lib/` e `render.yaml`. Os mesmos nomes já estavam dentro do `index.html` original, então não é uma exposição nova,
mas continua existindo enquanto o Pages estiver ativo ou o repositório for público. Recomendo:
- **Desativar o GitHub Pages** (Settings > Pages) agora que o sistema roda no Render, ou tornar o repositório **privado**.
- Lembrar que o histórico do Git guarda as versões antigas (com os nomes e as senhas padrão). Se o repositório já foi público, trate esses dados como expostos.
- Se o Firestore já tem a lista de cadastros (provável, o sistema a gravava a cada salvamento), o arquivo `data/cadastros-seed.json` pode ser removido do repositório. O servidor só o usa se o banco estiver sem cadastros.
