# Happy Nation

Arquitetura separada em duas pastas:

- `Site/`: frontend estatico que le o ultimo relatorio salvo na Supabase e renderiza mapa, cards, alertas, estacoes e noticias.
- `Servidor/`: backend agendado que coleta dados do INMET, relaciona noticias, monta o relatorio e faz upsert na Supabase.

## Estrutura

```text
Site/
Servidor/
shared/
.github/workflows/refresh-report.yml
```

## Fontes usadas

- INMET alertas CAP e observacoes de estacoes.
- Noticias relacionadas via portal do INMET com fallback RSS.
- Supabase como banco e camada publica de leitura.
- GitHub Actions para executar a geracao a cada 30 minutos.

## Supabase

1. Crie um projeto na Supabase.
2. Rode o SQL de [`Servidor/supabase/schema.sql`](Servidor/supabase/schema.sql).
3. Copie `SUPABASE_URL`, `SUPABASE_ANON_KEY` e `SUPABASE_SERVICE_ROLE_KEY`.
4. Confirme que a linha gravada pelo backend fica com `is_public = true`.

## Variaveis

Use [`/.env.example`](.env.example) como base local.

Variaveis principais:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `REPORT_KEY`
- `SITE_SUPABASE_URL`
- `SITE_SUPABASE_ANON_KEY`
- `SITE_REPORT_KEY`
- `MANUAL_RUN_SECRET`

## Desenvolvimento local

Frontend:

```bash
npm run dev:site
```

Backend HTTP opcional:

```bash
npm run dev
```

Gerar e salvar o relatorio manualmente:

```bash
npm run report:generate
```

Checagem sintatica:

```bash
npm run check
```

## Deploy do Site

Deploy gratis recomendado: Vercel com projeto apontando para este repositorio.

Configuracao:

- Build command: `npm run build:site`
- Output directory: `Site/dist`
- Variaveis de ambiente:
  - `SITE_SUPABASE_URL`
  - `SITE_SUPABASE_ANON_KEY`
  - `SITE_REPORT_KEY`
  - `SITE_API_NAME`

Importante:

- nao coloque `SUPABASE_SERVICE_ROLE_KEY` na Vercel
- nao coloque `SUPABASE_URL` ou `SUPABASE_ANON_KEY` genricos esperando fallback; use explicitamente as variaveis `SITE_*`
- o frontend publico deve consumir apenas a linha `is_public = true`

## Backend recorrente sem custo fixo

O backend ja esta preparado para rodar pelo GitHub Actions em [`/.github/workflows/refresh-report.yml`](.github/workflows/refresh-report.yml).

Adicione os secrets no GitHub:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `REPORT_KEY` opcional

Recomendacao de seguranca:

- use o backend como job privado no GitHub Actions
- nao publique o `Servidor/` na internet se voce nao precisa de endpoints HTTP
- se publicar para operacao manual, configure `MANUAL_RUN_SECRET` forte e use apenas rotas autenticadas

Depois disso, o workflow roda:

- manualmente por `workflow_dispatch`
- automaticamente a cada 30 minutos por `cron`

## Endpoints locais do backend

Quando rodando `npm run dev`, o backend expõe:

- `GET /health`
- `GET /api/report` com `Authorization: Bearer <MANUAL_RUN_SECRET>`
- `POST /api/preview` com `Authorization: Bearer <MANUAL_RUN_SECRET>`
- `POST /api/run` com `Authorization: Bearer <MANUAL_RUN_SECRET>`

## Observacao operacional

O frontend le direto da Supabase com chave anonima publica. O backend escreve usando a `service role` apenas no ambiente privado do workflow ou do servidor.

## Deploy seguro

O roteiro exato de deploy seguro esta em [`SECURITY.md`](SECURITY.md).
