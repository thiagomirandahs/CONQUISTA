# Matriz de auditoria multi-tenant (clube = tenant)

Estado: **todos os módulos são por clube**. Tenant 001 = clube atual ("Filhos da Conquista", slug `filhos-da-conquista`);
Tenant 002 = clube de teste local. Esta matriz é **executável**: `supabase/tests/20_matriz_de_auditoria.sql` falha se uma
tabela/rotina nova entrar sem decidir a que clube pertence. Nada disto foi aplicado em produção.

## Modelo (o que vale para tudo)
- **Clube** = `organizational_units` (`type = 'clube'`). **Vínculo** = `organization_memberships` — uma pessoa pode ter vínculo em
  QUANTOS clubes tiver (migration 34 removeu o "1 clube por pessoa"); papel, unidade e status são do VÍNCULO, um por clube
  (`desbravador | conselheiro | instrutor | diretoria | tesoureiro | pais`). `profiles` é só identidade global (nome, foto, avatar) —
  nunca duplicada por clube. Ver "Multi-clube real" abaixo.
- Toda tabela de dados tem `club_id uuid not null → organizational_units(id)`. O clube **nasce do dado** (gatilho: do dono, do pai da
  linha ou da unidade), nunca do cliente; um `club_id` forjado é recusado pela policy/gatilho.
- Permissões: `membro_ativo_no_clube(club)` (papel ≠ `pais`), `pode_gerir_no_clube(club)` (instrutor/diretoria),
  `pode_financeiro_no_clube(club)` (tesoureiro/diretoria), `tem_vinculo_unidade(club)` (qualquer vínculo ativo — só o PIX do
  responsável). Sempre com o clube **da linha** ou de quem chama (`clube_atual_id()`); os helpers globais legados
  (`pode_gerir()`, `eh_membro_ativo()`…) foram **removidos** (migration 26).
- RPCs `SECURITY DEFINER` derivam o clube de `clube_atual_id()` e conferem TUDO contra ele. UUID de outro clube responde igual a
  "não encontrado" (sem oráculo). Rotinas internas/cron não são executáveis por usuário.
- Cron: cada rotina é um laço por clube (`ordem created_at`), com a config e o prêmio/aviso do clube, isolando falhas
  (`exception when others` → falha registrada em `cron_falhas` + warning); idempotente por clube.
- **Clube novo** nasce completo por `provisionar_clube()` (registro `_prov_*`): config padrão, catálogo de jogos (só a memória
  ligada), desafios de unidade, chat geral e **uma cópia do conteúdo** (missões/versículos) do clube legado.

## Matriz por módulo
| Módulo | Tabelas (club_id) | Quem lê / grava | RPCs e rotinas | Front | Teste (asserts) |
|---|---|---|---|---|---|
| Núcleo: unidades, atividades, entregas, pontos, fotos, eventos, temporadas, mensalidades, notificações | todas | membro do clube lê; liderança/financeiro do clube grava | ranking, aprovar entrega, temporadas, push | RLS | 02, 04, 05, 06, 07 |
| Responsáveis e convites | `responsaveis`, `club_invites` | `pais` só por `meus_filhos()`; convite com hash, 14 dias, uso único | `criar/listar/revogar_convite_responsavel`, `pedir/aprovar_vinculo` | Cadastro, Vínculos | 03, 08 |
| Config do clube | `config_clube` PK `(club_id, chave)` | membro/responsável lê (PIX); liderança do clube grava | `config_gravar(jsonb)`, `config_valor/definir` (internos) | `gravarConfig()` (RPC; fallback p/ banco antigo) | 13 (54) |
| Duelos | `desafios_unidade`, `duelos` | membro lê; liderança julga/cancela/apaga o do clube | `criar/julgar/cancelar/progresso_duelo` | Desafios | 14 (59) |
| Missões e devocional | `missoes_feitas`, `devocional`, **`desafios`, `versiculos` (conteúdo do clube)** | membro lê o próprio; liderança do clube avalia e **edita o conteúdo do clube** | `missao_do_dia`, `registrar_missao/devocional`, `missoes_pendentes`, `avaliar_missao` | Missões, Devocional, Conteúdo | 15 (76) |
| Leilão | `leiloes`, `leilao_itens`, `leilao_lances`, `leilao_lance_unidades` (recurso opcional `club_features`) | membro lê se o recurso está ligado no clube; ninguém grava direto | `criar/cancelar/encerrar_leilao`, `dar/confirmar/recusar_lance`, cron `fechar_leiloes_vencidos` | Leilão | 01, 16 (46) |
| Jogos | `jogos_trilha` (PK `(club_id,chave)`), `jogos_liberados`, `trilha_jogos`, `partidas`, `recordes`, `ajudas`, `chefao_golpes` | membro lê a própria trilha e o ranking/recordes do clube; liderança liga jogos e libera/tranca | `registrar_jogo`, `iniciar_jogo`, rodízio, `registrar_recorde`, ajudas, chefão, `catalogo_jogo_definir` | Trilha, Jogos, Chefão | 17 (96) |
| Cron dos jogos | (mesmas) | — | melhores do dia, campeão da semana, rodada da semana, lembretes, pagamento do chefão | — | 18 (32) |
| Chat | `chat_conversas`, `chat_mensagens`, `chat_participantes`, **`chat_mensagens_apagadas`** (texto original das moderadas) | geral = clube; unidade = a unidade; direta = os 2; liderança modera o clube; **o texto de mensagem apagada só existe na trilha, legível pela liderança do clube** (a mensagem guarda só o marcador) | `chat_enviar_*`, `chat_apagar_mensagem`, `chat_todas_conversas`, view `chat_mensagens_visiveis` | Chat, ChatModeracao (lê a view) | 19 (73), 23 (43) |
| Bichinho | `bichinhos` | o dono; "bichinhos do clube" só do clube | `bichinho_*`, `pets_do_clube` | Bichinho | 19 |
| Bíblia | `biblia_leituras`, `biblia_leitura_atual` (conteúdo `biblia_livros/versiculos` = plataforma) | o dono; liderança do clube | `biblia_iniciar/confirmar_leitura` | Bíblia | 19 |
| Storage | `comprovacoes` (**privado**), **`imagens` (privado; só imagem, até 15 MB)**, **`publico`** (reservado; asset realmente público) | comprovante: dono ou liderança do clube do dono; imagens: por CLUBE (colegas veem avatar/mural/emblema do próprio clube, responsável vê a foto do filho, comprovante antigo só dono+liderança; anon nunca); envio só no próprio escopo; `publico`: leitura por URL, escrita só da liderança do clube na pasta `<clube>/` | policies `storage.objects` (`pode_ver_imagem`, `pode_subir_imagem`, `pode_alterar_imagem`, `pode_gerir_pasta_publica`) | `lib/imagens.js` (URL assinada; cai na pública se falhar), `ImagemPrivada`, `Avatar`, `upload.js` (sem fallback público p/ foto de criança) | 06, 11, 20, 25 (62) + e2e real `npm run test:storage:e2e` (48) |
| Produto multi-clube | `recursos_catalogo` (plataforma), `club_features` (`club_id`), marca em `organizational_units.metadata->'marca'` | cada pessoa lê só os PRÓPRIOS vínculos; a liderança do clube grava marca e recursos do PRÓPRIO clube | `meu_contexto()`, `clube_marca_gravar`, `recurso_definir` | `ClubeContext`, `ClubeGuard`, `RotaRestrita`, `RecursoOpcional`, menu por recurso, tela `/clube` (identidade e recursos) | 26 (93) + Vitest (contexto, guardas, serviço, tela, contrato) + e2e real `npm run test:contexto:e2e` (42) |
| Push | `push_subscriptions`, `push_tokens` (por pessoa; endpoint só https) | envio só via `push_destinatarios(club_id)`; o aparelho segue quem está logado | `push_registrar`, `push_token_registrar`, Edge Function `enviar-push` | `push.js`, `pushNativo.js` | 07, 21 |
| Motor curricular — Classes (piloto) | `curriculum_versions`/`classes`/`class_sections`/`class_requirements` (plataforma, sem `club_id`); `member_classes`/`member_requirements`/`requirement_approvals`/`investiture_reviews` (`club_id`) | catálogo publicado: qualquer autenticado lê; progresso: o dono (vínculo ativo no clube) ou `pode_gerir_no_clube(club_id)` avalia | `classes_disponiveis`, `classe_iniciar/atribuir`, `minha_classe`, `requisito_salvar/enviar/avaliar`, `classe_avaliacoes_pendentes`, `investidura_confirmar` | Minha Classe, Avaliar Classe (recurso opcional `classes`, desligado por padrão) | 31 (14), 32 (58) |
| Motor curricular — Especialidades (piloto) | `specialties`/`specialty_requirements` (plataforma); `specialty_offerings`/`member_specialties`/`member_specialty_requirements` (`club_id`); `curriculum_dependencies` (plataforma — dependência declarativa entre classe/especialidade) | catálogo publicado: qualquer autenticado lê; progresso: o dono, `pode_gerir_no_clube(club_id)` OU o instrutor responsável DA OFERTA avalia | `especialidades_disponiveis`, `especialidade_iniciar/atribuir`, `oferta_especialidade_criar`, `ofertas_especialidade_do_clube`, `minha_especialidade`, `especialidade_requisito_salvar/enviar/avaliar`, `especialidade_avaliacoes_pendentes`, `comparar_versoes_curriculares` | Minhas Especialidades, Especialidades — avaliar/turma (mesmo recurso `classes`) | 33 (25), 34 (46) |
| Motor de regras curriculares (fase 2.6) | `dynamic_content_definitions`/`dynamic_content_values`, `requirement_option_groups`/`requirement_options` (plataforma, sem `club_id`); **`curriculum_achievements`** (histórico curricular PORTÁTIL da pessoa — `usuario_id` + `club_id_origem` imutável); `prazo_minimo/maximo_dias` em `classes`/`specialties` | catálogos: qualquer autenticado lê, ninguém grava; conquista: a pessoa, a liderança do clube EMISSOR, a liderança de clube onde ela tem vínculo ativo; só o emissor revoga (soft) | `conteudo_dinamico_resolver`, `opcoes_satisfeitas_automaticamente`, `especialidade_ja_concluida_pela_pessoa`, `curriculum_achievement_revogar`, `prazo_situacao`, `explicar_requisito_classe/especialidade`; `dependencias_pendentes` agora portátil | (sem tela nova — RPCs prontas pra Minha Classe) | 35 (133), 34 (46), 20 |

