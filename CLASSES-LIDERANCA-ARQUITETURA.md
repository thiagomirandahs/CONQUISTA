# Classes de Liderança — arquitetura proposta (Fase 9, tema A)

**Status: DOCUMENTO DE ARQUITETURA. Nada foi implementado** (nenhuma migration, nenhum código de produto, nada em produção).
Nenhum conteúdo oficial foi inventado: tudo que vem de fonte está marcado com a origem; o que não tem fonte está marcado **A CONFIRMAR COM O DONO**.
Base lida: `FASE8-AUDITORIA-E-DECISOES.md` §5, `CLAUDE.md`, `supabase/AUDITORIA-CURRICULO-OFICIAL.md` §8–§10, `supabase/curriculo-manifesto/README.md`,
`CONQUISTA-X-INVESTIDURA.md`, `ATUALIZACAO-DE-CLASSE-ARQUITETURA.md`, migrations 36/37/38/44/46/120/210/330/380/518–527 e `src/services/classes*.js`.

---

## 1. Quais classes precisamos suportar

### 1.1 Nomes encontrados na documentação do repositório
O repositório registra três níveis (fonte: `AUDITORIA-CURRICULO-OFICIAL.md` §8.1 e `curriculo-manifesto/README.md`, que citam as páginas
`adventistas.org/.../classes-de-lideranca-requisitos/` e `.../cartao-de-lideranca/`):

| Nível (grafia como está no repo) | Idade | Pré-requisito declarado na fonte do repo | Duração declarada |
|---|---|---|---|
| **Líder** | 16 anos (**18 para a investidura**) | batizado; classes regulares concluídas **ou** cumprindo Classes Agrupadas simultaneamente; recomendação da comissão da igreja | 1 a 3 anos |
| **Líder Máster** (grafia com acento, como no repo; o pedido desta fase escreveu "Master" — confirmar) | 18 anos | 1 ano de experiência como Líder **investido** (OMD 002/2013); recomendação da igreja | até 3 anos |
| **Líder Máster Avançado** | **não especificada** | "presumivelmente" Líder Máster investido — marcado `PENDENTE_DE_VALIDACAO` no repo | **não especificada** |

Sequência: "cada nível deve ser alcançado separadamente e em ordem crescente" (mesma fonte).

**Ressalvas obrigatórias (nada disto é decisão fechada):**
- Essas informações vêm de uma auditoria feita sobre páginas públicas, **não** de um cartão oficial em mãos. Os **nomes, a grafia (Máster/Master), idades e pré-requisitos precisam ser confirmados pelo dono** contra o cartão oficial vigente. **A CONFIRMAR COM O DONO.**
- Líder Máster Avançado: idade, pré-requisito, duração e requisitos são desconhecidos (repo itens 7 e 9 de §9 da auditoria). **Não modelar valores; deixar campos nulos até haver fonte.**
- Se os cartões de cada nível têm fluxo de aprovação diferente: desconhecido (item 9). **A CONFIRMAR.**
- Normas citadas na auditoria que afetam a regra (todas `CONFIRMADO` no `omds.json` do repo ou na auditoria §8.2, a reconferir pelo dono): OMD 002/2013 (1 ano de experiência entre níveis), OMD 011/2016 (itens extras para "regionais"), OMD 015/2018 (cadastro de líder investido no SGC), **OMD 018/2022 (a partir de 01/06/2022 as classes de liderança só se fazem pelo Cartão Virtual do SGC)**, OMD 019/2023 (criou o Coordenador Regional).

### 1.2 Fato arquitetural mais importante: o registro oficial é o SGC
Segundo a auditoria §8.3 (a validar), o fluxo oficial é: diretor/secretário do clube libera o cartão preenchendo o 1º requisito → candidato anexa evidência (PDF/JPG ≤ 2 MB) → clube revisa 100% → **Coordenador Regional OU, na ausência, o Campo** aprova → registro automático **no SGC**.
Consequência: **o DesbravaClube não pode se apresentar como o registro oficial da Classe de Liderança** enquanto o cartão virtual do SGC for o canal obrigatório (OMD 018/2022). O produto só pode ser (a) **acompanhamento/preparação** com exportação e conferência do que é feito no SGC, ou (b) um canal oficial **se a DSA/SGC autorizar** (integração ou aceite formal). Isso é a decisão D1 abaixo e muda o que "investidura" significa no sistema. Até D1, o texto de qualquer tela/documento deve dizer "acompanhamento no clube; o registro oficial é feito no SGC" (e a Landing já marca Liderança como PLANEJADO, `LANDING-VERACIDADE.md`).

