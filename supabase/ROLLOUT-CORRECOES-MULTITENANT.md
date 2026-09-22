# Rollout — multi-tenant completo (migrations 01–37)

Nada aqui foi aplicado em produção. Este guia é para **quando** você decidir aplicar.
Produção é manual (SQL Editor) e o front é automático (Vercel no push): a ordem importa.
A matriz de cada módulo está em `supabase/AUDITORIA-MULTITENANT.md`.

## Antes de qualquer coisa
1. **Backup** (Supabase → Database → Backups). É o único "rollback" real: as migrations trocam
   policies/funções, renomeiam papéis (`responsavel` → `pais`), mudam chaves primárias (config, catálogo de jogos) e
   removem os helpers globais legados.
2. **Pré-voo (somente leitura)**: cole `supabase/PREFLIGHT-PRODUCAO.sql` no SQL Editor e rode. Só siga se a
   primeira linha (`RESUMO`) disser **ok**. Ele lista, com o nome do arquivo antigo a rodar, qualquer tabela/coluna/função
   legada que falte (ex.: `ajudas`, `partidas`, `bichinho-sono`, `rodizio`, ledger) e os dados que fariam uma
   migration abortar (nome de unidade repetido, mensalidade duplicada, papel fora do vocabulário).
3. **Publique o front ANTES do SQL** (merge → Vercel). O front novo grava PIX/popup/rodízio pela RPC `config_gravar` e, se ela ainda
   não existe, cai no upsert antigo — então funciona antes e depois do SQL. (Front/APK antigo em cache **não** sabe gravar essas
   configs depois do SQL: leitura e o resto seguem; atualize o app.)
4. Aplique **tudo na mesma janela**: as migrations `20260921000001`–`12` (SaaS) **e** `13`–`31` **e** `33`–`40`.
   (A `40` é GERADA do manifesto curricular — `npm run curriculo:importacao:check` tem que passar antes; ela publica o catálogo
   oficial das 6 Classes Regulares 2026 sem matricular ninguém, e reaplicá-la é no-op.)
   Não pare no meio: a `11` remove o alvo de conflito antigo de mensalidades e a `14` o devolve; a `24` troca a chave do catálogo de jogos.
   **A `32` NÃO entra nessa janela** (é a virada do bucket `imagens` para privado): só depois do front novo publicado **e** do APK novo distribuído — veja "Passo 6".
5. O SQL Editor é atômico por execução: se uma migration falhar, ela **não** aplica nada — corrija a causa e rode de novo.
   Cada uma das `03`–`06` e `08`–`12` deve ser aplicada **uma vez** (não são reaplicáveis); as `13`–`40` são idempotentes. (A `02` também: aplique uma vez.)

## Ordem
| # | O quê | Onde |
|---|-------|------|
| 0 | `PREFLIGHT-PRODUCAO.sql` → `RESUMO = ok` | SQL Editor |
| 1 | Merge do front (Vercel publica sozinho) | GitHub |
| 2 | SQL `…000001` a `…000012` (na ordem) | SQL Editor, um por vez |
| 3 | SQL `…000013` → … → `…000031`, depois `…000033` → `…000037` (na ordem; a `32` fica de fora — passo 6) | SQL Editor, um por vez |
| 4 | Verificações abaixo | SQL Editor |
| 5 | **Edge Function `enviar-push`**: colar o novo `supabase/functions/enviar-push/index.ts` (dependências com versão exata) | Painel → Edge Functions (só **depois** do `…17`) |
| 6 | **`…000032` — bucket `imagens` PRIVADO** (a virada). Só com o front novo no ar **e** o APK novo distribuído | SQL Editor |

