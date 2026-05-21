# SECURITY

## Estado atual

Correcoes aplicadas nesta revisao:

- `GET /api/report` agora exige autenticacao.
- `GET /api/preview` foi trocado por `POST /api/preview` com autenticacao.
- comparacao do segredo usa `timingSafeEqual`.
- erros do backend nao retornam mais detalhes internos ao cliente.
- a tabela da Supabase agora usa `is_public` para liberar leitura anonima apenas de linhas publicas.
- o frontend so consulta linhas com `is_public = true`.
- URLs externas de noticias sao validadas para aceitar apenas `http` e `https`.
- o deploy da Vercel agora envia headers de seguranca.
- o workflow do GitHub Actions roda com `contents: read` e `persist-credentials: false`.

## Arquitetura recomendada

Deploy seguro recomendado:

1. Publicar apenas `Site/` na Vercel.
2. Nao publicar `Servidor/` como app publico.
3. Executar `Servidor/` apenas pelo GitHub Actions agendado.
4. Manter `SUPABASE_SERVICE_ROLE_KEY` somente no GitHub Actions e no ambiente local privado.

Essa separacao reduz a superficie publica para:

- um frontend estatico
- uma chave anonima publica da Supabase
- uma tabela com leitura anonima apenas de linhas marcadas como publicas

## Passo a passo exato

### 1. Preparar a Supabase

1. Crie o projeto na Supabase.
2. Abra o SQL Editor.
3. Rode o conteudo de [`Servidor/supabase/schema.sql`](Servidor/supabase/schema.sql).
4. Verifique que a tabela `public.climate_reports` existe com a coluna `is_public`.

### 2. Criar segredos no GitHub

No repositorio GitHub, adicione em `Settings > Secrets and variables > Actions`:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `REPORT_KEY`

Valor recomendado para `REPORT_KEY`:

```text
brazil-latest
```

Nao adicione `SUPABASE_ANON_KEY` no GitHub Actions; ele nao precisa dela.

### 3. Ativar o backend privado

1. Faça push deste repositorio para o GitHub.
2. Abra `Actions`.
3. Rode o workflow `refresh-climate-report` manualmente uma vez.
4. Depois da execucao, confirme na Supabase que existe uma linha com:

```text
report_key = brazil-latest
is_public = true
```

Sem essa primeira execucao, o frontend nao tera nada para ler.

### 4. Configurar a Vercel

Na Vercel, configure o projeto com raiz no repositorio atual.

As variaveis obrigatorias do frontend sao:

- `SITE_SUPABASE_URL`
- `SITE_SUPABASE_ANON_KEY`
- `SITE_REPORT_KEY`
- `SITE_API_NAME`

Valores recomendados:

```text
SITE_SUPABASE_URL=https://SEU-PROJETO.supabase.co
SITE_SUPABASE_ANON_KEY=chave_anon_publica_da_supabase
SITE_REPORT_KEY=brazil-latest
SITE_API_NAME=Happy Nation Climate Center
```

Regra critica:

- nunca coloque `SUPABASE_SERVICE_ROLE_KEY` na Vercel

### 5. Fazer o deploy publico

No terminal:

```bash
vercel --prod
```

O arquivo [`vercel.json`](vercel.json) ja define:

- `installCommand`
- `buildCommand`
- `outputDirectory`
- headers de seguranca

### 6. Validar o deploy

Depois do deploy:

1. Abra o site publicado.
2. Verifique se o status muda para `Relatorio carregado`.
3. Abra o DevTools e confirme que a chamada para Supabase responde `200`.
4. Confirme que o frontend nao tenta chamar nenhum endpoint privado do backend.
5. No response headers do HTML, confirme a presenca de:
   - `Content-Security-Policy`
   - `X-Content-Type-Options`
   - `X-Frame-Options`
   - `Referrer-Policy`
   - `Permissions-Policy`

## O que nao fazer

- nao publicar o `Servidor/` em um host publico sem necessidade
- nao expor `SUPABASE_SERVICE_ROLE_KEY` em frontend, Vercel ou codigo cliente
- nao remover o filtro `is_public = true` do frontend
- nao mudar a policy da tabela para `using (true)`

## Se voce realmente quiser publicar o backend HTTP

Faca isso so se precisar de operacao manual ou endpoints administrativos.

Minimo obrigatorio:

1. Configure `MANUAL_RUN_SECRET` com um valor longo e aleatorio.
2. Use apenas HTTPS.
3. Restrinja acesso por IP, Basic Auth do provedor ou rede privada, se o host permitir.
4. Nao exponha `/api/report`, `/api/preview` ou `/api/run` sem `Authorization: Bearer <MANUAL_RUN_SECRET>`.
5. Trate esse deploy como administrativo, nao como API publica do produto.