---

## 2. Diferenças para Regular/Avançada

| Dimensão | Regular / Avançada (hoje, em produção) | Liderança (o que a fonte do repo indica) | Lacuna no motor |
|---|---|---|---|
| Público | crianças/adolescentes 10–15 (regular); avançada pareada à regular | **adultos e jovens 16+** (16 e 17 ainda são **menores**) | idade mínima por classe existe (`classes.idade_minima`, 519 bloqueia sem nascimento), mas **não há "idade mínima para investidura" separada** (Líder: 16 matrícula, 18 investidura) |
| Papel no clube | qualquer membro ativo que não seja `pais`; papel não é critério | pessoa que **lidera**/pretende liderar (conselheiro, instrutor, diretoria…) — **o repositório não declara qual papel é exigido**. Cargos reais vêm do convite e mapeiam para 6 papéis (migration 200) | `member_classes` não tem conceito de "papel exigido". **A CONFIRMAR** se Líder exige cargo, ou só vínculo ativo |
| Pré-requisitos | `curriculum_dependencies` (classe→classe; "iniciada_ou_concluida" para avançada→regular) | classes regulares concluídas **ou** Classes Agrupadas em paralelo; Máster exige **Líder investido há ≥ 1 ano**; "batizado" e "recomendação da comissão da igreja" | dependência por classe: **existe**. Ausentes: tempo desde a investidura anterior; "batizado"/"recomendação" (**não há campo** em `profiles`, nem o conceito de documento de recomendação); Agrupadas ("é caminho de exceção", sem schema) |
| Especialidades como pré-requisito | `curriculum_dependencies` aceita `depende_de_tipo='specialty'`; `escolha_n_de_m` | a fonte do repo **não lista** pré-requisitos de especialidade para Líder (só que há requisitos de conteúdo). **A CONFIRMAR** | motor suporta; falta dado |
| Quem avalia | `pode_avaliar_curriculo` = diretoria\|instrutor; ninguém avalia o próprio requisito | clube revisa; **quem é avaliado já pode ser da própria diretoria/instrutoria** (candidato a líder costuma ser instrutor/conselheiro) | a regra "sem autoavaliação" **precisa valer sem exceção** e o caso "só a diretora pode avaliar" (Fase 8 §8, D8) fica **comum**, não raro |
| Investidura / aprovação acima do clube | fluxo declarativo 330: clube → distrito → região → apto (pula nível ausente) | clube → **Coordenador Regional OU Campo** (OMD 019/2023) → SGC | o motor (46) cobre `escopo_tipo` campo e papéis `coordenador_geral`/`diretor_mda` (campo), mas **não cobre "A OU B por ausência"**: hoje nível que existe e está sem coordenador **espera** (não pula). Falta "fallback de escopo" |
| Prazo | `prazo_minimo_dias/prazo_maximo_dias` + `prazo_situacao()` existem (migration 38 §D; a auditoria §10.3 foi superada) | Líder 1–3 anos; Máster até 3 anos | motor existe; precisa de política para "prazo estourado" (hoje só informativo/mínimo respeitado no gatilho). **A CONFIRMAR** o que ocorre ao estourar |
| Documentos/certificados | snapshot selado, PDF, assinatura eletrônica simples, verificação pública | cartão/certificado de liderança é **do SGC**; não há texto oficial de documento | o motor emite documento por snapshot; **o modelo do documento de liderança não existe e não pode ser inventado** |
| Histórico | `curriculum_achievements` (1 ativa por pessoa+código oficial, 527), `class_prior_completion_log` (521 registra classe concluída antes) | histórico de **líder investido** é relevante para o SGC (OMD 015/2018) e para a regra de 1 ano | precisamos de **data da investidura** confiável e de "investida anteriormente" (registro retroativo, como 521) para quem já é líder |
| Evidência | texto/foto; PDF no Storage; foto de documento só para idade (380) | PDF/JPG ≤ 2 MB por requisito (SGC) | o motor tem `tipo_evidencia` `arquivo`, mas **só `texto` e `foto` têm envio real** hoje |
| Conteúdo | 6 classes × regular/avançada importadas por manifesto | **nenhum conteúdo oficial importado** | depende do dono: ver §9 |