O que cada migration faz: `13` papéis/vínculos + escopo do legado · `14` RLS por clube + blindagem dos responsáveis ·
`15` leilão (cron = "Encerrar agora") · `16` RPCs/storage isolados + responsáveis por clube · `17` convites e push por clube ·
`18` correções da revisão de segurança · `19` correções da revisão de regressão (excluir usuário, foto do mural, `nova_temporada`, desempenho) ·
**`20` config do clube por clube + provisionamento** · **`21` duelos** · **`22` missões/devocional** · **`23` leilão** ·
**`24` jogos (trilha, rodízio, recordes, ajudas, chefão, catálogo, cron)** · **`25` chat, bichinho, bíblia** ·
**`26` remove os helpers legados** (+ view do chat) · **`27` conteúdo (missões/versículos) por clube** · **`28` correções das revisões da rodada 2** (cron de leilão isolado por leilão + registro de falhas em `cron_falhas`, teto de pontos, limites do bucket `imagens`, push que segue o usuário logado, sem TRUNCATE para usuário, erro claro do instrutor) · **`29` texto de mensagem moderada só na trilha da liderança** · **`30` sem oráculo de UUID (mesma resposta para "outro clube" e "não existe") + `avaliado_por`/`registrado_por` só de quem faz** · **`31` imagens por clube (policies por clube, envio só no próprio escopo, dono = `owner` OU `owner_id`) + bucket `publico`** · **`32` `imagens` deixa de ser público** · **`33` contexto do clube: `meu_contexto()`, marca por clube, catálogo de recursos e as RPCs de escrita da liderança** (a `33` não depende da `32`) · **`34` multi-clube real: remove 1-clube-por-pessoa, papel/unidade/status viram do vínculo (`vinculo_gerir`), seleção de clube por requisição (`clube_atual_id()` lê o header `x-clube-atual`, sempre validado) e feature flags viram autorização de verdade nos 11 recursos que só escondiam rota** (a `34` não depende da `32`) · **`35` jogos/chefão/leilão/ranking sem `profiles.papel` — o motor de jogos passa a ler o vínculo, `pontos`/gameplay ganham `club_id` conferido (não mais adivinhado)** (a `35` não depende da `32`) · **`36` motor curricular versionado (Classes/Especialidades, fase 1): `curriculum_versions`→`classes`→`class_sections`→`class_requirements` (catálogo da plataforma) e `member_classes`/`member_requirements`/`requirement_approvals`/`investiture_reviews` (progresso por clube) + 1 classe PILOTO com dados de teste; recurso `classes` nasce desligado por padrão** (a `36` não depende da `32`) · **`37` motor curricular fase 2: Especialidades (`specialties`/`specialty_requirements`/`specialty_offerings`/`member_specialties`/`member_specialty_requirements`) + dependência declarativa entre currículo (`curriculum_dependencies`), rastreabilidade de importação em `curriculum_versions`, ferramenta de diff entre versões (`comparar_versoes_curriculares`) e o recurso `classes` passa a bloquear ESCRITA de verdade nas RPCs de Classes E Especialidades (achado da auditoria: só escondia a rota) + 1 especialidade PILOTO com dados de teste, dependendo de um requisito novo da classe piloto** (a `37` não depende da `32`).

## Passo 6 — a virada do bucket `imagens` (migration 32): quando e como
Até aqui `imagens` continua **público** (as policies novas da `31` valem nos dois estados). A `32` faz `update storage.buckets set public = false where id = 'imagens'` e muda o que os aparelhos veem:
- O banco **não muda**: `profiles.foto`, `fotos.url/thumb` e `unidades.emblema/bandeira` seguem com a URL de sempre. O front NOVO troca por URL assinada (24 h) na hora de exibir e, se a assinatura falhar, tenta a URL guardada.
- **Front antigo em cache / APK antigo**: mostram a imagem pela URL pública — que deixa de abrir. Avatar cai nas iniciais; mural, emblema e bandeira ficam em branco. O **APK embute o front** (`webDir: dist`, sem `server.url`) e **não se atualiza sozinho**: gere o APK novo (Actions), distribua e só então aplique a `32`. iPhone (web/PWA) atualiza sozinho.
- **Sequência segura**: merge do front → Vercel publica → (APK novo distribuído) → SQL `…000032`. Teste logo depois: avatar no ranking, mural, emblema em Unidades, foto do filho no portal do responsável.
- **Reverter** (um comando; as policies da `31` servem aos dois estados): `update storage.buckets set public = true where id = 'imagens';`
- Nada a migrar no Tenant 001: os objetos que já existem têm o dono em `owner` (Storage antigo) e continuam com dono; os novos, em `owner_id` — as policies leem os dois.

## Verificações depois do SQL
```sql
-- 1) todo perfil tem vínculo de clube e o espelho (profiles.papel/status/unidade_id) bate com o
--    vínculo PRIMÁRIO (esperado: 0 e 0) — desde a 34/35, o vínculo é a fonte; profiles é só espelho
select count(*) from profiles p where not exists (select 1 from organization_memberships m where m.user_id = p.id);
select public.reconciliar_perfis_dos_vinculos();   -- esperado: 0 (nada a ajustar)

-- 2) ninguém sem login executa RPC (esperado: só clube_legado_id)
select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute');

-- 3) nenhuma linha ficou sem clube nos módulos novos (esperado: 0 em todas)
select (select count(*) from config_clube where club_id is null) + (select count(*) from jogos_trilha where club_id is null)
     + (select count(*) from desafios where club_id is null) + (select count(*) from chat_mensagens where club_id is null);

-- 4) o Tenant 001 tem o chat geral, o catálogo de jogos e o conteúdo de antes
select (select count(*) from chat_conversas where tipo = 'geral'), (select count(*) from jogos_trilha), (select count(*) from desafios);

-- 5) (migration 29) nenhuma mensagem apagada guarda o texto na tabela: esperado 0
select count(*) from chat_mensagens where apagada and texto <> '(mensagem apagada)';

-- 6) (migrations 31/32) buckets: imagens privado (depois da 32), comprovacoes privado, publico é o único público
select id, public from storage.buckets order by id;
```
Teste manual rápido (logando como cada papel): liderança vê **Aprovações**; membro vê ranking/mural; **responsável** só vê "Meu Filho";
leilão fecha pelo botão e pelo cron com a mesma cobrança; **Gestão → 🎮 Jogos** liga/desliga; **Gestão → Conteúdo** edita missões
e versículos; **PIX e popup** salvam; chat geral e da unidade funcionam; **Ranking** e **Perfil** abrem rápido.

