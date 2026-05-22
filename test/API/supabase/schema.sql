create extension if not exists pgcrypto;

create table if not exists public.api_keys (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  key_hash text not null unique,
  scopes text[] not null default '{}'::text[],
  is_active boolean not null default true,
  expires_at timestamptz null,
  last_used_at timestamptz null,
  last_used_ip text null,
  last_user_agent text null,
  metadata jsonb not null default '{}'::jsonb,
  revoked_at timestamptz null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists api_keys_active_idx
on public.api_keys (is_active, expires_at);

create or replace function public.set_api_keys_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists api_keys_set_updated_at on public.api_keys;
create trigger api_keys_set_updated_at
before update on public.api_keys
for each row
execute function public.set_api_keys_updated_at();

alter table public.api_keys enable row level security;

drop policy if exists "service role can manage api keys" on public.api_keys;
create policy "service role can manage api keys"
on public.api_keys
for all
to service_role
using (true)
with check (true);

drop policy if exists "anon cannot read api keys" on public.api_keys;
create policy "anon cannot read api keys"
on public.api_keys
for select
to anon, authenticated
using (false);

-- Exemplo de inserção de chave:
-- insert into public.api_keys (name, key_hash, scopes)
-- values (
--   'render-client',
--   encode(digest('COLOQUE_UMA_API_KEY_GRANDE_E_ALEATORIA_AQUI', 'sha256'), 'hex'),
--   array['climate_reports:read', 'climate_reports:preview', 'climate_reports:write']
-- );