---

## 3. O que NÃO PODE mudar (invariantes protegidos)

1. Linhas, ids e versões já publicadas de Regular/Avançada (2026.4 vigente; 2026.1–2026.3 arquivadas). Qualquer mudança em `classes_disponiveis`, `classe_iniciar`, `classe_atribuir`, `classe_percentual`, `avaliar_conclusao_classe`, `_classe_selar_conclusao`, `investidura_registrar` deve ser **aditiva** (guarda por tipo) e rodar com todos os testes 31–39, 124–132 verdes.
2. Os CHECKs de `classes`: `tipo_classe in ('regular','avancada')` e `classes_avancada_tem_regular` — **não** relaxar o CHECK existente para "encaixar" a liderança sem decidir a alternativa (ver §4). Se `tipo_classe` ganhar valor novo, `(tipo_classe = 'avancada') = (classe_regular_codigo is not null)` continua valendo para regular/lideranca (ambos com `classe_regular_codigo` nulo).
3. Matrizes de idade das regulares (10–15 por classe) e a regra 519 (sem nascimento não matricula; concluída vale entre clubes; iniciada só vale no clube atual).
4. Conquista curricular: 1 ativa por **pessoa + código oficial** (527); `curriculum_achievements.tipo in ('classe','especialidade')`. Liderança **não** pode criar segunda conquista para o mesmo código nem reconhecimento cruzado (525) com regular. Se entrar em `curriculum_achievements`, o código da classe de liderança precisa ser um código próprio (nunca colidir com `amigo`…`guia`).
5. Equivalências: `_classe_matricula_equivalente` (523) e `_dependencia_de_classe_satisfeita` equiparam "mesmo `codigo` oficial, qualquer versão". Códigos de liderança precisam ser **únicos entre catálogos** para nunca equivaler a uma regular. Hoje a unicidade de `codigo` é só por `(curriculum_version_id, codigo)`; o risco de colisão entre catálogos deve ser fechado por teste/constraint de catálogo (ver §7).
6. `class_requirement_equivalencias` (522) é por `identificador` do catálogo; liderança usa **outro `identificador`** e fica fora do mapa das regulares.
7. Investidura de Regular/Avançada: workflow `classes-regulares` v2 / `classes-avancadas` v1 (330) intocado. **Achado de risco:** `_workflow_iniciar_run` escolhe a chave com `case when tipo_classe='avancada' then 'classes-avancadas' else 'classes-regulares'` e ainda tem `coalesce(v_chave,'classes-regulares')` — uma classe com tipo novo cairia **silenciosamente no workflow das regulares**. Antes de qualquer importação, essa função precisa recusar (ou rotear) tipo desconhecido.
8. Listas voltadas a crianças (`classes_disponiveis`, `minha_jornada`, Rede, painéis de coordenador, `escopo_resumo_coordenador`) hoje agregam `member_classes` sem separar tipo: liderança **não pode** aparecer em "classes do desbravador" nem inflar contagens de investidura/ranking sem decisão.
9. Foto de documento (380): continua só para idade; não usar para "recomendação da igreja".
10. Decisão do dono de 01/10: matrícula iniciada **permanece na versão** (vale para liderança também; ver `ATUALIZACAO-MATRICULA-ENTRE-VERSOES-FLUXO.md`).

---

## 4. Como modelar — três alternativas

