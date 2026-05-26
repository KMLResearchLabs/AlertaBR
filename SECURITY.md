# SECURITY

## Estado atual

Correções aplicadas nesta revisão:

- `GET /api/report` agora exige autenticação.
- `GET /api/preview` foi trocado por `POST /api/preview` com autenticação.
- a comparação do segredo usa `timingSafeEqual`.
- erros do backend não retornam mais detalhes internos ao cliente.
- a tabela da Supabase agora usa `is_public` para liberar leitura anônima apenas de linhas públicas.
- o frontend só consulta linhas com `is_public = true`.
- URLs externas de notícias são validadas para aceitar apenas `http` e `https`.
- o deploy da Vercel agora envia headers de segurança.
- o workflow do GitHub Actions roda com `contents: read` e `persist-credentials: false`.

## Arquitetura recomendada

Deploy seguro recomendado:

1. Publicar apenas `Site/` na Vercel.
2. Não publicar `Servidor/` como app público.
3. Executar `Servidor/` apenas pelo GitHub Actions agendado.
4. Manter `SUPABASE_SERVICE_ROLE_KEY` somente no GitHub Actions, nas funções serverless privadas da Vercel quando notificações estiverem ativadas, e no ambiente local privado.

Essa separação reduz a superfície pública para:

- um frontend estático
- uma chave anônima pública da Supabase
- uma tabela com leitura anônima apenas de linhas marcadas como públicas

## Passo a passo exato

### 1. Preparar a Supabase

1. Crie o projeto na Supabase.
2. Abra o SQL Editor.
3. Rode o conteúdo de [`Servidor/supabase/schema.sql`](Servidor/supabase/schema.sql).
4. Verifique que a tabela `public.climate_reports` existe com a coluna `is_public`.

### 2. Criar segredos no GitHub

No repositório GitHub, adicione em `Settings > Secrets and variables > Actions`:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `REPORT_KEY`

Valor recomendado para `REPORT_KEY`:

```text
brazil-latest
```

Não adicione `SUPABASE_ANON_KEY` no GitHub Actions; ele não precisa dela.

### 3. Ativar o backend privado

1. Faça push deste repositório para o GitHub.
2. Abra `Actions`.
3. Rode o workflow `refresh-climate-report` manualmente uma vez.
4. Depois da execução, confirme na Supabase que existe uma linha com:

```text
report_key = brazil-latest
is_public = true
```

Sem essa primeira execução, o frontend não terá nada para ler.

### 4. Configurar a Vercel

Na Vercel, configure o projeto com raiz no repositório atual.

As variáveis obrigatórias do frontend são:

- `SITE_SUPABASE_URL`
- `SITE_SUPABASE_ANON_KEY`
- `SITE_REPORT_KEY`
- `SITE_API_NAME`

Valores recomendados:

```text
SITE_SUPABASE_URL=https://SEU-PROJETO.supabase.co
SITE_SUPABASE_ANON_KEY=chave_anon_pública_da_supabase
SITE_REPORT_KEY=brazil-latest
SITE_API_NAME=Happy Nation Climate Center
```

Regra crítica:

- nunca coloque `SUPABASE_SERVICE_ROLE_KEY` na Vercel

Exceção controlada:

- se o projeto ativar `api/notifications/subscribe.js` e `api/notifications/unsubscribe.js`, a Vercel precisará de `SUPABASE_SERVICE_ROLE_KEY` apenas para essas funções serverless, além de `VAPID_SUBJECT`, `VAPID_PUBLIC_KEY` e `VAPID_PRIVATE_KEY`
- essa chave continua privada porque roda no ambiente servidor da Vercel; ela não vai para `config.js`, HTML ou bundle público

### 5. Fazer o deploy público

No terminal:

```bash
vercel --prod
```

O arquivo [`vercel.json`](vercel.json) já define:

- `installCommand`
- `buildCommand`
- `outputDirectory`
- headers de segurança

### 6. Validar o deploy

Depois do deploy:

1. Abra o site publicado.
2. Verifique se o status muda para `Relatório carregado`.
3. Abra o DevTools e confirme que a chamada para Supabase responde `200`.
4. Confirme que o frontend não tenta chamar nenhum endpoint privado do backend.
5. No response headers do HTML, confirme a presença de:
   - `Content-Security-Policy`
   - `X-Content-Type-Options`
   - `X-Frame-Options`
   - `Referrer-Policy`
   - `Permissions-Policy`

## O que não fazer

- não publicar o `Servidor/` em um host público sem necessidade
- não expor `SUPABASE_SERVICE_ROLE_KEY` no frontend, em `config.js`, HTML, JavaScript público ou qualquer outro artefato enviado ao navegador
- não remover o filtro `is_public = true` do frontend
- não mudar a policy da tabela para `using (true)`

## Se você realmente quiser publicar o backend HTTP

Faça isso só se precisar de operação manual ou endpoints administrativos.

Mínimo obrigatório:

1. Configure `MANUAL_RUN_SECRET` com um valor longo e aleatório.
2. Use apenas HTTPS.
3. Restrinja acesso por IP, Basic Auth do provedor ou rede privada, se o host permitir.
4. Não exponha `/api/report`, `/api/preview` ou `/api/run` sem `Authorization: Bearer <MANUAL_RUN_SECRET>`.
5. Trate esse deploy como administrativo, não como API pública do produto.
