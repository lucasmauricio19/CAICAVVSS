# CAICAVV — Otimização V8

## Objetivo
Centralizar o acesso ao Firestore sem alterar o modelo de dados nesta etapa.

### Alterações
- Criada `CAICAVV_REPO` como camada única de acesso aos documentos `atendimentos` e `cadastros`.
- CRUD de pacientes passou a usar a transação pelo repositório.
- Leitura/gravação das observações de faltas passou a usar o repositório.
- Mantidos os documentos existentes e a compatibilidade com o legado.
- Nenhuma migração destrutiva de dados foi realizada.

### Próxima etapa
Migrar gradualmente os demais acessos diretos ao Firestore para o repositório e, depois, separar documentos por entidade sem apagar a estrutura atual.