### Alternativa 1 — `tipo_classe = 'lideranca'` no motor existente, com workflow próprio
Abrir o CHECK para `('regular','avancada','lideranca')`; novas colunas aditivas em `classes` (`nivel_lideranca`, `idade_minima_investidura`, `exige_papeis text[]`, `meses_minimos_nivel_anterior`); catálogo próprio (`identificador='classes-lideranca-dsa'`), workflow `classes-lideranca` v1 (usa `investiture_workflows` já declarativo), dependências por `curriculum_dependencies`, importador do manifesto (mesmo padrão `curriculo-manifesto/`).
- **Prós:** reaproveita 100% do motor (requisitos, N-de-M, relatório estruturado da Fase 7, tentativas imutáveis, snapshot, PDF, assinatura, conquista, auditoria, RLS, manutenção, fila de avaliação). Menos código novo. Mesma tela Minha Classe/Avaliar. É o caminho já apontado em `FASE8-AUDITORIA-E-DECISOES.md` §5.
- **Contras:** toda função que lê `member_classes`/`classes` passa a enxergar liderança — exige **varredura de ~15 funções/leituras** para filtrar tipo (item 8 de §3) e a correção do roteamento de workflow (item 7). Risco de regressão em regular. O motor assume "o requisito é de um adolescente" em textos/UX. Papel/idade 16–17 (menor) entra num motor desenhado para menores sem consentimento de responsável diferente. O fallback "A OU B" do aprovador exige evolução do motor 46.

### Alternativa 2 — tabelas paralelas (`leadership_*`), motor próprio
Esquema separado (programas, níveis, requisitos, matrículas, aprovações, investiduras), RPCs próprias, telas próprias.
- **Prós:** isolamento total: **zero risco** de regressão nas regulares; modelo livre das suposições de criança (papel, idade, menor/maior, recomendação da igreja, aprovação Campo, vínculo com SGC); pode nascer com `fonte_oficial_sgc` e estados próprios.
- **Contras:** reimplementa o que já é maduro (relatório estruturado, tentativas imutáveis, fila de avaliação, snapshot/PDF/assinatura, conquista, manutenção, auditoria, storage, testes). Dois motores para manter; duas fontes de "classe concluída" (a conquista curricular portátil precisaria de nova `tipo`); alto custo de teste.

### Alternativa 3 — híbrida: motor de requisitos compartilhado + "programa" como camada acima (RECOMENDADA)
Manter o **catálogo, requisitos, matrícula, progresso, tentativas, aprovações, snapshot e documentos no motor existente** (como na Alt. 1), mas **sem tocar nas funções das regulares**: o que é diferente fica numa camada separada de **política de programa** (`leadership_program_policies` / elegibilidade / workflow), e as funções públicas de liderança são **RPCs novas** (`lideranca_*`), não alterações das RPCs regulares. As leituras compartilhadas ganham **um filtro de tipo único e testado**, introduzido numa migration própria e anterior (de "endurecimento"), que primeiro **prova** que nada muda para regular/avançada, só depois a liderança é habilitada por flag da plataforma (`recurso`, nasce DESLIGADO, como Comunidade).
- **Prós:** reuso do motor sem alterar comportamento de regular (a migration de endurecimento é no-op para regular/avançada, verificada por testes de contrato); política de liderança (idade de investidura, papel, tempo no nível anterior, prazo, aprovador "A OU B") isolada e versionada; trava de segurança: liderança desligada por padrão, ligada por clube só pelo admin da plataforma; reversível (flag).
- **Contras:** duas migrations de preparação antes de ver qualquer tela; a "camada de política" é um desenho novo (mas pequeno); mantém a varredura de leituras (item 8), embora com **teste de contrato que lista todas as leituras e exige filtro**.

### Recomendação
**Alternativa 3**, na ordem: (i) migration de endurecimento sem mudança de comportamento (tipo desconhecido recusado em `_workflow_iniciar_run`; `classes_disponiveis` e listas de criança filtram `tipo_classe in ('regular','avancada')`; teste que falha se uma leitura nova de `member_classes` ignorar o tipo); (ii) `tipo_classe='lideranca'` + política + workflow v1 vazio de conteúdo; (iii) importação de conteúdo **somente depois** de o dono entregar o cartão oficial. A Alt. 2 só se justifica se a decisão D1 for "o DesbravaClube **não** é o registro; só acompanha" e o dono preferir isolar completamente — nesse caso a Alt. 2 simplificada (apenas "acompanhamento", sem investidura/documento) é viável e **mais barata**, mas perde a reutilização. Até D1, **não implementar**.

---

## 5. Modelo de dados proposto (esboço, NÃO é migration)