## Exceções declaradas (tabelas sem `club_id`, com o motivo — teste 20)
`organizational_units` (raiz) · `organization_memberships` (o clube é `organizational_unit_id`) · `profiles` (clube pelo vínculo) ·
`push_subscriptions`/`push_tokens` (dispositivo da pessoa) · `migracoes_aplicadas` (ledger) · `biblia_livros`/`biblia_versiculos`
(conteúdo da Bíblia, igual para todos) · `recursos_catalogo` (catálogo de recursos da plataforma) · `curriculum_versions`/
`classes`/`class_sections`/`class_requirements`/`specialties`/`specialty_requirements`/`curriculum_dependencies` (currículo
oficial/versionado, classes E especialidades — plataforma; progresso é sempre por clube) · `dynamic_content_definitions`/
`dynamic_content_values`/`requirement_option_groups`/`requirement_options` (regras curriculares declarativas — plataforma,
fase 2.6) · **`curriculum_achievements`** (histórico curricular PORTÁTIL da PESSOA: `usuario_id` é o dono; `club_id_origem` é
proveniência imutável de quem emitiu, não escopo — fase 2.6).

## O que segue usando o clube legado — de propósito
Cadastro público (o app de cadastro ainda entra pelo Tenant 001) e sincronização de vínculo; o catálogo-modelo que clube novo
copia (jogos e conteúdo); `INSERT` manual no SQL Editor sem `club_id` em fotos/avisos/pontos (cai no Tenant 001, como sempre foi);
a policy que mostra as unidades ao cadastro anônimo.

## Motor curricular — fase 2.6 (migration 38): motor de regras curriculares

O manifesto da fase 2.5 marcou 4 lacunas de schema (`AUDITORIA-CURRICULO-OFICIAL.md` §10). Esta migration dá a cada uma
representação DECLARATIVA e VERSIONADA — sem coluna específica por regra (nada de `livro_2026`, `especialidade_nao_repetida`).
O validador do manifesto (`validar.mjs`, `REPRESENTACAO_DAS_LACUNAS`) agora REJEITA qualquer `lacuna_schema` sem mecanismo no
banco e imprime o mapa lacuna→mecanismo no relatório. As 6 Classes Regulares continuam NÃO importadas.

### As 4 lacunas → como ficaram no banco
- **Conteúdo anual/dinâmico** — `dynamic_content_definitions` (o "slot": `curso_leitura_do_ano`) + `dynamic_content_values`
  (valor + `vigente_desde`/`vigente_ate`; gatilho recusa períodos que se sobrepõem — `daterange &&` nativo) +
  `conteudo_dinamico_resolver(chave, data)` (determinístico: o valor vigente NA DATA, `null` quando nenhum período cobre — nunca
  adivinha). O requisito aponta pro slot (`class_requirements.conteudo_dinamico_definicao_id`, idem em
  `specialty_requirements`); 2026 e 2027 resolvem com UMA classe, UMA versão, UM requisito.
- **Escolha N-de-M** — `requirement_option_groups` (polimórfico `alvo_tipo`/`alvo_id`, mesmo idioma de
  `curriculum_dependencies`; `n_minimo`, extensível a 1-de-N, 2-de-N…; `sem_repeticao` declarado) + `requirement_options`
  (rótulo, opcionalmente `specialty_id`). `opcoes_satisfeitas_automaticamente(grupo, pessoa)` conta no servidor as opções
  ligadas a especialidade que a pessoa já tem (via o histórico portátil, abaixo); o front só apresenta. A conta INFORMA — a
  aprovação continua sendo da liderança (a explicação diz "regra satisfeita, requisito pendente").
- **Não repetir especialidade** — NÃO consulta `member_specialties` do clube atual. Primeiro nasceu o **histórico curricular
  PORTÁTIL** da pessoa: `curriculum_achievements` — uma linha por classe/especialidade concluída, presa à identidade global
  (`usuario_id`), com proveniência completa: `club_id_origem` (IMUTÁVEL, derivado pelo gatilho do registro operacional — nunca
  aceito do cliente), `classe_id`/`specialty_id` (a versão exata), `concluida_em`, `member_class_id`/`member_specialty_id` (o
  registro operacional, que por sua vez guarda em `requirement_approvals` quem avaliou cada requisito, quando e em qual clube).
  NÃO tem pontos, presença, ranking, mensalidade, mensagem nem arquivo — só o fato curricular (o teste 35 confere a lista de
  colunas). Emissão: gatilho em `member_classes` (→ `concluida`/`investida`) e `member_specialties` (→ `concluida`), por UPDATE
  ou por INSERT já concluído; índices parciais únicos (um por `tipo`, porque `classe_id`/`specialty_id` são mutuamente NULL e
  NULL nunca colide em UNIQUE) impedem duplicata ao reprocessar. **Revogação só pelo clube que emitiu**
  (`curriculum_achievement_revogar` confere `pode_gerir_no_clube(club_id_origem)` — o header de clube em uso NÃO é a
  autoridade), sempre SOFT (`status='revogada'`, `revogada_em/por/motivo`; INSERT/UPDATE/DELETE revogados de `authenticated`).
  Quem vê (RLS, `_pode_ver_conquista_curricular`): a própria pessoa; a liderança do EMISSOR (autoridade permanente, mesmo depois
  de a pessoa sair); a liderança de qualquer clube onde a pessoa tem vínculo ATIVO — é assim que "o novo clube consulta". A
  primitiva do "não repetir" é `especialidade_ja_concluida_pela_pessoa(pessoa, especialidade)`; ela existe e está testada, mas
  NÃO foi forçada dentro de `especialidade_iniciar` (mesma escolha das fases anteriores de não automatizar tudo sem tela e
  fonte pedindo — fica declarada em `requirement_option_groups.sem_repeticao` e disponível ao motor de explicação).