## Comportamentos novos que você vai notar (todos intencionais)
- **Menu, barra de baixo, Gestão e rotas seguem os RECURSOS do clube** (`recursos_catalogo` + `club_features`): no Tenant 001 nada some (os 11 recursos de sempre vêm ligados e o leilão continua ligado). A liderança liga/desliga em
  **Gestão → 🎨 Identidade e recursos**, onde também edita nome, sigla, lema, cores e logo do clube (a logo vai para o bucket `publico`, pasta do clube). O Tenant 001 mantém a marca de sempre, agora vinda do banco.
- **Papel e unidade vêm do vínculo no clube**, não do perfil: quem tem o vínculo pendente/suspenso, ou uma conta sem clube, vê a tela "Sem acesso" (e erro de rede mostra "Tentar de novo" em vez de liberar algo).
- **Front antes do SQL**: sem a `33` o app roda no modo de compatibilidade (papel/unidade do perfil, marca legada, recursos como sempre) e a tela de identidade avisa que falta o SQL — nada quebra.
- **Múltiplos clubes por pessoa, de verdade** (`34`): quem tem vínculo ativo em mais de um clube vê um seletor na barra (2+ clubes
  utilizáveis) e troca entre eles — cada troca refaz o menu, os dados e a marca pro clube escolhido. Trocar para um clube sem
  vínculo (ou com vínculo suspenso/pendente) nunca funciona, mesmo insistindo.
- **Editar cargo/status/unidade de alguém** (tela Usuários/Aprovações) passa a valer só para o clube EM USO de quem edita — antes
  gravava direto em `profiles`; agora é uma RPC (`vinculo_gerir`) que também corrige uma falha achada nesta fase: um diretor de um
  clube que também fosse membro comum de outro não conseguia mais, sem querer, usar a autoridade de um clube pra mexer em gente
  do outro.
- **Desligar um recurso (Gestão → Identidade e recursos) passa a bloquear escrita nova**, não só a rota: quem chamar a API direto
  com o recurso desligado recebe erro claro. O que já existia continua visível e editável (aprovar pendência antiga, marcar
  mensalidade paga...).
- **Mensagem apagada no chat**: a liderança segue vendo o texto original (tela de moderação, agora lendo a view); os demais veem só "Mensagem removida pela liderança", inclusive se abrirem a API direto. Um front antigo em cache lendo a tabela na tela de moderação mostra o marcador `(mensagem apagada)` em vez do texto.
- **Erros de escrita ficam genéricos para o cliente**: lançar ponto/enviar entrega/registrar mensalidade/avisar alguém com um id de pessoa, unidade ou atividade que não é do seu clube (ou não existe) responde só "violação de segurança de linha" (o texto da RLS). A mensagem específica continua no SQL Editor/cron. `avaliado_por`/`registrado_por` só aceitam você mesmo (é o que o app já grava).
- **Envio de imagem** só nos caminhos que o app usa: avatar próprio (`perfis/<seu id>-…`), mural próprio (membro ativo), emblema/bandeira (liderança do clube da unidade). Qualquer outro caminho no bucket `imagens` é recusado.
- **Responsável (`pais`)** só enxerga o portal "Meus Filhos". **Instrutor** não redefine senha de instrutor/diretoria nem abre nova temporada.
- **INSERT manual no SQL Editor**: em `unidades`, `atividades`, `eventos`, `config_clube`, `jogos_trilha`, `desafios`, `versiculos`,
  `leiloes`… é preciso informar `club_id` (sem sessão de usuário não há clube "atual"); `update config_clube … where chave = 'x'`
  sem filtrar `club_id` atinge o mesmo `x` de **todos** os clubes. Fotos/avisos/pontos sem clube caem no Tenant 001 (como sempre).
- **Jogo NOVO** no catálogo: use `select public.catalogo_jogo_definir('chave','Nome','🎲',ordem,false,true)` (cria em todos os clubes;
  o último `true` liga só no clube legado). `insert into jogos_trilha` puro deixou de servir.
- **Clube novo** (`insert into organizational_units … type='clube'`) já nasce com config, catálogo de jogos (só a memória ligada), desafios
  de unidade, chat geral e uma cópia do conteúdo do clube legado.