```sql
-- (A) classes: só colunas aditivas e nulas; CHECK de tipo ampliado numa migration separada, DEPOIS do endurecimento
-- alter table public.classes drop constraint classes_tipo_classe_check;
-- alter table public.classes add constraint classes_tipo_classe_check check (tipo_classe in ('regular','avancada','lideranca'));
-- (classes_avancada_tem_regular permanece: avançada <=> classe_regular_codigo não nulo)

-- nível dentro do programa (a ordem oficial; sem inventar nomes: os nomes vêm do manifesto)
create table public.leadership_levels (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null unique references public.classes(id),       -- uma classe de liderança por nível/versão
  nivel_ordem int not null check (nivel_ordem >= 1),                -- 1=Líder, 2=Máster, 3=Máster Avançado (A CONFIRMAR)
  nivel_anterior_codigo text,                                        -- código oficial do nível anterior (null no 1º)
  meses_minimos_apos_anterior int check (meses_minimos_apos_anterior is null or meses_minimos_apos_anterior >= 0), -- Máster: 12 (OMD 002/2013, A CONFIRMAR)
  idade_minima_matricula int,        -- Líder: 16 (A CONFIRMAR)
  idade_minima_investidura int,      -- Líder: 18 (A CONFIRMAR); Máster: 18; Avançado: NULL até haver fonte
  papeis_elegiveis text[],           -- NULL = qualquer vínculo ativo (A CONFIRMAR); jamais 'pais'
  exige_batismo boolean,             -- NULL = não verificar (A CONFIRMAR; não há campo em profiles)
  exige_recomendacao_igreja boolean, -- NULL = não verificar (A CONFIRMAR)
  fonte_url text, fonte_hash text    -- proveniência, igual às classes regulares
);

-- recomendação/declaração: registro auditável de que a exigência foi atendida, sem guardar documento sensível
create table public.leadership_prerequisite_attestations (
  id uuid primary key default gen_random_uuid(),
  member_class_id uuid not null references public.member_classes(id),
  tipo text not null check (tipo in ('batismo','recomendacao_igreja','agrupadas_em_curso')),
  atestado_por uuid not null references public.profiles(id),   -- liderança do clube, nunca o próprio candidato
  atestado_papel text not null,
  observacao text,
  created_at timestamptz not null default now()                 -- append-only (_proteger_registro_imutavel)
);

-- aprovador acima do clube com fallback ("Regional OU Campo"): evolução aditiva do workflow 46
-- alter table public.investiture_workflow_stages add column escopo_alternativo text check (escopo_alternativo in ('regiao','campo','uniao','divisao'));
-- alter table public.investiture_workflow_stages add column alternativo_quando text check (alternativo_quando in ('nivel_ausente','sem_autoridade_ativa'));
-- workflow: ('classes-lideranca', 1) com etapas  clube(diretoria|instrutor) -> aprovação (regiao, fallback campo) -> registro oficial (externo/SGC? ver D1)

-- vínculo com o registro externo (se D1 = "acompanha o SGC"): imutável, informativo
create table public.leadership_external_registrations (
  id uuid primary key default gen_random_uuid(),
  member_class_id uuid not null references public.member_classes(id),
  sistema text not null check (sistema in ('sgc')),
  referencia_externa text,            -- número/protocolo informado pelo clube
  confirmado_por uuid not null references public.profiles(id),
  confirmado_em timestamptz not null default now()
);
-- toda tabela nova termina com: select public._manutencao_instalar_guarda();  (teste 100)
```

Aditivos nas leituras: filtro `tipo_classe in ('regular','avancada')` nas listas de criança; novas RPCs `lideranca_disponiveis()`, `lideranca_iniciar(class_id)`, `lideranca_elegibilidade(class_id)`, `lideranca_atestar(member_class_id, tipo, obs)`, `lideranca_registrar_externo(...)`. `curriculum_dependencies` (classe→classe, `modo='concluida'`) cobre "Líder → Máster"; o "≥ 12 meses" é checado pela nova elegibilidade lendo `class_investitures.data_investidura` da conquista ativa.

---

## 6. Permissões (RLS/RPCs) e impacto no front

**RLS:** novas tabelas com RLS ligada, `revoke insert/update/delete from authenticated, anon`, leitura via `_pode_ver_conquista_curricular` (dono, emissor, liderança de clube com vínculo ativo) — mesmo padrão de snapshot/investidura. Aprovadores acima do clube **não** leem evidência fora da etapa (policy de Storage 330 já é por corrida em andamento); liderança agregada (painéis) só enxerga números.