- **Prazo** — `prazo_minimo_dias`/`prazo_maximo_dias` em `classes` E `specialties` (colunas genéricas do próprio registro
  versionado, não uma coluna por regra) + `prazo_situacao(inicio, min, max)` (calculado no servidor a partir de `iniciada_em`).
  `avaliar_conclusao_classe`/`_especialidade` passaram a NÃO concluir enquanto o mínimo não foi atingido (todos aprovados,
  status continua `em_andamento`, nenhuma conquista emitida); o máximo excedido é só explicável — sem automação destrutiva.
  NULL nas classes/especialidades existentes (a fonte não determina prazo pras 6 Regulares) — só a capacidade existe.

### Mudança de comportamento INTENCIONAL em relação à migration 37
`dependencias_pendentes`/`dependencias_satisfeitas` deixaram de olhar `member_classes`/`member_specialties` do clube em uso e
passaram a consultar `curriculum_achievements` (ativas, de qualquer clube). A migration 37 tinha decidido "só no mesmo clube"
por não existir um mecanismo com proveniência — consultar o progresso operacional de outro clube seria a única exceção ao
isolamento. Agora existe: o que atravessa clubes é SÓ o fato curricular reconhecido, com quem emitiu e quando, revogável só
pelo emissor. O parâmetro `p_club_id` ficou na assinatura por compatibilidade (as RPCs já passam), mas não é mais usado. O
teste 34 (seção 7) foi atualizado e explica a evolução; o teste 35 prova que nada operacional do A aparece no B.

### Motor de explicação
`explicar_requisito_classe(member_requirement_id)` / `explicar_requisito_especialidade(member_specialty_requirement_id)` →
`jsonb { requisito: {tipo, id, status_operacional}, resultado: satisfeito | pendente | bloqueado, regras_aplicadas: [ {regra,
satisfeito, origem, detalhe} ] }`. Regras: `dependencia_curricular` (origem `curriculum_dependencies + curriculum_achievements`),
`conteudo_dinamico` (origem `dynamic_content_definitions + dynamic_content_values`, com o valor resolvido pra hoje),
`escolha_n_de_m` (origem `requirement_option_groups + requirement_options`, com `satisfeitas/n_minimo/total_opcoes`).
Mapeamento: `status='aprovado'` → `satisfeito`; senão dependência pendente ou conteúdo dinâmico sem valor pra hoje →
`bloqueado`; senão `pendente`. Exemplo real do teste (requisito dinâmico antes de cadastrar o valor do ano):
`{"resultado":"bloqueado","regras_aplicadas":[{"regra":"conteudo_dinamico","satisfeito":false,"origem":"dynamic_content_definitions + dynamic_content_values","detalhe":{"chave":"piloto_curso_leitura_do_ano","valor":null,...}}]}`.

### Testado
`35_motor_de_regras_curriculares.sql` (133 asserts, fixtures sintéticas `[PILOTO/TESTE]`): conteúdo 2025/2026/2027 numa classe
só (resolver por data, sobreposição recusada, bloqueado→pendente na explicação); 2-de-3 (0→1→2 contadas no servidor, 1-de-2
polimórfico em requisito de especialidade, por pessoa); especialidade concluída no A satisfazendo o req 3 da classe no B
(envio e aprovação em B funcionam; explicação `satisfeito` com origem no histórico portátil); RLS de quem vê (dono, emissor,
liderança com vínculo ativo — membro comum e anon não); B incapaz de revogar/alterar/apagar (RPC, UPDATE e DELETE); nem a
própria pessoa; emissor revoga com motivo, 2ª revogação recusada, linha preservada, `club_id_origem` intacto, registro
operacional intocado, outras conquistas intocadas; duas abas (progresso operacional por clube em `minha_classe()`, conquista
única, visível sem aba); vínculo com A removido → conquista continua, dependência em B continua satisfeita, emissor mantém a
autoridade (revoga) e aí a dependência volta a pendente sem desfazer o que B já avaliou; dado operacional do A invisível ao B
(pontos, `member_specialties`, evidências, `requirement_approvals`, `member_classes`, Storage, mensalidade) + a estrutura de
`curriculum_achievements` sem coluna operacional; prazo mínimo bloqueando (100% aprovado, `em_andamento`, sem conquista),
400 dias depois conclui com máximo excedido só informado; prazo em classe (5000 dias) bloqueando e liberando; investidura não
duplica a conquista; troca de versão (v2 da especialidade) sem mover a conquista da v1 + diff; forjar `club_id` (INSERT direto
por pessoa e por liderança, UPDATE da origem, header de clube sem vínculo, revogar "de outro clube") — tudo recusado, e
`club_id_origem` de toda conquista bate com o registro operacional. `34` atualizado (46) e `20` com 5 exceções novas (todas
plataforma/pessoa, com o motivo). Suíte: 36 testes SQL, upgrade simulado (114), e2e Storage (48) e contexto (42), edge bundle,
`curriculo:validar` (212 requisitos, nenhuma lacuna sem representação), `curriculo:autoteste` (16), Vitest (266), ESLint, build.

### Limites honestos desta fase (fora do escopo, de propósito)
Nenhuma tela nova (o motor de explicação é RPC, pronto pra "Minha Classe" consumir); `sem_repeticao` e
`especialidade_ja_concluida_pela_pessoa` não bloqueiam `especialidade_iniciar` automaticamente; `prazo_maximo` não cancela
nada; PDF/cartão, assinatura, Classes de Liderança e catálogo de Especialidades continuam fora; as 6 Classes Regulares NÃO
foram importadas — próxima etapa, só depois de aprovação.

## Motor curricular — fase 2 (migration 37): Especialidades, dependências e auditoria de compatibilidade

### Relatório de compatibilidade (o que foi auditado, antes de mexer em código)
Comparei a estrutura da fase 1 (currículo → classe → seção → requisito) contra as necessidades REAIS de
Classes Regulares, Classes Avançadas, Classes Agrupadas (quando aplicável) e Especialidades — sem fonte
oficial ainda cadastrada (etapa 1 do plano segue pendente, de propósito). Conclusão por item:

- **Classes Regulares**: o modelo da fase 1 já serve — é exatamente o que ele foi desenhado pra fazer.
  Nenhuma mudança estrutural necessária.
- **Especialidades**: o modelo de classe NÃO servia sem forçar. Especialidade não tem "seções" (a lista
  real é sempre plana, às vezes com subitens DENTRO da própria descrição do requisito) — usar
  `class_sections` como intermediário teria sido inventar estrutura que o currículo real não tem. Também
  precisa de **categoria** (Natureza, Artes e Habilidades...), às vezes um **nível** (regular/avançada) e
  frequentemente é feita **em grupo/turma** com um instrutor responsável específico — nada disso existia.
  **Decisão**: `specialties`/`specialty_requirements` NOVOS (sem camada de seção) + `specialty_offerings`
  (turma) + `member_specialties`/`member_specialty_requirements`, reusando `curriculum_versions` (mesma
  tabela de classes, não uma versão paralela) e `requirement_approvals` (auditoria única, ver abaixo).
