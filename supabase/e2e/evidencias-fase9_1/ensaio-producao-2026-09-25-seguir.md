# Ensaio de produção — producao-2026-09-25-seguir

Backup: `banco-completo.dump` (5304 KB). Gerado por `scripts/ensaio-producao.mjs` em 2026-09-25T19:20:45.604Z.
Só números: nenhum nome, e-mail ou conteúdo de pessoa entra neste relatório.

### 1. Ambiente descartável e restore

- stack descartável (CONQUISTA-RESTORE) no ar em 38.7s
- formato custom; 0 aviso(s) benigno(s) de restore (papel/schema da plataforma que o stack já tem)
- ✅ restore sem erro (5.8s)
- ✅ o banco restaurado tem o dono original (postgres)
- ✅ ...e o papel do SQL Editor ainda CRIA no public: a próxima migration passa
- ✅ auth, API e storage sobem sobre o banco restaurado
- pg_cron pausado na cópia (cron.launch_active_jobs = off): nenhum job roda durante o ensaio; os cadastros dos jobs ficam intactos

### 2. Em que estado a cópia está

- ledger do CLI (supabase_migrations): presente, 86 versão(ões)
- migrations do SaaS pendentes: 16 de 102
- ✅ o estado é coerente: sem ledger, também sem nenhuma tabela do SaaS (nada aplicado à mão fora do ledger)
- retrato de antes: 125 tabelas copiadas linha a linha

### 3. Pré-voo de produção (supabase/PREFLIGHT-PRODUCAO.sql)