**RPCs (todas `security definer`, `search_path ''`, `clube_atual_id()`, `_exigir_classes_habilitado` + novo `_exigir_lideranca_habilitada(club)`):**
- elegibilidade: idade (matrícula ≥ N; investidura ≥ M, verificada de novo **no ato** de `investidura_registrar`, não só na matrícula), papel (se definido), nível anterior concluído/investido há ≥ X meses, atestados exigidos presentes, não duplicar matrícula equivalente (523), não ser `pais`;
- avaliação: `pode_avaliar_curriculo` **e** avaliador ≠ candidato **e** (nova regra a decidir, D5) avaliador de nível ≥ do candidato? — hoje não existe conceito de "quem é mais velho na liderança"; **não inventar**, deixar D5;
- atribuição pela diretoria (`classe_atribuir`) para liderança: só diretoria e com a mesma elegibilidade; **menor de 18 nunca por atribuição silenciosa** (ver riscos).

**Front (impacto):** `Minha Classe` hoje é uma tela de criança; liderança entra como seção/aba "Liderança" visível só se a flag e a elegibilidade permitirem, nunca na lista padrão de criança. `Gestão` (Avaliações/Investiduras/Documentos) passa a ter filtro de programa; o coordenador (`escopo_*`) vê números de liderança **separados** de classes. Landing: manter "PLANEJADO" até haver fluxo real. Nada de gamificação (ranking/pontos) para liderança. Textos das telas devem deixar claro o status oficial/SGC (D1).

---

## 7. Riscos

| Risco | Descrição | Mitigação |
|---|---|---|
| **Menor de idade (16–17)** | Líder aceita 16; investidura só aos 18 (fonte do repo). Dados de menor, consentimento de responsável, quem pode ver | idade de investidura checada no ato; liderança de 16–17 permanece como "cumprindo" sem emitir documento; consentimento de menor (69) e regras do portal de pais continuam; decisão D3 |
| **Papel** | candidato é da própria diretoria/instrutoria → ninguém consegue avaliá-lo (D8 Fase 8) | aprovação cruzada/coordenação como avaliador (decisão D5), nunca exceção silenciosa |
| **Multiclube** | pessoa lidera em dois clubes; "iniciada" só vale no clube atual (519); conquista é da pessoa (527) | liderança segue o mesmo contrato; teste cruzado; código próprio para não equivaler a regular |
| **Hierarquia** | "Regional OU Campo" ≠ comportamento atual (nível existente sem coordenador espera) | `escopo_alternativo` explícito, decisão registrada com o escopo que decidiu |
| **Vazamento** | aprovador acima do clube veria evidência de adulto fora da etapa | policy de Storage por corrida; testes de isolamento |
| **Identidade/uso do termo "oficial"** | declarar-se registro oficial sem o ser | D1; texto padrão |
| **Regressão nas regulares** | uma leitura sem filtro de tipo infla contagens/ranking | migration de endurecimento + teste de contrato por varredura de funções |
| **Workflow errado silencioso** | tipo novo cai em `classes-regulares` (§3 item 7) | recusar tipo desconhecido; teste |
| **Conteúdo inventado** | importar "do jeito que parece" | só importar com cartão oficial entregue pelo dono, via manifesto + validador (`PENDENTE_DE_VALIDACAO` nunca é resolvido por inferência) |
| **Prazo** | 1–3 anos: o que acontece ao expirar | decisão D6; `prazo_situacao()` já informa |

---

## 8. Plano de testes proposto