- **Dependência entre currículo** (ex.: um requisito de classe exigir uma especialidade concluída; uma
  classe avançada exigir a regular): o modelo da fase 1 não tinha NENHUMA forma de representar isso —
  teria virado texto solto na descrição do requisito, exatamente o que foi pedido pra evitar. **Decisão**:
  `curriculum_dependencies`, declarativa e validada no servidor (`dependencias_pendentes`/`_satisfeitas`),
  no nível de classe/especialidade CONCLUÍDA (não de um requisito específico do outro lado — é o que o
  pedido descreve e evita um grafo arbitrariamente fino sem fonte oficial que justifique mais que isso).
  Serve tanto "requisito de classe depende de especialidade" quanto "classe avançada depende da regular"
  quanto "especialidade depende de outra especialidade" com a MESMA estrutura.
- **Classes Avançadas**: estruturalmente, o que se sabe SEM fonte oficial é que provavelmente exigem uma
  classe regular concluída antes — isso já está coberto pela dependência genérica acima (`class` depende
  de `class`). O que fica em aberto, HONESTAMENTE, por falta de fonte: se o processo de avaliação/revisão
  de uma classe avançada precisa de um nível de aprovação diferente (ex.: regional, não só o clube) — o
  modelo atual de `investiture_reviews` é só do clube. **Não inventei uma coluna "nível de investidura"
  sem fonte que confirme o vocabulário certo** — fica como pergunta em aberto pra quando a fonte entrar.
- **Classes Agrupadas** ("quando aplicável"): sem fonte oficial, não dá pra saber se "agrupada" significa
  (a) administrativo — uma turma estuda 2 classes ao mesmo tempo, cada criança com progresso PRÓPRIO em
  cada uma, ou (b) estrutural — um requisito conta pras duas classes ao mesmo tempo. O caso (a) **já
  funciona hoje, sem mudança nenhuma** (nada impede `member_classes` ter 2 linhas ativas, uma por classe,
  pra mesma pessoa no mesmo clube). O caso (b) exigiria uma tabela de equivalência de requisitos que eu
  **não vou inventar sem a fonte confirmar que é isso mesmo** — risco real de modelar errado e depois
  ter que migrar dado de progresso de gente de verdade.
- **Achado à parte, fora da lista de Classes/Especialidades**: auditando as RPCs da fase 1 pra decidir o
  que reusar, achei que o recurso `classes` (feature flag) só escondia a ROTA no front — nenhuma RPC
  conferia `recurso_habilitado_no_clube` (migration 34 fez isso para os outros 11 recursos; a 36 não
  tinha feito ainda para o motor curricular). Corrigido nesta migration (item abaixo) — quem chamar a
  API direto com o recurso desligado agora recebe erro, não só quem digita a URL.

### O que foi reusado (não duplicado) e por quê
- **`curriculum_versions`**: a MESMA tabela para classes e especialidades — cada linha é uma "edição
  publicada" (origem, identificador, versão, vigência, status, fonte), independente de ser currículo de
  classe ou de especialidade. Evita uma tabela de versão paralela.
- **`definir_escopo_progresso()`**: o gatilho que deriva `usuario_id`/`club_id` (nunca aceita do cliente)
  virou GENÉRICO (mesmo idioma de `definir_club_por_usuario`, migration 22: tabela/coluna pai por
  argumento do gatilho) — serve `member_requirements` E `member_specialty_requirements`, uma função só.
- **`requirement_approvals`**: virou POLIMÓRFICO (`member_requirement_id`+`requirement_id` OU
  `member_specialty_requirement_id`+`specialty_requirement_id`, nunca os dois — `check` garante isso) —
  auditoria (quem avaliou, quando, em qual clube, com qual papel, sobre qual versão) reusada em vez de
  duas tabelas gêmeas.
- **O que NÃO foi forçado a reusar**: o gatilho de conclusão automática (`avaliar_conclusao_classe` vs.
  `avaliar_conclusao_especialidade`) ficou em DUAS funções, de propósito — contar requisitos de uma
  classe passa por seção (`class_requirements → class_sections → classes`), contar de uma especialidade é
  direto (`specialty_requirements → specialties`); forçar uma função dinâmica única pras duas formas de
  contar reduziria a legibilidade/segurança por um ganho de DRY questionável. Também especialidade **não
  ganhou um equivalente a `investiture_reviews`** — uma especialidade concluída não passa por "revisão
  para investidura" como uma classe (é reconhecida/entregue, não investida); a entrega física (pin) fica
  fora do sistema por ora.

### Turma/oferta e o instrutor responsável não-liderança
`specialty_offerings` registra quem ensina (`instrutor_responsavel_id` — qualquer vínculo ATIVO no clube,
não precisa ser instrutor/diretoria: um conselheiro com um hobby específico pode ser responsável por uma
turma), o período e o status; `member_specialties.oferta_id` (opcional) liga o progresso individual à
turma sem deixar de ser individual. `_pode_avaliar_especialidade`/`_e_responsavel_da_oferta` estendem
quem avalia (liderança do clube OU o responsável DAQUELA oferta) — e a mesma checagem entrou na POLICY de
leitura de `member_specialties`/`member_specialty_requirements` (achado ao testar: sem isso, o
responsável não-liderança nem conseguia ENXERGAR a linha pra pegar o id e chamar a RPC — a subconsulta do
cliente roda sob RLS, antes de entrar na função `security definer`).

### Rastreabilidade de importação (preparação do catálogo oficial)
`curriculum_versions` ganhou `fonte_hash` (sha256 do arquivo fonte), `fonte_arquivo` (nome), `importado_em`
e `importado_por` — junto com `fonte_url`/`fonte_descricao` (já existiam), dá pra provar de onde veio um
material oficial e detectar se o arquivo fonte mudou por baixo. Processo (documentado também na própria
migration): nova versão sempre nasce `rascunho`, com a proveniência preenchida; só vira `publicado` depois
de revisão humana comparando com a versão anterior (ferramenta abaixo); **nunca edita uma versão já
publicada** — sempre uma linha nova, preservando o histórico de quem já iniciou/concluiu a antiga.

### Ferramenta de comparação de versões
`comparar_versoes_curriculares(versao_a, versao_b)` — compara os requisitos (de classe OU especialidade)
de duas `curriculum_versions` pelo código de negócio (não pelo `id`, que sempre muda entre versões) e
devolve `adicionados`/`removidos`/`alterados` (descrição, tipo de evidência, obrigatoriedade). Pensada pra
rodar ANTES de publicar uma versão nova, revisando o que realmente mudou. Testada com um diff real (v1→v2
de teste: 1 requisito novo, 1 removido, 1 com descrição alterada, 1 idêntico) — os 3 números batem exatos.

### Especialidade PILOTO — dados de TESTE
`[PILOTO/TESTE] Primeiros Socorros`, 3 requisitos (texto/nenhuma/foto), `origem='piloto_teste'`, mesmo
aviso explícito de "não é o regulamento oficial" da classe piloto. Um requisito NOVO na classe piloto
(`conhecimentos/3`) depende dela — prova a dependência ponta a ponta com dado de teste, sem inventar
requisito oficial nenhum.

