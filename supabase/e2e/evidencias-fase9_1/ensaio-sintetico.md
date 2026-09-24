# Ensaio de produção — sintetico

Backup: `banco.sql.gz` (103 KB). Gerado por `scripts/ensaio-producao.mjs` em 2026-09-24T18:02:47.413Z.
Só números: nenhum nome, e-mail ou conteúdo de pessoa entra neste relatório.

### 1. Ambiente descartável e restore

- stack descartável (CONQUISTA-RESTORE) no ar em 38.3s
- formato sql; 0 aviso(s) benigno(s) de restore (papel/schema da plataforma que o stack já tem)
- ✅ restore sem erro (4.2s)
- ✅ o banco restaurado tem o dono original (postgres)
- ✅ ...e o papel do SQL Editor ainda CRIA no public: a próxima migration passa
- ✅ auth, API e storage sobem sobre o banco restaurado
- pg_cron pausado na cópia (cron.launch_active_jobs = off): nenhum job roda durante o ensaio; os cadastros dos jobs ficam intactos

### 2. Em que estado a cópia está

- ledger do CLI (supabase_migrations): AUSENTE
- migrations do SaaS pendentes: 86 de 86
- ✅ o estado é coerente: sem ledger, também sem nenhuma tabela do SaaS (nada aplicado à mão fora do ledger)
- retrato de antes: 45 tabelas copiadas linha a linha

### 3. Pré-voo de produção (supabase/PREFLIGHT-PRODUCAO.sql)

