# Atualizar matrícula de Classe para a versão vigente — auditoria de arquitetura

Base: `f59aa51` + migration `20260930000522` (esta entrega). Banco local lido em modo somente leitura (migração 519).
Escopo da regra do dono: sem trocar `curriculum_version_id` em massa, sem recriar matrícula, sem apagar requisito antigo, sem recalcular história, sem falsificar aprovação.

## 1. Parecer

**A arquitetura atual NÃO permite atualizar uma matrícula em andamento preservando histórico e proveniência.**
Faltam peças estruturais (não é só tela): (a) onde guardar "cumprido na versão anterior" sem criar `requirement_approvals`
falso; (b) vínculo entre matrícula antiga e nova; (c) estado terminal da matrícula antiga; (d) mapa explícito de equivalência
(agora existe, vazio); (e) todas as leituras de progresso/documento mostrarem a proveniência.
**PARADA CONSCIENTE**: a *ação* de atualizar não foi implementada. Entregue só o seguro e aditivo: mapa explícito (vazio) + prévia de leitura.

## 2. Como as peças se relacionam hoje (evidências)

| Objeto | Fato verificado |
|---|---|
| `curriculum_versions` | única por `(identificador, versao)`. Local: `classes-regulares-dsa` 2026.1–2026.3 `arquivado`, 2026.4 `publicado` (6 regulares + 6 avançadas). Importar versão nova arquiva a publicada anterior (migrations 42/120). |
| `classes` / `class_sections` / `class_requirements` | **cada versão cria linhas novas com `gen_random_uuid()`** (ids diferentes). Única ligação entre versões = `manifesto_id` (texto, p.ex. `amigo.I.4`) e `codigo` da classe. `codigo` do requisito é por seção e muda em renumeração (ex.: item excluído com renumeração em Pesquisador de Campo e Bosque). |
| Unicidade do `manifesto_id` | só `classes` tem índice único `(curriculum_version_id, manifesto_id)`. Em `class_requirements` é índice **não único**; a unicidade por versão vem do validador/gerador, não do banco (dados atuais: 0 duplicados). A estabilidade do id entre versões é **convenção do manifesto**, não contrato. |
| `member_classes` | `UNIQUE(usuario_id, club_id, class_id)`; aponta para a classe de **uma** versão. CHECK de status: `em_andamento, requisitos_concluidos, aguardando_revisao, apto_investidura, investida, cancelada` (não há estado "atualizada"). |
| `member_requirements` | `UNIQUE(member_class_id, requirement_id)`; `requirement_id` é FK para o requisito da **versão**. Estados `nao_iniciado…aprovado`. Nenhuma coluna de proveniência/herança. |
| `requirement_approvals` | FK para `member_requirements` **e** `requirement_id` **e** `curriculum_version_id`; `avaliado_por` NOT NULL; liga a uma tentativa (`submission_id`). `requirement_submissions` é imutável (gatilho). |
| `requisito_modelos` | chaveado por `manifesto_id`, vale para qualquer versão (precedente de identidade por `manifesto_id`, mas só para formulário). |
| Equivalência entre versões | só existe **por código de classe** (`_dependencia_de_classe_satisfeita`, `_classe_conclusao_ativa_clube`: a mesma classe `codigo` em qualquer versão oficial vale para pré-requisito/"já concluída"). **Não existia mapa por requisito.** |
| Manifesto `revisoes` | estruturado só em formato (`versao, data, itens, fonte, motivo`), mas `itens` é texto livre: só a 2026.2 de Amigo lista ids (`amigo.VII.1`, `amigo.IX.1`); as demais dizem "(todos os requisitos da classe_regular)". **Não classifica** editorial/equivalente/material, **não tem origem→destino**, não é validada e o gerador **não a inclui no pacote**. |
| `classe_revisao_solicitar` / `classe_revisoes_pendentes` | **não são revisão de versão.** São a revisão FINAL de investidura (selar conclusão → snapshot → workflow). Nome enganoso. |
| Matrícula em versão arquivada | funciona: `requisito_enviar/avaliar` exigem só `_classe_do_catalogo_oficial` (origem oficial), não "publicada". `classe_esta_publicada` só barra *iniciar* (`classe_iniciar` via `_classe_no_fluxo_normal`). RLS esconde a classe arquivada, mas as RPCs são `security definer`. |

