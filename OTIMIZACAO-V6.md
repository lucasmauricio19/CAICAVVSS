# CAICAVV — Otimização v6

Primeira etapa de refatoração controlada, sem migração destrutiva do banco.

## Alterações
- removidas implementações duplicadas/legadas de `carregarAtendimentosFirebase`, `abrirTelaPacientes` e `filtrarPacientes`;
- consolidado o CSS em um único bloco, preservando a ordem original das regras;
- removidas apenas regras CSS que eram blocos exatamente idênticos;
- mantidas as funcionalidades e a estrutura de dados existentes;
- adicionada identificação de versão técnica em `window.__caicavvDiagnostico`.

## Próxima etapa
A migração estrutural de Firebase, autenticação, IDs permanentes de pacientes e redução de estado global deve ser feita em etapas separadas, com testes de regressão.