- Sessões já abertas **não** são derrubadas ao resetar senha/excluir usuário (o token expira sozinho, ~1 h).
- **Motor curricular (`36`)**: nasce com o recurso `classes` DESLIGADO em todos os clubes (mesmo padrão do leilão) — ninguém vê
  "Minha Classe"/"Avaliar classes" até a liderança ligar em **Gestão → 🎨 Identidade e recursos**. A ÚNICA classe hoje é o
  piloto de TESTE (`[PILOTO/TESTE] Amigo`) — não ligue este recurso para membros de verdade antes do currículo oficial entrar.
- **Especialidades (`37`)**: mesmo recurso `classes` (não é uma flag nova) — liga junto com Classes. Nasce com a ÚNICA
  especialidade piloto de TESTE (`[PILOTO/TESTE] Primeiros Socorros`), que a classe piloto passa a exigir concluída num
  requisito novo (dependência de teste, não oficial). O recurso `classes` agora bloqueia ESCRITA de verdade nas RPCs (antes
  da `37`, só escondia a rota — quem chamasse a API direto passava reto mesmo com o recurso desligado; achado da auditoria
  desta fase, corrigido retroativamente também nas RPCs de Classes da `36`).

## Notas das revisões independentes (o que mudou de comportamento e o que observar)
- **Cargo de liderança**: o instrutor tentando promover a diretoria/instrutor/tesoureiro, ou desativar/rebaixar quem já tem esses cargos,
  agora recebe uma **mensagem de erro clara** (antes o cargo era revertido em silêncio e a unidade da pessoa era apagada); a tela de
  Usuários nem oferece essas opções ao instrutor. A diretoria faz tudo como antes.
- **Push "para todos"** não chega mais a responsáveis nem a inativos (o sino já os excluía desde 14/07). Quem entra num aparelho passa a
  ser o dono dele (o app chama `push_registrar` ao entrar e apaga a inscrição de quem sai).
- **Membros não leem perfis de inativos, pendentes e responsáveis** (blindagem dos menores): o autor de uma mensagem antiga de chat,
  se hoje estiver inativo, aparece como "?". A liderança segue vendo todos.
- **Front/APK antigo em cache**: PIX continua salvando (o front antigo usa `update`); **popup, rodízio e "só desbravador" falham** até
  atualizar o app (o upsert por `chave` deixou de existir). O APK é o que não se atualiza sozinho.
- **Leilão com o front publicado antes do SQL**: o front trata a tabela `club_features` inexistente como "leilão ligado" (compat).
- **Migration 26** faz `drop function` sem `cascade` nos 4 helpers antigos: se abortar listando uma policy/view criada **à mão** em
  produção que depende de `pode_gerir()`, troque essa policy por `pode_gerir_no_clube(club_id)` e rode de novo (nada é aplicado pela metade).
- **SQL solto `2026-09-16-mais-missoes-foto.sql`** (missões de foto): agora funciona nos DOIS bancos (antigo e multi-clube) e é idempotente.
- **Cron**: a falha de um clube não derruba os outros e fica registrada: `select * from public.cron_falhas order by quando desc;`
  (o job aparece como sucesso no `cron.job_run_details`; olhe essa tabela).
- **Pontos**: cada lançamento tem teto de ±1.000.000; leilão: item/lance até 1.000.000. `imagens`: só imagem, até 15 MB.

## Testes (local, sem produção)
```bash
npm run test:db          # replay do zero de TODAS as migrations + seed num banco isolado + 35 arquivos de teste
npm run test:db:upgrade  # simula o upgrade de produção: schema legado + dados vivos + pré-voo → 01..40 (116 asserts)
npm run curriculo:importacao:check # a migration 40 (catálogo oficial) bate byte a byte com o manifesto? (manifesto editado sem regerar = FALHA)
npm run test:db:real     # `supabase db reset` DE VERDADE (CLI 2.117.0 via npx) + a suíte no banco resultante
npm run check            # lint + vitest + build
npm run test:storage:e2e # Storage REAL local: upload com upsert, URL pública bloqueada, URL assinada por clube, lote, listagem, bucket publico (48 asserts)
npm run test:edge:bundle # Edge Function com dependências fixadas empacota no edge-runtime real
npm run test:contexto:e2e # PostgREST REAL local: meu_contexto lido pelo front, marca/recursos por HTTP, logo no bucket publico (42 asserts)
```
`supabase db reset` recria o banco local de trabalho (só tem dados do seed). Nunca use `--linked`.

## O que ainda NÃO é por clube
Nada de negócio. Restam só as exceções declaradas em `AUDITORIA-MULTITENANT.md` (conteúdo da Bíblia, dispositivos de push, ledger) e os
riscos residuais listados lá (front/APK antigo em cache, validade de 24 h das URLs assinadas, avatar de ex-membro).
