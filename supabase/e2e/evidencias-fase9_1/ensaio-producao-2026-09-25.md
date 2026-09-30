# Ensaio de produção — producao-2026-09-25

Backup: `banco-completo.dump` (5304 KB). Gerado por `scripts/ensaio-producao.mjs` em 2026-09-25T19:10:33.633Z.
Só números: nenhum nome, e-mail ou conteúdo de pessoa entra neste relatório.

### 1. Ambiente descartável e restore

- stack descartável (CONQUISTA-RESTORE) no ar em 43.1s
- formato custom; 0 aviso(s) benigno(s) de restore (papel/schema da plataforma que o stack já tem)
- ✅ restore sem erro (6.2s)
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
- ❌ pré-voo sem PROBLEMA (a janela real pararia aqui) — `upgrade-parcial-ou-objetos-saas | dados-que-violam-constraints-novas | colunas-legadas-ausentes-ou-divergentes | funcoes-legadas-ausentes-ou-com-assinatura-diferente | policies-fora-do-repo | constrai`

### Tempo

- total 54.1s

## Resultado: **NO-GO — 1 falha(s)**