- ✅ o pré-voo roda numa transação SOMENTE LEITURA (não escreve nada)
- RESUMO: PROBLEMA — 9 problema(s), 10 aviso(s), 22 ok — pré-voo das migrations 20260921000001..20260930000080
- PROBLEMA: upgrade-parcial-ou-objetos-saas — 231 achado(s): tabela do SaaS já existe: public.alerta_destinos | tabela do SaaS já existe: public.alerta_entregas | tabela do SaaS já existe: public.alertas |  → correção: Não recomece do 01 sobre um upgrade parcial. Se o ledger registra versões, continue da primeira que falta, conferindo pelo CONJUNTO (nunca pelo max(version)). Objeto do SaaS sem registro em ledger nen
- PROBLEMA: dados-que-violam-constraints-novas — 1 achado(s): 25: 2 conversas do tipo geral → correção: (03) renomeie ou una as unidades, movendo antes profiles.unidade_id, pontos, duelos e a conversa da unidade; (08) feche as temporadas abertas a mais (update public.temporadas set fim = now() where id 
- PROBLEMA: colunas-legadas-ausentes-ou-divergentes — 25 achado(s): coluna public.leilao_itens.club_id só existe aqui e é NOT NULL sem default: o insert do SaaS que não a conhece falha | coluna public.pontos.club_i → correção: Tabela ou coluna ausente: rode antes o SQL legado indicado (ou ache-o com git grep -n <coluna> supabase/migrations/20260[7-9]*). Tipo diferente: alter table ... alter column ... type ... using ..., de
- PROBLEMA: funcoes-legadas-ausentes-ou-com-assinatura-diferente — 5 achado(s): eh_financeiro(): ausente | eh_membro_ativo(): ausente | notif_cadastro_aprovado(): ausente | pode_aprovar(): ausente | pode_gerir(): ausente → correção: Sobrecarga extra: drop function public.<nome>(<tipos antigos>), depois de confirmar que o front publicado não a chama. Mesmo nome com parâmetro/retorno diferente, ou ausente: rode de novo o SQL legado
- PROBLEMA: policies-fora-do-repo — 93 achado(s): public.alertas "operação lê alertas" (SELECT {authenticated}): sobrevive a todas as migrations: soma (OR) com as policies por clube | public.app_e → correção: Descubra a origem de cada policy e remova-a antes da janela: drop policy "<nome>" on <esquema>.<tabela>. Se o acesso fizer falta, recrie-a DEPOIS do upgrade, por clube (pode_gerir_no_clube/membro_ativ
- PROBLEMA: constraints-e-indices-unicos-fora-do-padrao — 61 achado(s): CHECK fora do repo em pontos: pontos_valor_razoavel — CHECK (((pontos >= '-1000000'::integer) AND (pontos <= 1000000))) | CHECK fora do repo em pu → correção: Equivalente com outro nome: renomeie para o padrão (alter table ... rename constraint <nome> to <padrão> / alter index ... rename to ...). Índice único extra que duplica o padrão: drop index public.<n
- PROBLEMA: gatilhos-fora-do-repo — 48 achado(s): gatilho do repo ausente: public.profiles trg_notif_cadastro_aprovado | gatilho do repo ausente: public.profiles trg_notif_novo_cadastro | gatilho  → correção: Gatilho de teto com outro nome: renomeie para um que ordene DEPOIS de trg_definir_club_ponto (o legado usa trg_limita_pontos_conselheiro). Webhooks/gatilhos manuais em profiles e auth.users: remova, o
- PROBLEMA: buckets-de-storage — 1 achado(s): já existe bucket id/name publico (publico, 0 objetos): a 31 o reconfigura ou aborta → correção: Rode 20260828000008_storage-comprovacoes.sql antes da janela (a policy dele com pode_gerir() é trocada na 16). Bucket comprovacoes público: update storage.buckets set public = false where id = 'compro
- PROBLEMA: cron-jobs-conflitantes — 4 achado(s): job 21 expurgar-app-erros: nome reservado por uma migration do SaaS (53/54/55/57) — o job novo NÃO é criado | job 22 reconciliar-armazenamento: nom → correção: Antes da janela: select cron.unschedule('<nome>'); para o job homônimo (ou renomeie-o). Os jobs de outro papel: recrie como postgres no SQL Editor (unschedule e schedule).
- AVISO: pacote-curricular-colado-integro — 1 achado(s): conferência pendente, fora do banco: a colagem de ~39 KB da 40 e da 43 só existe na janela — confira-a com o BLOCO À PARTE no fim deste arquivo (sh
- AVISO: webhook-de-push-do-painel — 1 achado(s): gatilho push-notificacoes em notificacoes → supabase_functions.http_request() (sem x-push-webhook-secret: vira 401 e alerta crítico depois da 55/57
- AVISO: segredos-de-push-no-vault — 2 achado(s): falta o segredo push_edge_url no Vault | falta o segredo push_webhook_secret no Vault
- AVISO: funcoes-fora-do-repo-ou-de-outro-dono — 314 achado(s): _admin_auditar(p_acao text, p_alvo_tipo text, p_alvo_id uuid, p_detalhe jsonb): fora do repo | _assinatura_transicionar(p_sub_id uuid, p_novo tex
- AVISO: objetos-em-tabelas-so-de-producao — 75 achado(s): FK de class_completion_snapshots para tabela legada: class_completion_snapshots_gerado_por_fkey — FOREIGN KEY (gerado_por) REFERENCES profiles(id)
- AVISO: nascimento-implausivel — 7 achado(s): perfil 15fda72d-37f6-4185-a738-05fb7b76bf6d (desbravador, ativo): nascimento no futuro | perfil 1ba3a864-3a85-43f2-b477-b2cf096712e7 (desbravador, 
- AVISO: uploads-que-a-28-e-a-31-recusam — 51 achado(s): imagens/atividades/22726b03-4bbb-4d41-9a08-0490b69c7a4e-1b9614db-0b29-470c-a5b6-f63737736e5e-1787527295529.mp4: caminho fora do formato que pode_s
- AVISO: comprovacoes-sem-linha-com-o-nome-exato — 15 achado(s): comprovacoes/1a1e3c03-e2cf-4b27-9635-b4f1d828ff88/atividades/1788463579659.mp4: nenhuma linha cita o nome exato — a liderança deixa de ver | compr
- AVISO: objetos-de-storage-sem-clube — 2 achado(s): bucket comprovacoes: 1 objeto(s) sem dono ativo, 85923 bytes fora da conta do clube | bucket imagens: 1 objeto(s) sem dono ativo, 30932 bytes fora 
- AVISO: fim-de-linha-crlf-no-metodo-de-aplicacao — 20 achado(s): _biblia_segundos_min tem CR (\r) no corpo | _bichinho_estagio tem CR (\r) no corpo | _bichinho_nivel_cenario tem CR (\r) no corpo | _bichinho_nive
- ✅ pré-voo sem PROBLEMA fora a criação do ledger (correção documentada)

### 4. Migrations do SaaS (16), uma execução por arquivo, com o ledger na mesma transação

- ✅ todas as 16 migrations aplicaram (3.4s)
- ✅ ledger conferido pelo CONJUNTO (não pelo max): nenhuma versão faltando
- ✅ o banco restaurado tem o dono original (postgres)
- ✅ ...e o papel do SQL Editor ainda CRIA no public: a próxima migration passa

### 5. Antes × depois — entidades críticas


| entidade | antes | depois | esperado |
|---|---:|---:|---|
| contas (auth.users) | 34 | 34 | ✅ igual |
| perfis | 31 | 31 | ✅ igual |
| vínculos (antes: 1 perfil = 1 membro do clube único) | 31 | 30 | ❌ DIFERENTE — a migration 2 cria exatamente um vínculo no Tenant 001 por perfil |
| unidades | 5 | 5 | ✅ igual |
| lançamentos de pontos | 17556 | 17556 | ✅ igual |
| soma dos pontos | 327821 | 327821 | ✅ igual |
| mensalidades | 37 | 37 | ✅ igual |
| caixa (soma das mensalidades pagas) | 900 | 900 | ✅ igual |
| catálogo de jogos | 56 | 56 | ✅ igual |
| jogadas + recordes + partidas | 23237 | 23237 | ✅ igual |
| mensagens do chat | 74 | 74 | ✅ igual |
| avisos (notificações) | 1692 | 1692 | ✅ igual |
| fotos do mural | 29 | 29 | ✅ igual |
| objetos do Storage (metadados) | 397 | 397 | ✅ igual |
| configurações do clube | 25 | 25 | ✅ igual |
| responsáveis aprovados | 0 | 0 | ✅ igual |
| eventos da agenda | 1 | 1 | ✅ igual |
| atividades + entregas | 160 | 160 | ✅ igual |
| leilões + lances | 61 | 61 | ✅ igual |
| documentos de classe | 0 | 0 | ✅ igual — classes/documentos não existiam no produto antigo: o upgrade não pode inventar documento |
| matrículas em classe | 0 | 1 | ❌ DIFERENTE — idem: nenhuma matrícula nasce do upgrade |

### 6. Antes × depois — linha a linha, coluna a coluna


| tabela | diferença | coluna | linhas | explicadas | por quê |
|---|---|---|---:|---:|---|
| billing_plans | adicionada |  | 1 | 0 | **sem regra** |
| billing_plans | alterada | publico | 4 | 0 | **sem regra** |
| billing_prices | adicionada |  | 1 | 0 | **sem regra** |
| migracoes_aplicadas | adicionada |  | 15 | 15 | 1..: cada migration do SaaS registra o próprio nome no ledger antigo |
| storage__buckets | adicionada |  | 2 | 0 | 31: bucket público novo, só para marca/brasão dos clubes |
- ❌ toda diferença em dado que já existia tem explicação (5 grupo(s), 4 sem explicação) — `billing_plans.* adicionada 1 | billing_plans.publico alterada 4 | billing_prices.* adicionada 1 | storage__buckets.* adicionada 2`
- 5 tabelas novas do SaaS; 1 nascem com linhas (backfill ou semeadura da plataforma): termos_consentimento=1

### 7. Invariantes do upgrade (fora da RLS)

- ✅ o Tenant 001 existe (clube legado) e é um clube ativo
- ❌ cada perfil de antes tem exatamente 1 vínculo de clube, e é no Tenant 001 — `1 violação(ões)`
- ✅ papel e situação de cada vínculo = os do perfil de antes (mapa das migrations 2 e 13)
- ✅ a unidade de cada vínculo = a unidade do perfil de antes
- ✅ as 0 tabelas antigas que ganharam club_id: toda linha é do Tenant 001
- ❌ todo objeto do Storage está no controle de uso do Tenant 001 — `2 violação(ões)`
- ✅ a reconciliação perfil × vínculo não tem nada a ajustar
- recursos do Tenant 001 depois do upgrade: leilao, jogos, classes (desligado)

### 8. Suíte de banco sobre a cópia atualizada (cada teste em transação com ROLLBACK)

- ❌ suíte de banco na cópia: 45 arquivos verdes, 11 só colidem com contagem exata no Tenant 001, 14 falha(s) de verdade — `03_responsavel.sql 05_lider_tenant002.sql 09_compat_e_hardening.sql 11_revisao_independente.sql 13_config_por_clube.sql 30_jogos_premios_multiclube_isolados.sql 37_classes_regulares_2026_cenarios.sql `
- 07_push_por_clube.sql: colide com o dado real (conta os aparelhos do Tenant 001: a cópia tem aparelhos reais) — verde no replay e no upgrade simulado
- 12_regressoes_tenant001.sql: colide com o dado real (conta mensalidades/mensagens do Tenant 001 e abre temporada) — verde no replay e no upgrade simulado
- 14_duelos_por_clube.sql: colide com o dado real (conta duelos e avisos do Tenant 001) — verde no replay e no upgrade simulado
- 16_leilao_por_clube.sql: colide com o dado real (cria leilão E conta itens, lances e avisos do Tenant 001) — verde no replay e no upgrade simulado
- 17_jogos_por_clube.sql: colide com o dado real (conta o ranking/recordes do Tenant 001) — verde no replay e no upgrade simulado
- 18_jogos_cron_por_clube.sql: colide com o dado real (conta prêmios de rodada do Tenant 001) — verde no replay e no upgrade simulado
- 19_chat_bichinho_biblia_por_clube.sql: colide com o dado real (conta mensagens e bichinhos do Tenant 001) — verde no replay e no upgrade simulado
- 25_imagens_privadas.sql: colide com o dado real (conta os objetos do Storage do Tenant 001) — verde no replay e no upgrade simulado
- 47_push_nativo_e_infra.sql: colide com o dado real (conta aparelhos do Tenant 001) — verde no replay e no upgrade simulado
- 49_armazenamento_por_clube.sql: colide com o dado real (conta objetos do Storage do Tenant 001) — verde no replay e no upgrade simulado
- 52_paginacao_keyset.sql: colide com o dado real (pagina o chat geral do Tenant 001, que já tem mensagens) — verde no replay e no upgrade simulado

### 9. Tenant 001 depois do upgrade — as jornadas do clube, pela API do descartável

- ✅ Login — diretoria entra pelo Auth do descartável
- ✅ Login — membro entra pelo Auth do descartável
- responsavel: não há ninguém com esse papel ativo no Tenant 001 — jornada não aplicável
- ✅ Login — tesouraria entra pelo Auth do descartável
- ✅ Home — diretoria: contexto com 1 vínculo, no Tenant 001, e o servidor usa o Tenant 001 sem cabeçalho
- ✅ Home — membro: contexto com 1 vínculo, no Tenant 001, e o servidor usa o Tenant 001 sem cabeçalho
- ✅ Home — tesouraria: contexto com 1 vínculo, no Tenant 001, e o servidor usa o Tenant 001 sem cabeçalho
- ✅ Home — os módulos que o clube usava seguem ligados (chat, jogos, mensalidades)
- ❌ Membros — a diretoria lista todas as pessoas de antes (tela Usuários) — `vê 30`
- ✅ Unidades — a diretoria vê as unidades de antes
- ❌ Pontos — a diretoria vê a mesma soma de pontos de antes
- ✅ Pontos — o ranking abre
- ✅ Mensalidades — a diretoria vê todas as mensalidades de antes
- ✅ Gestão — o painel de pendências abre
- ✅ Gestão — os cadastros pendentes de antes seguem pendentes para a diretoria
- ✅ Mensalidades — a tesouraria vê o mesmo caixa de antes
- ❌ Pontos — o membro vê os pontos do clube, como antes — `vê 1000`
- ❌ Jogos — o catálogo de jogos do clube está lá
- ✅ Jogos — o progresso da trilha abre
- ✅ Jogos — o ranking dos jogos abre
- ✅ Chat — o membro lê o histórico do chat geral
- Classes — recurso desligado no Tenant 001 (o produto antigo não tinha classes): jornada não aplicável
- ✅ Classes — com o recurso desligado, o servidor RECUSA iniciar uma classe (não é só o menu que some)
- Documentos — o produto antigo não emitia documento: nada a abrir (e o upgrade não inventou nenhum)

### Tempo

- total 750.0s (migrations 3.4s)

## Resultado: **NO-GO — 10 falha(s)**
