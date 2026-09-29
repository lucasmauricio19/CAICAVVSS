# CAICAVV — Otimização V7

## Objetivo

A V7 remove o encadeamento de wrappers sobre `window.render`, que vinha sendo usado por vários módulos para executar tarefas depois da renderização.

## Alterações

- Criado um coordenador central de pós-renderização:
  - `window.caicavvRegistrarRenderHook(fn)`
  - `window.caicavvExecutarRenderHooks()`
- O `render()` principal agora:
  - não renderiza cartões de agendamentos quando outra aba está ativa;
  - executa os hooks registrados após uma renderização válida;
  - executa os hooks também quando a lista de atendimentos está vazia.
- O módulo de lembretes deixou de substituir `window.render`.
- O módulo de abas passadas deixou de substituir `window.render`.
- O módulo de visibilidade deixou de substituir `window.render`.
- O módulo de alerta de faltas deixou de substituir `window.render`.
- `renderOriginalCaicavv` passou a apontar diretamente para a função `render` original, sem capturar wrappers intermediários.
- Removida a chamada duplicada dos lembretes/abas passadas em `abrirTelaAgendamentos`; essas tarefas agora são disparadas pelo mecanismo central.

## Validação

- 17 blocos JavaScript extraídos do HTML.
- `node --check`: aprovado, sem erros de sintaxe.
- `window.render = ...`: nenhuma atribuição operacional restante; apenas a ocorrência textual do comentário explicativo.
- CSS: 1 bloco `<style>`.

## Não alterado nesta etapa

Ainda não foram migrados o modelo do Firestore, autenticação, `pacienteId`, estrutura de coleções, dados legados ou permissões do backend. Essas mudanças serão tratadas separadamente para evitar perda de dados.