### Quem depende de `member_requirements.status='aprovado'` / `requirement_approvals`

| Função | Depende de | Observação |
|---|---|---|
| `classe_percentual` | `mr.status='aprovado'`, junta por `mc.class_id` + `mr.requirement_id` | requisito de outra versão **não conta** |
| `avaliar_conclusao_classe` (gatilho `AFTER UPDATE OF status`) | idem; total = requisitos ativos de `mc.class_id` | **INSERT já aprovado não dispara** a conclusão |
| `_classe_selar_conclusao`, `investidura_registrar` | `mr.status <> 'aprovado'` = pendente; `_requisito_bloqueios` | reconfere tudo no ato |
| `_classe_snapshot_conteudo` (formato `conquista.snapshot_classe/1`) | `status` do `mr` + array `aprovacoes` de `requirement_approvals` | hash selado; sem campo de herança |
| `documento_conteudo` / PDF (Edge `gerar-documento-pdf*`) | `aprovado_por` vem de `aprovacoes` do snapshot | requisito "aprovado" sem aprovação sairia com aprovador vazio |
| `minha_classe`, `classe_formularios`, `classe_revisoes_pendentes`, `requisito_historico`, `investidura_cartao`, `escopo_resumo_coordenador` | `mr.status`, `requirement_approvals` | idem |
| `meu_portfolio` | **só** `requirement_approvals` | herança sem aprovação ficaria invisível |
| `minha_jornada`, `minhas_classes`, `classes_do_membro` | `classe_percentual`, `mc.status <> 'cancelada'` | |
| `classes_disponiveis` | `NOT EXISTS member_classes` com **o mesmo `class_id`** | ver achado abaixo |

**Achado colateral (lido no código; confirmado em teste descartável, ver §4):** como a oferta e o `UNIQUE` olham `class_id`, uma pessoa com Amigo 2026.3 em andamento pode iniciar também a Amigo 2026.4 (duas matrículas ativas da mesma classe). Só a classe *concluída* é equivalente por código.

## 3. Por que as saídas óbvias violam a regra

1. **Reapontar `member_classes.class_id`**: os `member_requirements` antigos deixam de casar com os requisitos da classe nova → percentual cai, conclusão nunca dispara. Consertar exige reescrever `member_requirements.requirement_id`, que então diverge de `requirement_approvals.requirement_id`/`curriculum_version_id` e de `requirement_submissions.requirement_id` (imutável) = **reescrever história**. Também apontaria snapshot/conquista para a classe errada.
2. **Nova matrícula + marcar requisito novo como `aprovado`**: é o único estado que as funções contam, mas sem `requirement_approvals` vira "aprovado sem aprovador" (PDF, portfólio e snapshot divergem); fabricar a aprovação é **falsificar**. Marcar não aprovado quebra percentual/conclusão.
3. **Antiga continua `em_andamento`**: sem estado terminal, as duas contam em listas e conflitos. Reutilizar `cancelada` mente (e `_classe_matricular` "ressuscita" cancelada ao recomeçar).

## 4. Exemplo concreto real (banco local, somente leitura)

Catálogo `classes-regulares-dsa`, classes **regulares** de mesmo código, comparação por `manifesto_id` (149 requisitos por versão, todos com `manifesto_id`, 0 duplicados). "Configuração" = tipo/obrigatoriedade de evidência, conteúdo anual, escolha N-de-M (mínimo, sem-repetição, opções). Igualdade **exata**, nenhuma heurística de texto.