### Testado
`33_especialidades_estrutura.sql` (25 asserts — estrutural: tabelas, RLS, reuso de verdade do gatilho de
escopo e de `requirement_approvals`/`curriculum_versions`, rastreabilidade de importação, dependências
validadas, as RPCs com o grant certo, o gate de recurso citado nas 12 RPCs de escrita, a ferramenta de
diff, a especialidade piloto marcada como teste) e `34_especialidades_multiclube_isolado.sql` (45 asserts
— cenário completo: a MESMA pessoa (`multi_dois_papeis`) faz a MESMA especialidade nos clubes A e B com
evidências independentes; `instrutor_2clubes` avalia corretamente em cada clube e é bloqueado na aprovação
CRUZADA mesmo tendo permissão de gerir no clube errado; turma com `conselheiro_a` como responsável NÃO-
liderança avaliando só a própria turma; requisito de classe dependente de especialidade — nesta fase só liberava no
MESMO clube (**revisto na fase 2.6, acima**: hoje a conclusão reconhecida em A satisfaz a regra em B via o histórico
curricular portátil, e a seção 7 do teste 34 prova o comportamento novo); conclusão automática; histórico via
`minha_especialidade()`; mudança de versão sem alterar histórico + o diff real; recurso `classes`
desligado NUM clube só bloqueia lá, não no outro). Verificado também manualmente no navegador (login real,
iniciar a especialidade piloto, enviar um requisito, aprovar pela fila da liderança, percentual
atualizado 33%).

### Limites honestos desta fase (fora do escopo, de propósito)
PDF/cartão final, assinatura digital, catálogo completo de especialidades (a importação real só depois de
validar a fonte oficial — etapa 1 do plano). Frontend: a tela de avaliação (`/avaliar-especialidades`)
continua restrita a diretoria/instrutor — um instrutor responsável de turma que NÃO seja liderança (ex.:
`conselheiro_a` do teste) tem a RPC funcionando (provado no SQL) mas ainda não tem uma tela própria pra
chegar até ela; fica para quando a gestão de turma ganhar uma tela completa. Gestão de turma em si
(criar oferta) está na tela, mas atribuir participantes em lote e editar/encerrar uma turma existente
ainda não têm UI (a RPC `especialidade_atribuir` existe e funciona, só falta o botão).

## Motor curricular versionado — Classes/Especialidades, fase 1 (migration 36)
Primeira peça da próxima fase do produto (Classes e Especialidades), construída DEPOIS da limpeza final (migration 35) — o
motor, não o currículo oficial. Pipeline: currículo oficial/versionado → classe → seção → requisito → progresso do membro →
evidência → avaliação/aprovação → conclusão → revisão para investidura.
- **Catálogo curricular é conteúdo da PLATAFORMA** (`curriculum_versions` → `classes` → `class_sections` → `class_requirements`,
  sem `club_id` — mesmo padrão de `desafios`/`versiculos`/`recursos_catalogo`): só o currículo com `status = 'publicado'` é
  visível pela API; ninguém grava pela API (só migration/SQL direto, sem tela de autoria nesta fase). `curriculum_versions`
  registra `origem` (`oficial` | `piloto_teste`), `identificador`/`versao`, `vigente_desde/ate`, `status` e a fonte
  (`fonte_url`/`fonte_descricao`). **Mudar o currículo nunca edita uma versão publicada** — cria uma versão nova (com
  classes/seções/requisitos NOVOS, `id`s novos); o histórico de quem já iniciou ou concluiu a versão antiga (`member_classes`/
  `member_requirements`, que guardam o `class_id`/`requirement_id` da versão em que a pessoa realmente andou) nunca é reescrito
  por baixo. Provado no teste 32 (seção 11): uma "v2" da classe piloto nasce com o MESMO código e versão diferente, e quem já
  estava na v1 continua vendo a v1, ponta a ponta (`minha_classe()` incluído).
- **Progresso operacional é SEMPRE por clube** (`member_classes`/`member_requirements`/`requirement_approvals`/
  `investiture_reviews`, todas com `club_id not null → organizational_units`), nunca global: `organization_memberships` é a
  ÚNICA fonte de papel/vínculo de quem avalia (`pode_gerir_no_clube`/`papel_no_clube`) — o contrato geral já travado no teste
  29 cobre automaticamente as RPCs novas (nenhuma lê `profiles.papel/.status/.unidade_id`), sem precisar duplicar a checagem
  aqui; o teste 31 confere as peças específicas desta fase (tabelas, grants, gatilhos, RPCs).
- **`member_requirements.usuario_id`/`.club_id` são DERIVADOS de `member_class_id` por gatilho** (`definir_escopo_member_
  requirement`), nunca aceitos do cliente — mesmo padrão de "explícito só se validado" das migrations 34/35.
- **A guarda crítica de aprovação cruzada** (`requisito_avaliar`): exige `pode_gerir_no_clube(clube EM USO de quem chama)` E
  que o `member_requirement_id` alvo pertença a ESSE MESMO `club_id` — um avaliador do clube A, mesmo sendo a mesma pessoa
  desbravador/instrutor no clube B, só aprova progresso do clube em que está OPERANDO e cujo requisito é DESSE clube; tentar
  aprovar um requisito de outro clube responde "não encontrado" (sem oráculo), mesmo quando o avaliador TEM permissão de gerir
  no clube em que está — provado isolando as duas causas de recusa (falta de papel vs. clube errado) com pessoas diferentes.
- **Percentual é SEMPRE calculado no servidor** (`classe_percentual`, dentro de `minha_classe()`): `member_classes` não tem
  coluna de percentual nenhuma — não existe onde o cliente possa "mandar 100% concluído" por engano ou má-fé.
- **Conclusão e investidura fecham o pipeline sozinhas**: um gatilho (`avaliar_conclusao_classe`) marca `member_classes` como
  `concluida` e abre `investiture_reviews` (`pendente`) assim que TODOS os requisitos ativos da classe viram `aprovado` — sem
  passo manual de "solicitar revisão". `investidura_confirmar` (liderança, mesma guarda de clube) fecha com `investido`/
  `recusado`. Sem PDF/cartão final, assinatura digital nem tela própria de investidura nesta fase — só a estrutura e o
  registro (quem revisou, quando, comentário), provando o pipeline inteiro ponta a ponta.
- **Evidência de menor usa o mesmo hardening de sempre**: reaproveita o bucket privado `comprovacoes` (pasta `<uid>/
  requisitos/...`, mesma policy `lideranca_gere_pasta`/`pode_gerir()` já usada por missões/atividades — nenhuma policy nova
  de Storage precisou nascer) — signed URL só para o dono ou a liderança do clube em uso, nunca URL pública.
- **Tipos de requisito/evidência são EXTENSÍVEIS de propósito** (`tipo_evidencia`: `nenhuma`/`texto`/`foto`/`arquivo`/
  `presenca`/`atividade`/`biblia`/`evento`/`especialidade`/`externo`) — hoje só `texto` e `foto` têm envio real na tela; os
  demais ficam DECLARADOS, prontos para um módulo futuro preencher/aprovar sozinho (ex.: presença batida em apontamentos
  aprovando o requisito automaticamente) — essa automação **não está implementada** nesta fase, de propósito.
- **Classe PILOTO, dados de TESTE claramente identificados** (nunca "oficial"): `origem = 'piloto_teste'`, nome/requisitos
  prefixados `[PILOTO/TESTE]`/`[DADO DE TESTE]`, `fonte_descricao` avisando explicitamente que não é o regulamento oficial de
  nenhuma classe de Desbravadores. 1 classe, 3 seções, 6 requisitos (3 com evidência obrigatória, 3 sem) — só para provar o
  motor; **nenhum requisito oficial foi inventado**. Precisa ser substituída pela fonte oficial (uma versão nova, `origem =
  'oficial'`) antes de qualquer uso real com membros. Recurso do catálogo `classes` nasce **desligado por padrão** (mesmo
  padrão do leilão) — só quem habilitar por clube (`club_features`) vê a aba.
