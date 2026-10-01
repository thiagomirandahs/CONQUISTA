# Log de acesso do admin da plataforma ao Storage — desenho (migration 530)

## Problema
Até a 515, a policy de SELECT de `storage.objects` (bucket `comunidade`) deixava o admin da plataforma ler foto de item
da Comunidade em análise/denunciado **e gravava `plataforma_acesso_log` como efeito colateral**. O Storage avalia a
policy **por objeto**; listar uma pasta podia registrar arquivos que o admin nunca abriu, e o log não representava o
arquivo realmente acessado (item 1 de `PENDENCIAS-FASE8-CLASSIFICADAS.md`).

## Solução
1. **RPC `admin_comunidade_foto_assinar(p_tipo, p_id)`** (`security definer`, `search_path ''`, só `authenticated`):
   - exige admin da plataforma (`_exigir_admin_plataforma`);
   - confere o contexto com a **mesma regra da moderação** (`_plataforma_pode_item`): item `post`/`story` da Comunidade
     (ou de unidade de coordenação) **em análise ou denunciado**. Fora disso: "Conteúdo não encontrado.", sem log;
   - confere que a foto existe (não apagada e com objeto no bucket); senão "Este item não tem foto disponível.", sem log;
   - grava **exatamente 1 linha por chamada** (sem dedupe) em `plataforma_acesso_log`: admin, `o_que = 'foto_assinada'`,
     tipo/id do item (caminho lógico), clube de origem, `bucket`, `contexto` (`em_analise` | `denunciado`), `quando`.
     **Nunca** grava URL, token nem o caminho físico do arquivo;
   - **fail-closed**: se o INSERT falhar, a exceção propaga e nada é autorizado;
   - devolve `{ ok, bucket, path, contexto, ttl_segundos: 60 }`.
2. **Edge Function `admin-comunidade-foto`** (`verify_jwt = true`): chama a RPC **com o JWT do admin** e, só depois, assina
   o `path` devolvido pela RPC com a chave de serviço (`createSignedUrl`, 60 s). O caminho nunca vem do cliente.
   Por que Edge Function: o Postgres não assina URL do Storage (o segredo de assinatura não está no banco). A RPC faz tudo
   que é decisão e registro; a função só executa a assinatura do que a RPC autorizou.
3. **Policy de leitura do bucket**: `_comunidade_pode_ver_foto` perdeu os dois ramos do admin da plataforma e virou
   `STABLE` (sem escrita). O admin **não lê nem lista** o bucket direto; ganha acesso só pelo caminho mediado. Quem também
   é membro de um clube segue as regras de membro daquele clube. Nenhuma permissão nova foi aberta.
4. `plataforma_acesso_log` ganhou `bucket` e `contexto` (nullable, aditivo). Continua append-only (UPDATE/DELETE/TRUNCATE
   falham), sem grant para `anon`/`authenticated`.

## Front
`src/services/comunidade.js` → `adminFotoUrl(tipo, id)` (invoca a função). `AdminComunidade.jsx` → botão
"Ver foto (fica registrado)" na fila: **nunca carrega sozinho**; 1 clique = 1 chamada = 1 linha de log.
O painel antigo não abria foto (só aprovava/recusava), então o front publicado continua funcionando com o banco novo
(nada que ele chama mudou de assinatura).

## Ordem de publicação (decisão do dono)
1. **Banco**: migration 530 (idempotente; sem lock longo; só `create or replace`, 2 `add column` nullable).
2. **Edge Function**: `supabase functions deploy admin-comunidade-foto` (ou colar no painel; `verify_jwt` ligado).
3. **Front** novo (Vercel).
Entre 1 e 3 nada quebra: o front antigo não depende do acesso direto do admin; só não há botão de foto até o passo 3.
Se o front novo subir antes da função, o botão mostra erro e nada é registrado.

## Provas
SQL `134_admin_storage_log_mediado.sql` (58 asserts: listar não registra, 1 linha por assinatura, fora de contexto negado,
não-admin/anon negados, log sem URL/token, append-only, fail-closed, membros intactos), `122` atualizado, E2E
`npm run test:rede:admin-foto:e2e` (Storage real local; a assinatura final é simulada com a chave de serviço local),
bundle da função em `npm run test:edge:bundle:pdf`, vitest do componente/service/contrato.

## Limites conhecidos
- A URL assinada vive 60 s e pode ser aberta várias vezes nesse período (1 log por assinatura, não por GET).
- A RPC chamada diretamente (sem a função) registra a autorização mesmo sem assinatura: erra para o lado de registrar a mais.
- Admin só vê o que a moderação já permitia; `foto_expira_em` não é exigido (a moderação de item em análise/denunciado vale
  até a limpeza apagar o arquivo, quando a RPC passa a negar).