| Par | mesmo id | descrição idêntica + config idêntica | descrição idêntica, config diferente | descrição diferente | só na nova | só na antiga |
|---|---|---|---|---|---|---|
| 2026.3 → **2026.4** (vigente) | 149 | **149** | 0 | 0 | 0 | 0 |
| 2026.2 → 2026.3 | 149 | 24 | 18 | 107 | 0 | 0 |
| 2026.1 → 2026.2 | 149 | 147 | 1 (`amigo.VII.1`: opção "Aves" → "Aves de estimação") | 1 (`amigo.IX.1`: lista artificial → escolha aberta) | 0 | 0 |

(2026.2 → 2026.4 = mesma linha de 2026.2 → 2026.3, porque a 2026.4 repete o conteúdo da 2026.3.) Por classe, 2026.2 → 2026.4:
Amigo 25 (5 idênticos / 2 só config / 18 descrição), Companheiro 26 (4/3/19), Excursionista 25 (6/4/15), Guia 26 (2/4/20), Pesquisador 23 (2/2/19), Pioneiro 24 (5/3/16).

O que o manifesto **já declara**: nas `revisoes`, 2026.4 e 2026.3 dizem "nenhum requisito entrou ou saiu" e que as regulares da 2026.4 são "inalteradas em conteúdo"; a 2026.3 diz que a descrição foi enriquecida (paráfrase) e que `tipo_evidencia` passou a existir (é o que explica as 107+18 diferenças da 2026.2). Nada disso diz **quais** ids são editoriais, equivalentes ou materiais: portanto, sem regra explícita, os 125 itens 2026.2 → vigente caem em `refazer`. Isto é o comportamento correto e conservador; classificar exige decisão editorial registrada no manifesto.

Matrículas locais: 1 (em 2026.4). Nenhuma em 2026.1–2026.3, então hoje não há caso vivo local a migrar.

**Rodando a prévia (banco de replay descartável, matrícula sintética de Amigo 2026.2 com 5 requisitos aprovados e rastreáveis → vigente 2026.4, mapa vazio):** 25 requisitos vigentes = 1 `preservado` + 4 `inalterado` + 20 `refazer` (18 por descrição diferente, 2 por configuração diferente), 0 novo, 0 removido, 0 equivalente. Dos 5 aprovados só 1 é idêntico: os outros 4 só poderiam ser aproveitados com decisão editorial registrada no manifesto.

**Confirmação do achado colateral (mesmo replay):** com a Amigo 2026.3 em andamento, `classes_disponiveis` ainda oferece a Amigo 2026.4 e `classe_iniciar` a inicia: a pessoa passa a ter 2 matrículas ativas da mesma classe. Não corrigido aqui (altera o motor); entra na Fase 2.

## 5. Desenho recomendado (fases)

**Fase 0 — feita (migration 522, aditiva, sem tocar o motor):** `class_requirement_equivalencias` (vazia, imutável, sem escrita pela API, 1:1 por par de versões, FK em `(identificador, versao)`) + `classe_atualizacao_previa` (leitura pura).

**Fase 1 — manifesto declara a regra.** Chave `equivalencias` por versão (`de_versao`, `origem_id → {destino_id, tipo, fonte}`) em `classes/*.json`; `validar.mjs` exige: ids existem nas duas versões, 1:1, tipo ∈ {editorial, equivalente, material}, fonte preenchida; `gerar-importacao.mjs` emite os INSERTs (pares **diretos** de cada versão antiga → vigente, sem composição de cadeia) e o `--check` vira gate. Sem linha = só vale igualdade exata de id+texto+config; qualquer outra coisa = refazer. Editorial/equivalente/material é decisão humana registrada, nunca inferida.