- **Testado** (`31_motor_curricular_estrutura.sql`, 14 asserts — estrutural: catálogo sem `club_id`/API só lê, progresso
  sempre com `club_id`/RLS/só RPC escreve, as 9 RPCs existem com o grant certo, os 2 gatilhos existem, o piloto continua
  marcado como teste) e `32_classes_multiclube_isolado.sql` (56 asserts — o cenário completo pedido: Tenant 001/Tenant 002
  compartilhando o catálogo; `membro_a`/`membro_b` com evidências e progresso independentes; `dir_a_membro_b` — diretoria no A,
  desbravador no B — aprovando no A e sendo recusado por FALTA DE PAPEL no B; `instrutor_2clubes` — instrutor nos dois —
  aprovando de verdade em cada clube e sendo recusado por CLUBE ERRADO ao mirar um requisito do outro clube mesmo tendo
  permissão onde está; auditoria com clube/avaliador/papel corretos; percentual 33%/17% independentes; conclusão automática +
  investidura só onde terminou; mudança de versão sem alterar o histórico de quem já andou na v1) + smoke test manual no
  navegador (login real, iniciar a classe, enviar um requisito, aprovar pela fila da liderança, percentual atualizado — ver
  relatório da fase).
- Limite honesto, consciente e fora do escopo desta fase 1: só o motor e 1 classe piloto — catálogo completo de classes e
  especialidades, PDF/cartão de investidura, assinatura digital e as automações de evidência (presença/atividade/bíblia/
  evento) ficam para as próximas fases.

## Limpeza final da fase multi-clube (migration 35) — jogos, chefão, leilão e ranking sem profiles.papel
Continuação da migration 34: aquela fechou AUTORIZAÇÃO (quem pode gerir, aprovar, editar); esta fecha o resto — o motor de
jogos/prêmios, chefão, leilão e ranking (o "limite honesto" que a migration 34 tinha deixado documentado). Reauditoria pega o
texto LIVE de cada função no banco (`pg_get_functiondef`), não grep em arquivo — considera toda redefinição de migration anterior.
- **11 + 14 funções corrigidas** (duas rodadas — ver "armadilha do \b" abaixo): `_chefao_premiar_clube`, `chefao_estado`,
  `chefao_golpe`, `_lembrar_ausentes_clube`, `_lembrar_jogos_do_dia_clube`, `_premiar_campeao_semana_clube`,
  `_premiar_melhores_do_dia_clube`, `_premiar_rodada_semana_clube`, `dar_lance`, `progresso_lado`, `ranking_trilha`,
  `_pontos_temporada_unidade_interno`, `atividade_jogos`, `notif_aniversariantes_hoje`, `recordes_semana` e as RPCs que gravam
  pontos/jogos (`registrar_jogo`, `avaliar_missao`, `biblia_confirmar_leitura`, `bichinho_cuidar`, `bonus_todos_jogos`,
  `registrar_devocional`, `registrar_missao`, `resolver_ajuda`, `registrar_recorde`, `bichinho_adotar`, `biblia_iniciar_leitura`,
  `iniciar_jogo`) — todas trocam `profiles.papel/.status/.unidade_id` por `organization_memberships` (papel/status/unidade do
  VÍNCULO no clube certo), mantendo `profiles` só pra identidade (`nome`, `foto`, `teste`).
- **Achado maior, além do papel**: `pontos.club_id` (e o de mais 9 tabelas de gameplay — `trilha_jogos`, `recordes`, `partidas`,
  `chefao_golpes`, `bichinhos`, `biblia_leituras`, `biblia_leitura_atual`, `missoes_feitas`, `devocional`) era sempre INFERIDO por
  `clube_vinculo_do_usuario(pessoa)` — "o" clube dela, nunca o clube da REQUISIÇÃO. Jogar/pontuar operando no clube B podia gravar
  o dado no clube A (o clube "mais relevante" da pessoa). Corrigido nos dois gatilhos genéricos (`definir_club_ponto`,
  `definir_club_por_usuario`): quem grava já sabendo o clube (toda RPC client-facing já resolve `clube_atual_id()` pra outras
  checagens) passa `club_id` explícito; o gatilho CONFERE o vínculo (nunca confia cego) em vez de adivinhar. Sem `club_id`
  explícito, o comportamento de sempre (inferir) continua — nada quebra pra quem ainda não foi migrado.
- **Dois bugs de isolamento a mais, achados testando o cenário pedido** (pessoa membro no A e instrutor no B): a chave única de
  `recordes` (`usuario_id, jogo, semana`) não tinha `club_id` — o recorde da semana no B sobrescrevia o do A; e o anti-flood "1
  golpe de chefão por hora" e o "bônus do dia" (jogos) contavam por PESSOA, não por clube — golpear/completar no B "gastava" o
  cooldown/bônus do A. Os três corrigidos (chave composta com `club_id`; os dois limites agora são por `usuario_id + club_id`).
- **Armadilha desta migration, documentada pra não se repetir**: a 1ª auditoria usava `\b` (limite de palavra) — no dialeto de
  regex do Postgres (ARE), `\b` é BACKSPACE literal, não limite de palavra (o certo é `\y`). Um padrão como `'\bp\.papel\b'`
  NUNCA bate com nada (falso negativo silencioso — foi assim que `chefao_golpe` e mais 3 funções escaparam da 1ª rodada). E um
  padrão largo tipo `'profiles[^,;()]*\.status'` sem rastrear o APELIDO de verdade pode casar por cima de um `JOIN` inteiro (ex.:
  "profiles pr on pr.id=... where **m.status**" via um gap grande sem vírgula/parêntese no meio — falso positivo). O teste de
  contrato (`29_sem_profiles_papel_operacional.sql`) usa `\y` e rastreia o apelido real de `profiles` antes de checar
  `<apelido>.papel/.status/.unidade_id`.
- **Teste de contrato** (`29`, 12 asserts): nenhuma função/view/policy do banco lê `profiles.papel/.status/.unidade_id` fora do
  mecanismo do próprio espelho (`reconciliar_perfis_dos_vinculos`, declarado como exceção); as 9 tabelas de gameplay têm o
  gatilho corrigido; a coluna continua travada por GRANT. Falha se código novo voltar a depender desses campos.
- **Cenário explícito testado** (`30_jogos_premios_multiclube_isolados.sql`, 29 asserts): a MESMA pessoa é desbravador (unidade
  A1) no clube A e instrutor (unidade B1) no clube B, com `reflexo_so_desbravador` ligado nos dois — joga jogos diferentes,
  golpeia os dois chefões, bate recorde nos dois. Confere: cada jogo/ponto/recorde/golpe cai no `club_id` certo (nunca no outro);
  o ranking e o placar "por unidade" de cada clube não citam nada do outro; o recorde de reflexo do B nem é gravado (lá ela é
  instrutor, a mesma regra de sempre) enquanto o do A conta; o prêmio semanal de recorde paga no A mas não no B (papel do
  VÍNCULO, não um só papel global); golpear no B não consome o cooldown do A nem altera o dano calculado do A.
- Limite que fica, honesto: leitura de dados de TABELA (não RPC) pra quem tem vínculo genuíno em 2+ clubes continua sem escopo
  por "clube em uso" (ver limite (2) da migration 34, inalterado) — não é vazamento, é visibilidade legítima.

## Multi-clube real (migration 34) — 1 clube por pessoa sai, entitlements entram
Continuação direta da camada de produto (migration 33): agora o suporte a múltiplos clubes por pessoa é de VERDADE (não só o
formato), a seleção de clube é explícita e validada por requisição, e os 11 recursos que só escondiam rota passam a bloquear
escrita também. Checkpoint anterior intocado; nada disto foi ao Supabase remoto.
- **Fim do "1 clube por pessoa"**: `trg_um_clube_por_pessoa` saiu. `organization_memberships` ganhou `unidade_id` (valida contra o
  clube do próprio vínculo) e virou a fonte de verdade de papel/unidade/status — `profiles.papel/status/unidade_id` são só um
  ESPELHO do clube PRIMÁRIO (o vínculo mais antigo) e **não são mais graváveis direto** por ninguém, nem a liderança (coluna
  revogada; só a RPC `vinculo_gerir`, escopada ao clube em uso de quem chama, escreve). `handle_new_user` cria perfil e vínculo
  juntos; um espelho (gatilho `AFTER` em `organization_memberships`) mantém profiles em dia sempre que o vínculo PRIMÁRIO muda.
