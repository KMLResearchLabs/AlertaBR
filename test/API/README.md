# API

API separada para deploy no Render, com autenticação por API key validada na Supabase.

## O que ela faz

- `GET /health`: healthcheck público.
- `GET /v1/auth/check`: valida a API key e devolve os metadados da chave.
- `GET /v1/report/latest`: devolve o último relatório salvo na Supabase.
- `POST /v1/report/preview`: gera um preview do relatório sem salvar.
- `POST /v1/report/refresh`: gera e salva um novo relatório.

Todos os endpoints em `/v1/*` exigem API key.

## Como a chave é validada

1. A API lê a chave do header `x-api-key` ou de `Authorization: Bearer <key>`.
2. A chave recebida é convertida em `sha256`.
3. A API consulta a tabela `public.api_keys` na Supabase.
4. A chamada só passa se a chave:
   - existir
   - estiver `is_active = true`
   - não estiver expirada
   - tiver o escopo exigido, quando houver

## Supabase

Rode o SQL de [`test/API/supabase/schema.sql`](/home/bykurebo/Repositório/AlertaBR/test/API/supabase/schema.sql) no SQL Editor da Supabase.

## Variáveis de ambiente

- `PORT`
- `API_SUPABASE_URL`
- `API_SUPABASE_SERVICE_ROLE_KEY`
- `API_REPORT_KEY`
- `API_KEYS_TABLE`
- `API_KEY_HEADER_NAME`
- `API_CORS_ORIGINS`

Fallbacks:

- `API_SUPABASE_URL` pode herdar `SUPABASE_URL`
- `API_SUPABASE_SERVICE_ROLE_KEY` pode herdar `SUPABASE_SERVICE_ROLE_KEY`
- `API_REPORT_KEY` pode herdar `REPORT_KEY`

## Render

Build Command:

```bash
npm install
```

Start Command:

```bash
npm run start:api
```

Recomendação:

- use uma `API_SUPABASE_SERVICE_ROLE_KEY` só no ambiente do Render
- não exponha a service role no frontend
- restrinja `API_CORS_ORIGINS` se a API for chamada por browser