**Fase 2 — schema aditivo (migration própria):**
- `class_enrollment_updates` (append-only, `_proteger_registro_imutavel`): de/para `member_class_id`, de/para `class_id`, versões, **a prévia completa em jsonb + hash**, quem executou/papel/quando. `UNIQUE(de_member_class_id)` = idempotência.
- `member_classes`: status terminal novo `'atualizada'` (ajustar CHECK e todo `status <> 'cancelada'` em `minhas_classes`, `classes_do_membro`, `minha_jornada`, `classes_disponiveis`, `_dependencia_de_classe_satisfeita`) + `atualizada_de_member_class_id`. Fecha também o achado de matrícula duplicada entre versões.
- `member_requirements`: `herdado_de_member_requirement_id`, `herdado_aprovacao_id` (FK `requirement_approvals` original), `herdado_tipo` ('preservado'|'equivalente'); CHECK "se herdado → status `aprovado` e aprovação original presente"; gatilho que proíbe criar `mr` `aprovado` sem approval **ou** herança (hoje nada impede). Assim `classe_percentual`/`avaliar_conclusao_classe`/selar/investidura **continuam contando sem mudança**, e a história antiga fica intacta.
- Removidos: não viram `mr` (não são requisitos da classe nova); a matrícula nova expõe a lista "requisito da versão anterior" lida da matrícula antiga via linhagem.

**Fase 3 — a ação `classe_atualizar_matricula(member_class_id, previa_hash)`** (uma transação plpgsql; `FOR UPDATE` na matrícula): relê a prévia **no servidor** e só executa se o hash bater (o cliente confirma, **nunca escolhe equivalência**); cria a matrícula na versão vigente (`_classe_matricular` sem disparar conclusão), cria `mr` conforme a prévia (preservado/equivalente → herdado e aprovado; inalterado → copia status/N-de-M/`conteudo_fixado`; refazer/novo → `nao_iniciado`), grava linhagem+log+`_auditar`, marca a antiga `atualizada`, chama a avaliação de conclusão uma vez no fim. Qualquer falha = rollback (sem estado parcial). Recusa: matrícula fora de `em_andamento` (pós-conclusão a história é o snapshot selado), requisito `aguardando_avaliacao` pendente, já existir matrícula ativa na versão vigente.
- **Quem autoriza:** hoje `pode_avaliar_curriculo` = diretoria|instrutor (mesmo critério de aprovar requisito, já que herda aprovação). A pessoa pode **ver** a prévia; se pode também **solicitar/aceitar** é decisão do dono (D1).
- **Obrigatoriedade:** vir do catálogo (campo por versão, p.ex. `atualizacao: obrigatoria|opcional` + data) no pacote do manifesto; hoje inexistente (D2).

**Fase 4 — leituras mostram a proveniência:** `_classe_snapshot_conteudo` (formato `/2` com `herdado`), `documento_conteudo` + Edge PDF ("Cumprido na versão 2026.3 — aprovado por X em D"), `minha_classe`, `classe_formularios`, `classe_revisoes_pendentes`, `requisito_historico`, `investidura_cartao`, `meu_portfolio`, painéis do coordenador; tela de prévia→confirmar; testes SQL (preservação, atomicidade, concorrência, isolamento multiclube) + E2E.

**Riscos:** leitura que esqueça a proveniência vira "aprovado sem aprovador"; corrida com avaliação em curso; evidência/anexos em Storage (caminho por `auth.uid()`; `_comprovacao_referenciada` precisa enxergar a herança); `comprovacoes_documento` (foto da idade, apagada após aprovação) não se copia; conteúdo anual (`conteudo_fixado`); N-de-M só copia quando a configuração é idêntica; rascunhos (`rascunho`, `rascunho_anexos`) de requisito `refazer` (D3: manter como sugestão ou descartar).

## 6. O que foi implementado nesta entrega

- `supabase/migrations/20260930000522_classe-atualizacao-previa.sql` (aditiva; nenhuma função existente alterada).
- `supabase/tests/128_classe_atualizacao_previa.sql`.
- **Não implementado (de propósito):** a ação de atualizar, mudança de status/colunas, qualquer escrita em `member_*`/`requirement_*`, geração do mapa a partir do manifesto (Fase 1).