- ✅ o pré-voo roda numa transação SOMENTE LEITURA (não escreve nada)
- RESUMO: PROBLEMA — 1 problema(s), 3 aviso(s), 37 ok — pré-voo das migrations 20260921000001..20260930000080
- PROBLEMA: ledger-do-cli-supabase_migrations-ausente — 1 achado(s): supabase_migrations.schema_migrations não existe: o insert do ledger anexado a cada migration aborta (e desfaz) a migration → correção: Antes da janela, no SQL Editor: create schema if not exists supabase_migrations; create table if not exists supabase_migrations.schema_migrations (version text not null primary key, statements text[],
- AVISO: pacote-curricular-colado-integro — 1 achado(s): conferência pendente, fora do banco: a colagem de ~39 KB da 40 e da 43 só existe na janela — confira-a com o BLOCO À PARTE no fim deste arquivo (sh
- AVISO: tesoureiro-ativo-vs-mensalidades_ano — 1 achado(s): 1 tesoureiro(s) ativo(s): a 20260924000059 cria mensalidades_ano com o portão de gestão e só a 20260930000080 o troca por pode_financeiro_no_clube 
- AVISO: segredos-de-push-no-vault — 2 achado(s): falta o segredo push_edge_url no Vault | falta o segredo push_webhook_secret no Vault
- ✅ pré-voo sem PROBLEMA fora a criação do ledger (correção documentada)
- correção do pré-voo aplicada como `postgres` (o papel do SQL Editor): ledger do CLI criado, vazio

### 4. Migrations do SaaS (86), uma execução por arquivo, com o ledger na mesma transação

- ✅ todas as 86 migrations aplicaram (19.0s)
- ✅ ledger conferido pelo CONJUNTO (não pelo max): nenhuma versão faltando
- ✅ o banco restaurado tem o dono original (postgres)
- ✅ ...e o papel do SQL Editor ainda CRIA no public: a próxima migration passa

### 5. Antes × depois — entidades críticas


| entidade | antes | depois | esperado |
|---|---:|---:|---|
| contas (auth.users) | 10 | 10 | ✅ igual |
| perfis | 10 | 10 | ✅ igual |
| vínculos (antes: 1 perfil = 1 membro do clube único) | 10 | 10 | ✅ igual — a migration 2 cria exatamente um vínculo no Tenant 001 por perfil |
| unidades | 2 | 2 | ✅ igual |
| lançamentos de pontos | 5 | 5 | ✅ igual |
| soma dos pontos | 105 | 105 | ✅ igual |
| mensalidades | 4 | 4 | ✅ igual |
| caixa (soma das mensalidades pagas) | 150 | 150 | ✅ igual |
| catálogo de jogos | 28 | 28 | ✅ igual |
| jogadas + recordes + partidas | 4 | 4 | ✅ igual |
| mensagens do chat | 2 | 2 | ✅ igual |
| avisos (notificações) | 23 | 23 | ✅ igual |
| fotos do mural | 2 | 2 | ✅ igual |
| objetos do Storage (metadados) | 4 | 4 | ✅ igual |
| configurações do clube | 6 | 6 | ✅ igual |
| responsáveis aprovados | 1 | 1 | ✅ igual |
| eventos da agenda | 2 | 2 | ✅ igual |
| atividades + entregas | 3 | 3 | ✅ igual |
| leilões + lances | 2 | 2 | ✅ igual |
| documentos de classe | 0 | 0 | ✅ igual — classes/documentos não existiam no produto antigo: o upgrade não pode inventar documento |
| matrículas em classe | 0 | 0 | ✅ igual — idem: nenhuma matrícula nasce do upgrade |

### 6. Antes × depois — linha a linha, coluna a coluna


| tabela | diferença | coluna | linhas | explicadas | por quê |
|---|---|---|---:|---:|---|
| chat_mensagens | alterada | texto | 1 | 1 | 29: mensagem já apagada: o texto sai da tabela lida pelos membros e fica só na trilha da moderação (original conferido lá) |
| cron__job | adicionada |  | 4 | 4 | várias: job agendado pelas migrations do SaaS |
| migracoes_aplicadas | adicionada |  | 45 | 45 | 1..: cada migration do SaaS registra o próprio nome no ledger antigo |
| profiles | alterada | status | 2 | 2 | 13, 34: o perfil passa a espelhar o vínculo: "inativo" vira "suspenso" e "rejeitado" vira "encerrado" (vocabulário do vínculo) |
| storage__buckets | adicionada |  | 1 | 1 | 31: bucket público novo, só para marca/brasão dos clubes |
| storage__buckets | alterada | allowed_mime_types | 1 | 1 | 28: só imagens no bucket imagens |
| storage__buckets | alterada | file_size_limit | 1 | 1 | 28: limite de 15 MB por arquivo no bucket imagens |
| storage__buckets | alterada | public | 1 | 1 | 32: bucket imagens passa a PRIVADO (URL assinada por clube) |
- ✅ toda diferença em dado que já existia tem explicação (8 grupo(s), 0 sem explicação)
- 80 tabelas novas do SaaS; 27 nascem com linhas (backfill ou semeadura da plataforma): alerta_destinos=1, billing_plans=5, billing_policies=1, billing_prices=10, billing_providers=1, chat_mensagens_apagadas=1, class_requirements=305, class_sections=111, classes=13, club_features=1, club_provisioning_status=1, club_storage_objetos=4, club_storage_uso=1, curriculum_dependencies=1, curriculum_versions=4, document_templates=1, dynamic_content_definitions=6, experience_templates=2, investiture_workflow_stages=2, investiture_workflows=1, organization_memberships=10, organizational_units=1, recursos_catalogo=15, requirement_option_groups=50, requirement_options=147, specialties=1, specialty_requirements=3

### 7. Invariantes do upgrade (fora da RLS)

- ✅ o Tenant 001 existe (clube legado) e é um clube ativo
- ✅ cada perfil de antes tem exatamente 1 vínculo de clube, e é no Tenant 001
- ✅ papel e situação de cada vínculo = os do perfil de antes (mapa das migrations 2 e 13)
- ✅ a unidade de cada vínculo = a unidade do perfil de antes
- ✅ as 34 tabelas antigas que ganharam club_id: toda linha é do Tenant 001
- ✅ todo objeto do Storage está no controle de uso do Tenant 001
- ✅ a reconciliação perfil × vínculo não tem nada a ajustar
- recursos do Tenant 001 depois do upgrade: leilao

### 8. Suíte de banco sobre a cópia atualizada (cada teste em transação com ROLLBACK)

- 9 de 9 testes que só esbarravam no leilão aberto passam num clone da cópia com esse leilão cancelado (ação de operador): 01_leilao_cron_vs_manual.sql, 04_lider_tenant001.sql, 05_lider_tenant002.sql, 21_revisao_de_seguranca_rodada2.sql, 24_oraculos_de_uuid.sql, 26_contexto_do_clube.sql, 53_leilao_rateio_conjunto.sql, 55_matriz_multiclube.sql, 56_gate_multiclube_permanente.sql
- ✅ suíte de banco na cópia: 49 arquivos verdes, 16 só colidem com contagem exata no Tenant 001, 0 falha(s) de verdade
- 07_push_por_clube.sql: colide com o dado real (conta os aparelhos do Tenant 001: a cópia tem aparelhos reais) — verde no replay e no upgrade simulado
- 11_revisao_independente.sql: colide com o dado real (conta os arquivos do Storage do Tenant 001) — verde no replay e no upgrade simulado
- 12_regressoes_tenant001.sql: colide com o dado real (conta mensalidades/mensagens do Tenant 001 e abre temporada) — verde no replay e no upgrade simulado
- 14_duelos_por_clube.sql: colide com o dado real (conta duelos e avisos do Tenant 001) — verde no replay e no upgrade simulado
- 15_missoes_e_devocional_por_clube.sql: colide com o dado real (conta missões pendentes do Tenant 001) — verde no replay e no upgrade simulado
- 16_leilao_por_clube.sql: colide com o dado real (cria leilão E conta itens, lances e avisos do Tenant 001) — verde no replay e no upgrade simulado
- 17_jogos_por_clube.sql: colide com o dado real (conta o ranking/recordes do Tenant 001) — verde no replay e no upgrade simulado
- 18_jogos_cron_por_clube.sql: colide com o dado real (conta prêmios de rodada do Tenant 001) — verde no replay e no upgrade simulado
- 19_chat_bichinho_biblia_por_clube.sql: colide com o dado real (conta mensagens e bichinhos do Tenant 001) — verde no replay e no upgrade simulado
- 23_chat_mensagem_moderada.sql: colide com o dado real (conta mensagens apagadas do Tenant 001) — verde no replay e no upgrade simulado
- 25_imagens_privadas.sql: colide com o dado real (conta os objetos do Storage do Tenant 001) — verde no replay e no upgrade simulado
- 47_push_nativo_e_infra.sql: colide com o dado real (conta aparelhos do Tenant 001) — verde no replay e no upgrade simulado
- 49_armazenamento_por_clube.sql: colide com o dado real (conta objetos do Storage do Tenant 001) — verde no replay e no upgrade simulado
- 52_paginacao_keyset.sql: colide com o dado real (pagina o chat geral do Tenant 001, que já tem mensagens) — verde no replay e no upgrade simulado
- 57_entrada_em_clube.sql: colide com o dado real (a liderança do Tenant 001 vê o cadastro pendente REAL da cópia) — verde no replay e no upgrade simulado
- multi_tenant_isolation.sql: colide com o dado real (exige o seed de desenvolvimento (duas unidades organizacionais)) — verde no replay e no upgrade simulado

### 9. Tenant 001 depois do upgrade — as jornadas do clube, pela API do descartável

- ✅ diretoria entra com a senha de ANTES do upgrade (hash restaurado, Auth aceita)
- ✅ Login — diretoria entra pelo Auth do descartável
- ✅ Login — membro entra pelo Auth do descartável
- ✅ Login — responsavel entra pelo Auth do descartável
- ✅ Login — tesouraria entra pelo Auth do descartável
- ✅ Home — diretoria: contexto com 1 vínculo, no Tenant 001, e o servidor usa o Tenant 001 sem cabeçalho
- ✅ Home — membro: contexto com 1 vínculo, no Tenant 001, e o servidor usa o Tenant 001 sem cabeçalho
- ✅ Home — responsavel: contexto com 1 vínculo, no Tenant 001, e o servidor usa o Tenant 001 sem cabeçalho
- ✅ Home — tesouraria: contexto com 1 vínculo, no Tenant 001, e o servidor usa o Tenant 001 sem cabeçalho
- ✅ Home — os módulos que o clube usava seguem ligados (chat, jogos, mensalidades)
- ✅ Membros — a diretoria lista todas as pessoas de antes (tela Usuários)
- ✅ Unidades — a diretoria vê as unidades de antes
- ✅ Pontos — a diretoria vê a mesma soma de pontos de antes
- ✅ Pontos — o ranking abre
- ✅ Mensalidades — a diretoria vê todas as mensalidades de antes
- ✅ Gestão — o painel de pendências abre
- ✅ Gestão — os cadastros pendentes de antes seguem pendentes para a diretoria
- ✅ Mensalidades — a tesouraria vê o mesmo caixa de antes
- ✅ Pontos — o membro vê os pontos do clube, como antes
- ✅ Jogos — o catálogo de jogos do clube está lá
- ✅ Jogos — o progresso da trilha abre
- ✅ Jogos — o ranking dos jogos abre
- ✅ Chat — o membro lê o histórico do chat geral
- Classes — recurso desligado no Tenant 001 (o produto antigo não tinha classes): jornada não aplicável
- ✅ Classes — com o recurso desligado, o servidor RECUSA iniciar uma classe (não é só o menu que some)
- ✅ Responsável — "Meu filho" traz os filhos aprovados de antes
- ✅ Responsável — continua sem ver os pontos do clube
- Documentos — o produto antigo não emitia documento: nada a abrir (e o upgrade não inventou nenhum)

### Tempo

- total 151.3s (migrations 19.0s)

## Resultado: **ENSAIO OK**
