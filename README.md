# AlertaBR

Arquitetura separada em três áreas:

- `Site/`: frontend estático que lê o último relatório salvo na Supabase e renderiza mapa, cards, alertas, estações e notícias.
- `Servidor/`: backend agendado que coleta dados do INMET, relaciona notícias, monta o relatório e faz upsert na Supabase.
- `test/API/`: API separada para deploy no Render, protegida por API keys validadas na Supabase.

## Estrutura

```text
Site/
Servidor/
test/API/
shared/
.github/workflows/refresh-report.yml
```

## Fontes usadas

- INMET alertas CAP e observações de estações.
- Notícias relacionadas via portal do INMET com fallback RSS.
- Supabase como banco e camada pública de leitura.
- GitHub Actions para executar a geração a cada 30 minutos.

## Supabase

1. Crie um projeto na Supabase.
2. Rode o SQL de [`Servidor/supabase/schema.sql`](Servidor/supabase/schema.sql).
3. Copie `SUPABASE_URL`, `SUPABASE_ANON_KEY` e `SUPABASE_SERVICE_ROLE_KEY`.
4. Confirme que a linha gravada pelo backend fica com `is_public = true`.

## Variáveis

Use [`/.env.example`](.env.example) como base local.

Variáveis principais:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `REPORT_KEY`
- `SITE_SUPABASE_URL`
- `SITE_SUPABASE_ANON_KEY`
- `SITE_REPORT_KEY`
- `MANUAL_RUN_SECRET`
- `VAPID_SUBJECT`
- `VAPID_PUBLIC_KEY`
- `VAPID_PRIVATE_KEY`

## Desenvolvimento local

Frontend:

```bash
npm run dev:site
```

Backend HTTP opcional:

```bash
npm run dev
```

API para Render:

```bash
npm run dev:api
```

Gerar e salvar o relatório manualmente:

```bash
npm run report:generate
```

Checagem sintática:

```bash
npm run check
```

Gerar um par de chaves VAPID para push web:

```bash
npm run notifications:vapid
```

## Deploy do Site

Deploy grátis recomendado: Vercel com projeto apontando para este repositório.

Configuração:

- Build command: `npm run build:site`
- Output directory: `Site/dist`
- Variáveis de ambiente:
  - `SITE_SUPABASE_URL`
  - `SITE_SUPABASE_ANON_KEY`
  - `SITE_REPORT_KEY`
  - `SITE_API_NAME`

Importante:

- não coloque `SUPABASE_SERVICE_ROLE_KEY` na Vercel
- não coloque `SUPABASE_URL` ou `SUPABASE_ANON_KEY` genéricos esperando fallback; use explicitamente as variáveis `SITE_*`
- o frontend público deve consumir apenas a linha `is_public = true`

Exceção opcional:

- se você ativar as notificações anônimas por região, a Vercel também precisará de `SUPABASE_SERVICE_ROLE_KEY`, `VAPID_SUBJECT`, `VAPID_PUBLIC_KEY` e `VAPID_PRIVATE_KEY` para executar apenas as funções serverless em `/api/notifications/*`
- nesse caso, a `service role` continua restrita ao ambiente servidor da Vercel e nunca ao bundle do navegador

## Backend recorrente sem custo fixo

O backend já está preparado para rodar pelo GitHub Actions em [`/.github/workflows/refresh-report.yml`](.github/workflows/refresh-report.yml).

Adicione os secrets no GitHub:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `REPORT_KEY` opcional

Recomendação de segurança:

- use o backend como job privado no GitHub Actions
- não publique o `Servidor/` na internet se você não precisa de endpoints HTTP
- se publicar para operação manual, configure `MANUAL_RUN_SECRET` forte e use apenas rotas autenticadas

Depois disso, o workflow roda:

- manualmente por `workflow_dispatch`
- automaticamente a cada 30 minutos por `cron`

## Endpoints locais do backend

Quando rodando `npm run dev`, o backend expõe:

- `GET /health`
- `GET /api/report` com `Authorization: Bearer <MANUAL_RUN_SECRET>`
- `POST /api/preview` com `Authorization: Bearer <MANUAL_RUN_SECRET>`
- `POST /api/run` com `Authorization: Bearer <MANUAL_RUN_SECRET>`

## Observação operacional

O frontend lê direto da Supabase com chave anônima pública. O backend escreve usando a `service role` apenas no ambiente privado do workflow ou do servidor.

## Deploy seguro

O roteiro exato de deploy seguro está em [`SECURITY.md`](SECURITY.md).

## API no Render

A API protegida por API key fica em [`test/API/README.md`](test/API/README.md).
Antes do deploy, rode também o SQL de [`test/API/supabase/schema.sql`](test/API/supabase/schema.sql) para criar a tabela `api_keys`.

## Notificações por região sem cadastro

Fluxo implementado:

- o usuário ativa as notificações no `Site/`
- o navegador pede permissão de notificação e localização
- a assinatura push é salva de forma anônima na Supabase via `api/notifications/subscribe.js`
- o workflow [`/.github/workflows/send-region-notifications.yml`](.github/workflows/send-region-notifications.yml) roda a cada 5 minutos e envia push para assinaturas cuja posição caia dentro da geometria do alerta do INMET

Recursos novos na Supabase:

- `notification_subscriptions`
- `notification_deliveries`

Secrets adicionais para o workflow e para as funções serverless:

- `VAPID_SUBJECT`
- `VAPID_PUBLIC_KEY`
- `VAPID_PRIVATE_KEY`

Script manual de envio:

```bash
npm run notifications:send
```