- **Seleção explícita de clube, por REQUISIÇÃO, sempre validada**: `clube_atual_id()` lê um header (`x-clube-atual`, exposto pelo
  PostgREST via a GUC `request.headers`) que o cliente manda dizendo em qual clube quer operar — mas só HONRA se corresponder a
  um vínculo ATIVO e vigente de quem chama; um clube forjado (sem vínculo, ou vínculo suspenso/inexistente) cai, em silêncio, no
  padrão de sempre (o vínculo mais antigo). Não há estado de "clube atual da sessão" no servidor — por isso duas abas do MESMO
  usuário podem operar em clubes diferentes ao mesmo tempo sem se atropelar (o front guarda o clube da aba em memória do módulo,
  nunca em localStorage/sessionStorage compartilhado, e manda no header de toda chamada — `lib/supabase.js`).
- **Autoridade de liderança é sempre do clube EM USO de quem chama, nunca do clube "mais relevante" do alvo**: `lideranca_gere_usuario`,
  `diretoria_gere_usuario`, `resetar_senha_membro` e `excluir_usuario` foram corrigidas (achado desta fase) — antes, usavam
  `clube_vinculo_do_usuario(alvo)`, então um diretor do clube A que TAMBÉM fosse membro comum do clube B podia, sem querer,
  usar a autoridade de A para mexer em gente do B, se a "prioridade" do alvo caísse para B. Agora é sempre `clube_atual_id()` de
  quem chama, e o alvo precisa ter vínculo NESSE MESMO clube. `excluir_usuario` também mudou: se a pessoa tem vínculo em OUTRO
  clube além do clube em uso, só o vínculo DESSE clube é apagado (identidade global e o outro clube nunca são tocados por uma
  decisão de um único clube).
- **Feature flags viram autorização de verdade**: um gatilho central (`exigir_recurso_habilitado`, reaproveitado — mesmo padrão do
  leilão) cobre as 17 tabelas dos 11 recursos que só tinham gate de visibilidade (atividades/entregas, eventos, chat, jogos,
  chefão, duelos/desafios_unidade, missões/devocional, mural, mensalidades, bíblia, bichinho); desligar o recurso bloqueia a
  ESCRITA nova nessas tabelas (`raise exception`), mas nunca a leitura nem a edição do que já existe (a liderança segue
  aprovando/pagando/editando pendências antigas com o recurso desligado — só não nasce coisa nova). `desafios` (o único recurso
  do catálogo sem tabela própria) usa `duelos`/`desafios_unidade`. O leilão manteve seu gate específico (migration 15/23), mais
  antigo e mais estrito (bloqueia direto no leilão aberto).
- **`meus_filhos()`** passou a usar `clube_atual_id()` (antes: `clube_do_usuario(auth.uid())`, sem seleção possível) — um
  responsável com vínculo em 2 clubes agora troca entre "meus filhos daqui" e "meus filhos de lá" do mesmo jeito que qualquer
  outra tela troca de clube.
- **Limites desta fase, já resolvidos na "limpeza final" (migration 35, abaixo)**: (1) o motor de jogos/prêmios e a config por
  clube liam o ESPELHO em profiles — resolvido; (2) leitura de dados de TABELA (não RPC) para quem tem vínculo ativo GENUÍNO em
  2+ clubes não é escopada por "clube em uso" — continua assim de propósito (`membro_ativo_no_clube(club_id)` olha o `club_id` da
  LINHA, não `clube_atual_id()`): não é vazamento, é visibilidade legítima de quem pertence aos dois clubes; só RPCs/telas
  operacionais (ranking, gestão, `meus_filhos`...) respeitam o clube em uso. (3) PWA/manifest/ícones/APK/título inicial do HTML
  seguem os do Tenant 001 — branding dinâmico continua sendo só DEPOIS de autenticar (sem mudança nesta fase).
- Testado: SQL `27_multiclube_real.sql` (48 asserts — 1 clube, 2 clubes com papéis diferentes, diretor num e membro noutro,
  instrutor com unidades diferentes por clube, responsável com filhos em 2 clubes, vínculo suspenso só num, troca de clube,
  "duas abas", forjar `club_id`, remoção de vínculo com a sessão aberta) + `28_entitlements_recursos.sql` (23 asserts, estrutural
  + 4 recursos ponta a ponta) + Vitest (`Clube.test.jsx`, `usuarios.test.js`) + e2e real contra o PostgREST local (42 asserts,
  a unidade por vínculo incluída).

## Camada de produto multi-clube (migration 33 + front) — o que o app passa a saber por SESSÃO
O app deixa de assumir "um clube, papel e unidade globais": `meu_contexto()` devolve, numa chamada, os vínculos DA PRÓPRIA pessoa (clube, papel NO clube, status, unidade NO clube,
marca e recursos efetivos) e o clube em que o SERVIDOR age. O `ClubeContext` do front resolve o clube em uso e expõe papel, permissões, recursos e marca; toda tela pergunta a ele.
- **Sem suposição global**: nenhuma tela lê `profile.papel`/`profile.unidade_id` (27 telas migradas; o teste de contrato do Vitest reprova a volta). O papel só vale com vínculo ATIVO
  (pendente, suspenso, erro de rede ou sem vínculo = nenhuma permissão: falha fechada) e o `ClubeGuard` só deixa entrar quem tem vínculo ativo com um clube em uso.
