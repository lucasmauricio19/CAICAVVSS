-- =====================================================================
-- CAICAVV — Controle de acesso (login Google + aprovação de usuários)
-- Execute no Supabase: SQL Editor > New query > cole tudo > Run.
-- Pode ser executado mais de uma vez sem causar erro.
--
-- Estas tabelas são INDEPENDENTES de pacientes e atendimentos
-- (que continuam no Firebase). Nada aqui toca nesses dados.
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- 1) Tabela de acessos (solicitações + usuários autorizados)
--    status: pendente | aprovado | recusado | revogado
--    role:   adm | coordenacao | recepcao | tecnico
-- ---------------------------------------------------------------------
create table if not exists public.caicavv_acessos (
  id                  uuid primary key default gen_random_uuid(),
  auth_user_id        uuid unique references auth.users(id) on delete set null,
  email               text not null unique,
  nome                text not null default '',
  status              text not null default 'pendente'
                        check (status in ('pendente','aprovado','recusado','revogado')),
  role                text check (role in ('adm','coordenacao','recepcao','tecnico')),
  tecnico_nome        text,
  origem              text not null default 'solicitacao'
                        check (origem in ('solicitacao','manual','inicial')),
  solicitado_em       timestamptz not null default now(),
  analisado_em        timestamptz,
  analisado_por_email text,
  atualizado_em       timestamptz not null default now(),

  constraint caicavv_acessos_email_minusculo check (email = lower(email)),
  constraint caicavv_acessos_aprovado_exige_perfil
    check (status <> 'aprovado' or role is not null),
  constraint caicavv_acessos_tecnico_exige_vinculo
    check (role is distinct from 'tecnico' or tecnico_nome is not null)
);

create index if not exists caicavv_acessos_status_idx on public.caicavv_acessos (status);

-- Mantém "atualizado_em" correto
create or replace function public.caicavv_acessos_toca_atualizado()
returns trigger language plpgsql as $$
begin
  new.atualizado_em := now();
  return new;
end $$;

drop trigger if exists caicavv_acessos_atualizado on public.caicavv_acessos;
create trigger caicavv_acessos_atualizado
  before update on public.caicavv_acessos
  for each row execute function public.caicavv_acessos_toca_atualizado();

-- ---------------------------------------------------------------------
-- 2) Histórico (auditoria) das decisões de acesso
-- ---------------------------------------------------------------------
create table if not exists public.caicavv_acessos_historico (
  id         bigint generated always as identity primary key,
  acesso_id  uuid references public.caicavv_acessos(id) on delete set null,
  acao       text not null,
  por_email  text,
  detalhes   jsonb not null default '{}'::jsonb,
  em         timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 3) RLS: ligado e SEM permissão de escrita para o navegador.
--    Todas as gravações passam pelo servidor (chave secreta), que valida
--    quem está pedindo. O navegador só pode ler o PRÓPRIO cadastro.
-- ---------------------------------------------------------------------
alter table public.caicavv_acessos            enable row level security;
alter table public.caicavv_acessos_historico  enable row level security;

drop policy if exists "ler o proprio acesso" on public.caicavv_acessos;
create policy "ler o proprio acesso"
  on public.caicavv_acessos
  for select
  to authenticated
  using (auth_user_id = (select auth.uid()));

-- (Nenhuma policy de insert/update/delete: ficam negadas por padrão.)
-- (Histórico: nenhuma policy — só o servidor lê e grava.)

revoke all on public.caicavv_acessos           from anon, authenticated;
revoke all on public.caicavv_acessos_historico from anon, authenticated;
grant select (id, email, nome, status, role, tecnico_nome)
  on public.caicavv_acessos to authenticated;

-- ---------------------------------------------------------------------
-- 4) Administrador inicial (e-mail informado pela administração)
--    Perfil "coordenacao": é o perfil atual da coordenadora no sistema e
--    pode gerenciar acessos. Para outro perfil, troque 'coordenacao'.
--    O vínculo com a conta Google acontece sozinho no primeiro login.
-- ---------------------------------------------------------------------
insert into public.caicavv_acessos (email, nome, status, role, origem, analisado_por_email, analisado_em)
values ('mattosmay@gmail.com', '', 'aprovado', 'coordenacao', 'inicial', 'script inicial', now())
on conflict (email) do update
  set status = 'aprovado',
      role = 'coordenacao',
      tecnico_nome = null;
