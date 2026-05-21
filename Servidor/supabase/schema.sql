create table if not exists public.climate_reports (
  report_key text primary key,
  generated_at timestamptz not null,
  report jsonb not null,
  is_public boolean not null default false,
  alert_count integer not null default 0,
  news_count integer not null default 0,
  updated_at timestamptz not null default timezone('utc', now())
);

alter table public.climate_reports
add column if not exists is_public boolean not null default false;

alter table public.climate_reports enable row level security;

drop policy if exists "public can read latest climate reports" on public.climate_reports;
create policy "public can read latest climate reports"
on public.climate_reports
for select
to anon, authenticated
using (is_public = true);

drop policy if exists "service role can write climate reports" on public.climate_reports;
create policy "service role can write climate reports"
on public.climate_reports
for all
to service_role
using (true)
with check (true);

create index if not exists climate_reports_generated_at_idx
on public.climate_reports (generated_at desc);