- **Marca por clube** (`metadata->'marca'`): nome, sigla, lema, descrição, ano, cores e logo. O que o clube não define é DERIVADO do nome (nunca "Filhos da Conquista" em outro clube).
  O Tenant 001 recebe do banco a marca de sempre (nome, FC, "Desbravadores · 1994", 1994, logo do app) — sem cor própria, o tema fica idêntico. Só a liderança do clube grava, com
  validação (cor #rrggbb; sem `<`/`>`; a logo só do bucket `publico` na pasta DO CLUBE — o app nunca carrega imagem de terceiro) e a tela avisa cor clara demais (texto branco ilegível).
- **Recursos (feature flags)**: `recursos_catalogo` (12 recursos; só o leilão nasce desligado) + escolha do clube em `club_features` (que passou a aceitar QUALQUER recurso do catálogo, por FK).
  O menu, a barra de baixo, a Gestão e as rotas obedecem (mesma matriz `RECURSO_POR_ROTA`). `recurso_habilitado_no_clube` usa o padrão do catálogo, então o gate de dados do leilão
  segue igual. Desligar o leilão com leilão aberto é recusado.
- **Limites desta fase, já resolvidos na fase seguinte ("Multi-clube real" acima)**: as flags eram só de VISIBILIDADE (agora bloqueiam
  escrita) e o banco só aceitava 1 clube por pessoa (agora aceita N, com seleção explícita por requisição). Ainda valem: (1)
  manifest do PWA, ícones, APK e título inicial do HTML seguem os do Tenant 001 (build white-label é outra fase); (2) antes de
  entrar, o login mostra a última marca vista no aparelho (ou a padrão) — o cadastro público segue pelo Tenant 001.
- Front publicado ANTES do SQL 33 funciona (modo legado: papel/unidade do perfil, marca legada, recursos como sempre); a tela de identidade avisa que falta o SQL.

## Hardening final (migrations 29–32) — congelamento da base
Pedido: remover a exposição do bucket público `imagens` e — quando seguro — tratar texto de mensagem moderada, oráculos de UUID e as dependências da Edge Function. Tudo com teste vermelho antes.
- **Texto de mensagem moderada** (migration 29; teste 23, 43 asserts + upgrade): qualquer membro do chat lia o `texto` da mensagem "removida pela liderança" direto pela tabela
  (a view escondia, a RLS da tabela não). Agora o original vai para `chat_mensagens_apagadas` (RLS: liderança do clube da mensagem; ninguém grava direto; FK composta
  mensagem+clube; fora do Realtime) e a linha guarda só `(mensagem apagada)`. Mensagens já apagadas em produção são migradas (backfill idempotente). Apagar é idempotente.
- **Oráculos de UUID** (migration 30; teste 24, 44 asserts): para quem vem de sessão de cliente, "UUID de outro clube" e "UUID inexistente" agora dão a MESMA resposta
  (42501, texto da RLS) em `pontos` (pessoa/unidade), `entregas` (atividade), `mensalidades` (pessoa) e `notificacoes` (destinatário); `entregas.avaliado_por` e
  `mensalidades.registrado_por` só aceitam quem faz a operação (antes aceitavam perfil de QUALQUER clube). O teste compara os dois casos, nos dois sentidos, e ainda varre
  AUTOMATICAMENTE toda função pública com 1 argumento uuid (~8 mil chamadas comparadas): nenhuma RPC distinguia. Dono do banco/cron/service_role mantêm a mensagem específica.
- **Bucket `imagens` privado** (migrations 31 e 32; teste 25, 62 asserts; e2e real 48): ver a linha Storage. A 31 (policies por clube + bucket `publico`) é segura em qualquer
  janela; a **32 é a virada** (`public = false`) e é um passo SEPARADO porque front/APK antigos mostram a imagem pela URL pública. O e2e com o Storage real achou o que o SQL não achava:
  o Storage atual grava o dono em `owner_id` e deixa `owner` NULO, então toda policy `owner = auth.uid()` (inclusive as de apagar/atualizar da migration 16) recusava o upload
  `upsert` de avatar/mural — as policies agora usam `dono_do_objeto(owner, owner_id)` (entende os dois formatos; os objetos antigos do Tenant 001 seguem com dono).
- **Edge Function** (`enviar-push`): `npm:@supabase/supabase-js@2.108.2` (a mesma do package-lock do app) e `npm:web-push@3.6.7`, versões EXATAS (era `esm.sh/...@2`). Travado por
  teste (Vitest) e provado no edge-runtime real (`npm run test:edge:bundle`); um pin inexistente faz o bundle falhar.

## Achados desta rodada (todos ganharam teste vermelho antes da correção)
- `chefao_config` gerado sem a coluna `club_id` no insert (migration 20) — achado pelo teste 17.
- View `chat_mensagens_visiveis` escondia o texto da mensagem apagada da moderação de outro clube — teste 19 (migration 26).
- Painel **Conteúdo** (Gestão) edita `desafios`/`versiculos` por nome de tabela dinâmico e tinha perdido a escrita da liderança
  (migration 22) — achado na varredura do front; catálogos viraram do clube (migration 27; teste 15).
- Regressões de desempenho e de "excluir usuário" da revisão anterior (migration 19; teste 12).
- **Revisões independentes da rodada 2** (red-team + regressão do Tenant 001; nenhuma leitura/escrita cruzada direta foi achada):
  um diretor de qualquer clube travava o cron de leilão de **todos** (ponto gigante estourava o int + laço sem isolamento por leilão);
  bucket `imagens` aceitava qualquer arquivo; aparelho de push ficava ligado ao usuário anterior; endpoint de push aceitava `http://`;
  `TRUNCATE` liberado ao usuário; cargo do instrutor revertido em silêncio; pré-voo sem 2 colunas; front-antes-do-SQL escondia o Leilão;
  chat sem limite mostrava as mensagens mais antigas; SQL solto de missões de foto quebrava depois da migration 27.
  Achados de BANCO: teste vermelho antes (21 e 22) e correção na migration 28. Achados de FRONT (Leilão antes do SQL, chat, push, tela de
  Usuários): correção + testes unitários novos (Vitest). E um bug meu pego no caminho: `LEAST(sum(...), teto)` devolvia o teto
  quando a soma era NULL (corrigido com `coalesce`, com asserts de "quem não tem ponto vê 0").

## Riscos residuais conhecidos
- (**resolvido** na migration 29) texto de mensagem apagada; (**resolvido** na 30) oráculos de UUID em pontos/entregas/mensalidades/notificações e `avaliado_por`/`registrado_por`.
  Resta o que o teste 24 NÃO alcança por desenho: RPCs com 2+ argumentos uuid são cobertas só nos casos escritos à mão (duelo, lance, vínculo); e `unidades.conselheiro_id`
  não tem FK nem uso em policy/função (aceita qualquer uuid, sem efeito de segurança hoje).
- Cadastro público aceita `unidade_id` de qualquer clube (o UUID não é listável fora do clube legado); `anon` lê as unidades do
  clube legado (id, nome, cor, conselheiro_id) porque o cadastro precisa.
- `profiles.teste` é editável pelo próprio usuário (só o exime de pontuar).
- (**resolvido** na migration 34) flags de recurso escondiam a tela mas não bloqueavam a API. Agora um gatilho central bloqueia
  a ESCRITA nova nas 17 tabelas dos 11 recursos (leitura e edição do que já existe continuam liberadas).
- (**resolvido** na migration 34) papel/unidade/status são do VÍNCULO (`organization_memberships`), não de `profiles` — a coluna
  não é mais gravável direto por ninguém. `profiles.papel/status/unidade_id` seguem existindo só como espelho do clube PRIMÁRIO,
  para o motor de jogos/config que ainda não foi migrado pra ler o vínculo direto (risco de DADO, não de segurança — ver "Multi-clube real").
- (**resolvido** na migration 34) 1 clube por pessoa: o banco agora aceita N vínculos, com seleção explícita e validada por
  requisição (não confia em `club_id` do cliente).
- (**resolvido** nas migrations 31+32) bucket `imagens` público. **Enquanto a 32 não for aplicada, `imagens` segue público por URL** (é de propósito — ver o rollout). Depois dela:
  a URL assinada vale **24 h** e o front a guarda (memória + localStorage, por usuário, apagada ao sair) para o cache HTTP funcionar; alguém com acesso ao aparelho desbloqueado
  poderia ler as URLs guardadas nesse período. **APK e front antigos em cache** perdem avatar/mural/emblema depois da 32 (o APK embute o front e não se atualiza sozinho).
  Avatar de quem já saiu do clube deixa de aparecer aos colegas (a policy exige os dois ativos no mesmo clube).
- Front/APK **antigos em cache** não conhecem `config_gravar`: gravar PIX/popup/rodízio por eles falha até atualizar (leitura e o resto
  seguem). Por isso o front novo deve ir **antes** do SQL (ele cai no upsert antigo se a RPC ainda não existe).
- Sessões abertas não são derrubadas ao resetar senha/excluir usuário (o token expira sozinho).
- (**resolvido**) versões da Edge Function fixadas. Deno não roda no vitest: o contrato é lido do código e o bundle é provado em `npm run test:edge:bundle`.
- Jogo NOVO no catálogo: os SQLs futuros devem usar `catalogo_jogo_definir(...)`, não `insert into jogos_trilha` (o clube é NOT NULL).

## Como manter
- Migration nova com tabela nova ⇒ o teste 20 pede `club_id` ou uma exceção justificada.
- Recurso novo do app: entra no catálogo (`recursos_catalogo`), em `RECURSOS_PADRAO` (o Vitest confere os dois) e em `RECURSO_POR_ROTA`; a rota precisa do guarda (o contrato do Vitest confere).
- Policy nova em `storage.objects`: use `dono_do_objeto(owner, owner_id)` — `owner` sozinho vem NULO nos uploads de hoje. Rode `npm run test:storage:e2e`.
- `npm run test:db` (replay do zero), `npm run test:db:upgrade` (schema legado + dados vivos → todas as migrations),
  `npm run test:db:real` (**`supabase db reset` de verdade** + suíte no banco resultante; CLI 2.117.0 via `npx`).