**SQL (próximos números livres, após 132):**
1. Contrato de invariantes: `classes_tipo_classe_check` continua recusando valores fora da lista aprovada; `classes_avancada_tem_regular` intacto; regular/avançada com versão 2026.4 não mudam (contagem de linhas/hash por classe antes e depois da migration).
2. Varredura: nenhuma função que lê `member_classes`/`classes` e aparece em lista "de criança" aceita tipo `lideranca` (teste lê `pg_proc` e a lista permitida).
3. `_workflow_iniciar_run` recusa tipo desconhecido; liderança usa workflow `classes-lideranca`; regular/avançada continuam nos seus.
4. Idade: matrícula a 16, bloqueio a 15 e sem nascimento (519); investidura bloqueada < 18 mesmo com todos os requisitos aprovados; limite exato na data de aniversário (fuso `America/Sao_Paulo`).
5. Papel: `pais` nunca; papel fora de `papeis_elegiveis` bloqueia; membro inativo/encerrado bloqueia; troca de papel após a matrícula não reabre (decisão a registrar).
6. Pré-requisito: Máster sem Líder investido recusa; Líder investido há 11 meses recusa, 12 aceita (conforme fonte confirmada); Líder revogado não conta; conquista de outro clube conta; matrícula de liderança equivalente duplicada recusa.
7. Autoavaliação: ninguém avalia o próprio requisito (inclusive diretoria); aprovação cruzada conforme D5.
8. Workflow: clube → regional; fallback ao Campo só quando regional ausente; nível com coordenador ausente tem comportamento definido; segregação de decisores; devolver marca requisitos.
9. RLS: aprovador acima do clube sem corrida em andamento não lê evidência; painel agregado não vaza nome/foto; clube B não lê liderança do clube A; `anon` sem acesso.
10. Conquista: `curriculum_achievements` com código de liderança não colide com regular; 1 ativa por pessoa+código; revogação mantém histórico.
11. Manutenção (teste 100): toda tabela nova com `_manutencao_instalar_guarda()`.
12. Flag: recurso DESLIGADO por padrão; clube sem a flag recebe erro claro em todas as RPCs `lideranca_*`.
13. Idempotência/concorrência: dupla matrícula simultânea; dupla atestação; dupla investidura (índices únicos parciais).

**Vitest:** `classes.js`/`MinhaClasse` não listam liderança na jornada da criança; tela "Liderança" só aparece com flag + elegibilidade; textos de status oficial; filtro por programa em Gestão; ausência de gamificação.

**E2E (Supabase local, padrão `test:fluxo:e2e`):** fluxo completo Líder: atestados → relatos → avaliação do clube → aprovação regional → (fallback Campo) → registro externo confirmado → conquista; Líder Máster com 12 meses; menor de 18 chega ao fim dos requisitos e **não** emite documento; devolução com correção; clube com diretora única (D5); regressão do fluxo regular inteiro (87 asserts) sem mudança.

---

## 9. Decisões e CONTEÚDO OFICIAL que dependem do dono

**Conteúdo oficial (nada disto existe no repo; nada foi inventado):**
- C1. Cartão oficial vigente de cada nível: requisitos, seções, N-de-M, textos, tipos de evidência.
- C2. Confirmação dos nomes e da grafia (Líder / Líder Máster / Líder Máster Avançado) e da ordem.
- C3. Idade mínima e pré-requisitos do Líder Máster Avançado (e confirmação de 16/18 para Líder, 18 para Máster, "1 ano" OMD 002/2013).
- C4. Texto/modelo do certificado ou documento de liderança (se houver), e de "recomendação da igreja".
- C5. Se os três níveis têm fluxos de aprovação diferentes; se há exigência extra para "regionais" (OMD 011/2016).

**Decisões:**
- **D1 (principal): o DesbravaClube é o registro oficial ou apenas acompanhamento do SGC (OMD 018/2022)?** Define investidura, documento e linguagem. Há aval/contato com a DSA?
- D2. Alternativa de modelagem (recomendada: 3).
- D3. Menor de 18 (16–17): pode se matricular e acompanhar? quem consente? emite algo antes dos 18?
- D4. Papel exigido (se houver) e como tratar "batizado"/"recomendação" (atestado da liderança; sem documento).
- D5. Quem avalia o candidato que é da própria diretoria/instrutoria (aprovação cruzada entre clubes, coordenação, diretor de outro clube da mesma região) — liga à D8 da Fase 8.
- D6. Prazo (1–3 anos): o que acontece ao estourar o máximo e como contar o mínimo.
- D7. Aprovador "Regional OU Campo": regra exata quando o Campo não tem Coordenador Regional (OMD 019/2023).
- D8. Liderança entra em painéis do coordenador e na Rede (conquistas)? Por padrão: **não**.
- D9. Classes Agrupadas: representar como atestado "em curso" ou ignorar.
- D10. Habilitação: por clube pela plataforma (recomendado) ou por plano comercial.