### Regras da prévia (explícitas)
1. Linha no mapa para o par (versão da matrícula → vigente) manda: `material` → `refazer`; `editorial`/`equivalente` → `equivalente`.
2. Sem linha: mesmo `manifesto_id` + descrição **idêntica** + configuração **idêntica** → `preservado` (aprovado **com aprovação rastreável**) ou `inalterado` (ainda não aprovado; o andamento segue igual). Aprovado sem aprovação rastreável nunca conta como cumprido.
3. Sem linha, mesmo id, descrição **ou** configuração diferente → `refazer` (`motivo` diz qual).
4. Sem origem → `novo`. Só na antiga → `removido` (com status e aprovação antigos).
5. Desvio consciente do enunciado: criei `inalterado` além de `preservado` (o enunciado exige "aprovado" em `preservado`; um requisito idêntico ainda não aprovado não é "novo" nem "refazer"). Configuração diferente com texto idêntico também exige regra explícita (a 2026.2→2026.3 mudou `tipo_evidencia` sem mudar texto em 18 casos).

### Formato JSON da prévia (para o front)
```jsonc
{ "ok": true, "somente_leitura": true,
  "member_class_id": "…", "status_matricula": "em_andamento",
  "versao_da_matricula": { "class_id": "…", "curriculum_version_id": "…", "identificador": "classes-regulares-dsa", "versao": "2026.3", "status": "arquivado", "codigo": "amigo", "nome": "Amigo" },
  "versao_vigente":      { "class_id": "…", "versao": "2026.4", "status": "publicado", … } | null,
  "existe_atualizacao": true,
  "atualizavel": true,   // só informativo: a ação ainda não existe
  "motivo": null,        // sem_versao_vigente | ja_na_versao_vigente | matricula_nao_em_andamento
  "mapa_explicito_linhas": 0,
  "ja_tem_matricula_na_versao_vigente": null | { "member_class_id": "…", "status": "em_andamento" },
  "contagens": { "total_requisitos_vigentes": 25, "preservado": 0, "inalterado": 0, "equivalente": 0, "novo": 0, "refazer": 0, "removido": 0 },
  "requisitos": [ {
      "categoria": "preservado|inalterado|equivalente|novo|refazer",
      "motivo": "mesmo_id_descricao_e_configuracao_identicos | mapa_editorial | mapa_equivalente | mapa_material | descricao_diferente_sem_regra_explicita | configuracao_diferente_sem_regra_explicita | sem_origem | origem_do_mapa_ausente_na_matricula | sem_manifesto_id",
      "cumprido_na_versao_anterior": true,
      "regra":   { "via": "mapa_explicito|mesmo_manifesto_id", "tipo": "editorial|equivalente|material|null", "fonte": "…|null" } | null,
      "destino": { "requirement_id": "…", "manifesto_id": "amigo.I.1", "secao_codigo": "I", "codigo": "1", "descricao": "…" },
      "origem":  { "requirement_id": "…", "member_requirement_id": "…", "manifesto_id": "…", "codigo": "…", "descricao": "…", "status": "aprovado", "aprovacao_rastreavel": true, "aprovado_em": "…", "aprovado_papel": "diretoria" } | null } ],
  "removidos": [ { "categoria": "removido", "motivo": "sem_requisito_correspondente_na_versao_vigente", "cumprido_na_versao_anterior": true, "origem": { … } } ] }
```
Sem texto de evidência, comentário, nome de avaliador ou caminho de arquivo. Autorização: a própria pessoa (vínculo ativo, não `pais`) ou `pode_avaliar_curriculo` do clube da matrícula; o clube vem de `clube_atual_id()`; matrícula de outro clube/pessoa/UUID forjado recebe a mesma mensagem (`Matrícula não encontrada neste clube.`).

## 7. Decisões que dependem do dono
D1 quem pode solicitar/aceitar a atualização (só liderança, ou a própria pessoa também); D2 obrigatoriedade e prazo vindos do catálogo; D3 rascunho de requisito `refazer`; D4 quem classifica editorial/equivalente/material no manifesto (fonte oficial/OMD ou decisão registrada) antes de qualquer ação.
