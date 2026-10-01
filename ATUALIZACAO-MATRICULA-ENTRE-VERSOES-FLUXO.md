# Atualização de matrícula entre versões do currículo — fluxo explícito e seguro (Fase 9, tema B)

**Status: DOCUMENTO DE ARQUITETURA + PLANO DE TESTES. Nada foi implementado** (nem migration, nem código de produto, nem produção).
Base: `ATUALIZACAO-DE-CLASSE-ARQUITETURA.md` (inclui a **decisão do dono de 01/10/2026**), migrations 522 (prévia + mapa vazio), 523/526 (matrícula equivalente bloqueia a vigente), 527, `CONQUISTA-X-INVESTIDURA.md`, migrations 44/46/330/87/510, testes 128/129.

## 0. Premissas que não mudam (decisão do dono)
1. **Matrícula iniciada PERMANECE na versão em que começou. Não há migração automática, nem obrigatória.** Este fluxo é uma **opção explícita, individual, com aceite**, nunca em massa e nunca em segundo plano.
2. A versão nova vale para matrículas **novas**. Quem não aceitar atualizar conclui na versão original (comportamento de hoje, intocado).
3. `classe_atualizacao_previa()` (522) segue como **leitura informativa**. Este documento define o que seria necessário para existir uma *ação*; ele **não autoriza implementar** (ver "Critérios para liberar", §11).
4. Nada do que existe é reescrito: `member_classes.class_id`, `member_requirements.requirement_id`, `requirement_submissions` (imutável), `requirement_approvals`, snapshots, documentos, assinaturas e investiduras **não são alterados** em hipótese alguma.

## 1. O que se preserva INTACTO (lista fechada)
| Item | Garantia |
|---|---|
| Matrícula original (`member_classes`, versão, `class_id`, datas) | nenhuma coluna existente é alterada; só o `status` pode ir para um estado terminal novo (`atualizada`) ou voltar (reversão), nunca outro valor |
| `member_requirements` da original | nenhuma linha alterada ou apagada (inclui `rascunho`, `conteudo_fixado`, N-de-M) |
| Tentativas (`requirement_submissions`) e anexos | imutáveis hoje; continuam; o Storage não é copiado nem movido |
| Aprovações (`requirement_approvals`) | nunca duplicadas, nunca recriadas, nunca editadas; é a **fonte** da herança |
| Documentos, PDFs, assinaturas, snapshots, verificação pública | continuam válidos e vinculados à matrícula/versão em que foram emitidos |
| Investidura (`class_investitures`, `investiture_workflow_runs`, decisões) | intocadas; **se há corrida em andamento, a atualização é recusada** (§6) |
| Conquista curricular (`curriculum_achievements`, 527) e reconhecimentos (525) | intocados; a atualização **não cria nem revoga** conquista por si |
| Histórico (`class_completion_events`, `_auditar`) | só **acrescenta** eventos |
| Proveniência | a nova matrícula guarda "veio de" a original, o mapa (hash) e quem decidiu |
| Foto de documento da idade (380) | já foi apagada após aprovação; não se copia; só o "conferido por" pode ser herdado se o mapa disser |

## 2. Classificação dos requisitos: sempre por REGRA CURRICULAR VERSIONADA

### 2.1 As cinco categorias (vocabulário fechado)
| Categoria | Significado (decisão **editorial humana**, nunca inferida) | Existe em origem | Existe em destino |
|---|---|---|---|
| `identico` | mesmo requisito, mesmo conteúdo e comprovação | sim | sim |
| `equivalente` | requisito reescrito/reorganizado que o revisor declara **cumprir o mesmo objetivo e a mesma exigência** | sim | sim |
| `novo` | exigência que não existia | não | sim |
| `removido` | exigência que deixou de existir | sim | não |
| `alteracao_material` | existe nos dois, mas **o que a pessoa precisa fazer/comprovar mudou**; aprovação antiga não vale | sim | sim |

Observação sobre a 522: lá o vocabulário é `editorial | equivalente | material`, e a regra 2 da prévia marca como `preservado` o que for igual em id+texto+configuração **sem linha no mapa**. Isso é útil como **sugestão**, mas **não pode ser a base de uma ação**: na ação, **só a linha publicada do mapa manda**. Mapeamento proposto: `editorial`→`equivalente` (com marca "só redação"), `equivalente`→`equivalente`, `material`→`alteracao_material`; `identico`, `novo`, `removido` são novos. Requisito sem linha no mapa = **bloqueia a publicação do mapa** (ver §2.3), e, se mesmo assim aparecesse numa matrícula, é tratado como `alteracao_material` (pendente), nunca como herdado.

### 2.2 O mapa publicado com a versão nova
O mapa é um **artefato curricular versionado**, par `(identificador, versão_origem → versão_destino)`, publicado **junto** com a versão nova (ou depois, como nova revisão), e **imutável** depois de publicado.

**Formato (arquivo do manifesto, esboço):** `supabase/curriculo-manifesto/mapas/<identificador>/<origem>-para-<destino>.json`
```jsonc
{
  "identificador": "classes-regulares-dsa", "versao_origem": "2026.3", "versao_destino": "2026.5", "revisao": 1,
  "elaborado": { "por": "<nome>", "em": "2026-..-.." },
  "aprovacao": { "por": "<nome>", "papel": "<curador curricular>", "em": "2026-..-..", "referencia": "<ata/OMD/decisão registrada>" },
  "itens": [
    { "origem": "amigo.I.1", "destino": "amigo.I.1", "classificacao": "identico",
      "justificativa": "texto e comprovação idênticos (conferido por <revisor>)", "fonte": "<OMD / cartão / decisão>" },
    { "origem": "amigo.VII.1", "destino": "amigo.VII.1", "classificacao": "alteracao_material",
      "justificativa": "opção 'Aves' virou 'Aves de estimação'", "fonte": "<...>" },
    { "origem": null, "destino": "amigo.X.9", "classificacao": "novo", "justificativa": "...", "fonte": "..." },
    { "origem": "amigo.V.4", "destino": null, "classificacao": "removido", "justificativa": "...", "fonte": "..." }
  ],
  "sugestoes_de_diff": [ /* opcional; NÃO entra no hash; só ajuda o revisor */ ]
}
```
**Regras do validador (gate de CI, como o `validar.mjs` atual):**
1. Cobertura **total**: todo `manifesto_id` da origem **e** todo do destino aparece em exatamente um item (nada "sem classificar").
2. `identico`/`equivalente`/`alteracao_material`: origem e destino presentes; `novo`: só destino; `removido`: só origem.
3. **1:1** (mesma regra da 522): fusão/divisão **nunca** é `equivalente`; vira `removido` + `novo` ou `alteracao_material`.
4. Justificativa e fonte obrigatórias (≥ 10 caracteres, como na 522); **fonte nunca pode ser "similaridade de texto" ou "gerado automaticamente"**; referência a OMD só se a OMD estiver `CONFIRMADO` em `omds.json`.
5. Os ids existem nas duas versões; as versões existem e são do mesmo `identificador`.
6. `aprovacao.por` ≠ `elaborado.por` (dois olhos), campo `aprovacao` obrigatório; sem aprovação o gerador **não emite**.
7. `identico` só é aceito se a **assinatura estruturada** (texto + configuração + opções, função `_classe_requisito_assinatura` da 522) da origem e do destino for **igual**; se for diferente, o mapa é recusado (impede o revisor de declarar "idêntico" por engano). `equivalente` não tem essa exigência (é justamente o juízo humano).

**O diff de texto é só sugestão:** uma ferramenta (`gerar-mapa-sugestao.mjs`, a escrever) lê as duas versões e preenche `sugestoes_de_diff` e uma classificação **provisória** (`identico` por igualdade exata de assinatura; o resto `a_revisar`). Um item `a_revisar` não passa no validador. Nenhuma linha vai ao banco sem aprovação humana registrada.

### 2.3 Quem aprova, como é versionado e como é imutável
- **Quem elabora:** time curricular (dono ou pessoa designada). **Quem aprova:** pessoa diferente, com autoridade curricular definida pelo dono (**decisão D1**). Não é decisão do clube nem da liderança local.
- **Versionamento:** `revisao` inteira por par de versões; correção = **nova revisão** que `substitui` a anterior (status da anterior vira `substituido`, as linhas nunca mudam). Git guarda o arquivo; o hash (`sha256` do JSON canônico, **sem** `sugestoes_de_diff`) guarda a identidade.
- **Chegada ao banco:** só por migration **gerada** a partir do arquivo (mesmo padrão `gerar-importacao.mjs` + `--check` como gate), inserindo cabeçalho + itens já `publicado`. Nada pela API/RPC/Admin.
- **Imutabilidade:** `_proteger_registro_imutavel` em cabeçalho e itens (como em `class_requirement_equivalencias`); RLS ligada, sem grant de escrita; um único mapa `publicado` por par (índice parcial único); uma atualização aplicada **fixa o hash da revisão** que usou, de modo que revisões novas não reinterpretam atualizações passadas.
- **"Assinado":** hash + identidade do aprovador + data gravados (autoria/auditoria, **não** assinatura digital ICP).

## 3. O que acontece com cada categoria na matrícula
| Categoria (mapa) | Estado do requisito na matrícula nova | Aprovação | Observações |
|---|---|---|---|
| `identico` com origem **aprovada** | `aprovado`, marca **herdada** (`identico`) | **nenhuma aprovação nova**; registro de herança aponta o `requirement_approvals` original (FK) | pessoa/avaliador originais, data e comentário ficam legíveis pela referência |
| `equivalente` com origem aprovada | `aprovado`, marca **herdada** (`equivalente`) | idem; o aviso mostra "cumprido na versão X como `<id origem>`" | ver D4: pode exigir ainda **confirmação** da liderança por item (modo estrito) |
| `identico`/`equivalente` com origem **não** aprovada | `nao_iniciado`; o `rascunho` da origem pode aparecer como **sugestão** (D3), não como envio | — | não se copia tentativa nem anexo |
| `alteracao_material` | `nao_iniciado` (pendente), com **link visível** para o histórico da origem ("já feito antes, na versão X, mas mudou") | nunca herdada | tentativas antigas ficam consultáveis, **não contam** |
| `novo` | `nao_iniciado` | — | |
| `removido` | **não vira requisito** da matrícula nova; aparece em "requisitos da versão anterior" (somente leitura, com status/aprovação) | a aprovação permanece no histórico da original | **arquivado visível**; nunca apagado |

**Nunca:** criar `requirement_approvals`, inventar `avaliado_por`, alterar `evidencia_*`, copiar imagem. A herança é um **registro próprio** (`requirement_inheritances`, §8) que referencia a aprovação original.

## 4. Estados e transições da atualização (máquina de estados)

`class_enrollment_updates.status`:
```
proposta ──► em_revisao ──► aguardando_aceite ──► aceita ──► aplicada ──► revertida
   │            │                 │   │                         
   │            │                 │   └──► adiada ──► (retoma) aguardando_aceite
   │            └──► rejeitada    └──► recusada
   └──► cancelada                (qualquer estado aberto) ──► obsoleta
```
| Transição | Quem | Pré-condições (todas conferidas no servidor) |
|---|---|---|
| criar `proposta` | liderança (`pode_avaliar_curriculo`) **ou** a própria pessoa (pede) — D2 | matrícula `em_andamento`, mesmo clube, versão vigente existe, **mapa publicado** para o par, nenhuma atualização aberta/aplicada para a matrícula (UNIQUE parcial), sem `aguardando_avaliacao` pendente, sem investidura em andamento, sem matrícula ativa na versão vigente |
| `em_revisao` | liderança | a proposta guarda **prévia completa + hash** (jsonb) calculada **pelo servidor** a partir do mapa; o cliente nunca escolhe equivalência |
| `aguardando_aceite` | liderança ≠ a própria pessoa | revisor não pode ser o candidato (regra "ninguém aprova o próprio") |
| `aceita` | **a pessoa**; se menor de 18, o **responsável vinculado** (portal de pais/consentimento de menor, migrations 14/69) | aceite explícito referencia **o hash da prévia** (o que ela viu é o que será aplicado) |
| `recusada` / `adiada` | pessoa/responsável | recusa não tem custo: matrícula segue exatamente como estava; adiar guarda `adiada_ate`; proposta nova só com motivo |
| `aplicada` | RPC única `classe_atualizacao_aplicar(update_id, hash)` | transação atômica (§5); idempotente |
| `obsoleta` | sistema | mapa nova revisão, matrícula mudou (estado/avaliação) depois do hash, versão vigente mudou |
| `revertida` | liderança, com motivo | §7 |

Prazo de validade da proposta aberta (ex.: 30 dias) para não acumular lixo — **D5**.

## 5. Aplicação atômica, idempotência e concorrência
**Uma transação** em `classe_atualizacao_aplicar`:
1. `pg_advisory_xact_lock` por `(usuario, clube, código oficial)` (mesmo padrão da 525) e `SELECT ... FOR UPDATE` na matrícula original e em todos os seus `member_requirements`.
2. Recalcula a prévia **no servidor** e compara o hash gravado no aceite; divergência ⇒ `obsoleta` + erro amigável ("a matrícula mudou; gere de novo"), nada gravado.
3. Cria a matrícula nova (função de criação já existente, **sem** disparar conclusão), cria `member_requirements` conforme o mapa, grava `requirement_inheritances`, marca a original `atualizada`, grava evento(s) e `_auditar`.
4. Chama **uma vez** a avaliação de conclusão no fim (o gatilho `avaliar_conclusao_classe` é `AFTER UPDATE OF status` e **não** dispara em INSERT já aprovado — hoje isso passaria despercebido).
5. Qualquer falha ⇒ rollback total (nenhum estado parcial).

**Idempotência:** `UNIQUE (de_member_class_id) WHERE status = 'aplicada'` e `UNIQUE (de_member_class_id) WHERE status IN (abertos)`; repetir a chamada devolve o mesmo resultado (mesma matrícula nova), sem segunda matrícula, sem segunda herança.
**Concorrência:** avaliação/envio na original durante a aplicação esperam o `FOR UPDATE` (as RPCs `requisito_enviar/avaliar` precisam travar na mesma ordem: matrícula → requisitos; **teste de deadlock** em §10); depois da troca, a original `atualizada` **recusa** novas tentativas/avaliações (estado terminal somente leitura). Duas aplicações simultâneas: a segunda espera e vê `aplicada` (idempotente). Dois usuários aceitando: o primeiro vence, o segundo recebe o estado atual.

## 6. Impactos em investidura, documentos, assinaturas, conquistas e fila
- **Investidura em andamento** (`requisitos_concluidos`, `aguardando_revisao`, `apto_investidura`, corrida `em_andamento`): atualização **recusada**. Já `investida`/`concluida`: **recusada** (a história é o snapshot selado; versão nova só vale para novas matrículas — e se a pessoa já concluiu, a 519/527 já impedem repetir). Corrida devolvida (matrícula voltou a `em_andamento` com requisitos em correção): permitida **apenas** se não há corrida aberta; os snapshots antigos permanecem `substituido`/`selado` na original.
- **Documentos/assinaturas/snapshots já emitidos:** imutáveis e válidos; nunca reemitidos pela atualização. O documento da **nova** matrícula (quando concluir) usa snapshot `conquista.snapshot_classe/2` com campo `herdado` por requisito ("Cumprido na versão 2026.3 — aprovado por X em D") — **mudança de formato versionada**, nunca retrocompatível silenciosa; o PDF/Edge Function só renderiza o que o snapshot declara e **recusa** requisito `aprovado` sem aprovação **nem** herança.
- **Conquista (527):** a original nunca concluiu ⇒ não há conquista dela. Se a nova concluir, `_classe_emitir_ou_reconhecer` age como sempre (1 ativa por pessoa+código). Reversão não revoga conquista (se existe conquista, a reversão é bloqueada: usar `snapshot_revogar` antes).
- **Fila de avaliação** (`fila_avaliacao_unificada`, `classe_avaliacoes_pendentes`): filtrar matrícula `atualizada`; nenhum item `aguardando_avaliacao` pode existir na original no momento da aplicação (pré-condição); a nova começa sem itens.
- **Painéis/coordenação/Jornada/Portfólio:** contagens excluem `atualizada` (não contar duas "em andamento"); `meu_portfolio` hoje lê **só** `requirement_approvals` ⇒ precisa ler também a herança (item de risco do doc anterior).
- **Rede/comunidade:** nada é publicado por atualização.

## 7. Reversibilidade (rollback lógico sem perder histórico)
`classe_atualizacao_reverter(update_id, motivo)` — liderança, nunca apaga:
- permitido só se a **nova matrícula não tem progresso próprio** (nenhuma tentativa/aprovação **depois** da herança), **sem** snapshot/conquista/investidura/documento na nova, e a original continua `atualizada` e sem corrida;
- efeito: nova matrícula → `cancelada` com motivo `atualizacao_revertida` (linhas e herança permanecem como histórico); original `atualizada` → `em_andamento`; update → `revertida`; evento append-only; aviso à pessoa;
- se a nova já tem progresso próprio: **bloquear** e orientar (concluir na nova, ou cancelar manualmente com o histórico mantido); decisão **D6**;
- a mesma pessoa pode, depois, **propor de novo** (nova proposta, nova prévia/hash); a trava de idempotência considera só `aplicada` vigente.
- `cancelada` hoje pode ser "ressuscitada" por `_classe_matricular`; o reabrir da original precisa de função própria que **não** passe por esse atalho (teste).

## 8. Esboço de dados (NÃO é migration)
```sql
-- mapa (cabeçalho) — publicado com a versão nova; imutável
create table public.curriculum_migration_maps (
  id uuid primary key default gen_random_uuid(),
  identificador text not null, versao_origem text not null, versao_destino text not null,
  revisao int not null check (revisao >= 1),
  status text not null check (status in ('publicado','substituido')),   -- rascunho/revisão vivem no repositório, não no banco
  hash text not null check (hash ~ '^[0-9a-f]{64}$'),
  elaborado_por text not null, aprovado_por text not null, aprovado_em date not null, aprovacao_referencia text not null,
  check (elaborado_por <> aprovado_por),
  foreign key (identificador, versao_origem)  references public.curriculum_versions (identificador, versao),
  foreign key (identificador, versao_destino) references public.curriculum_versions (identificador, versao),
  unique (identificador, versao_origem, versao_destino, revisao)
);
create unique index ux_map_publicado on public.curriculum_migration_maps (identificador, versao_origem, versao_destino) where status = 'publicado';

create table public.curriculum_migration_map_items (
  id uuid primary key default gen_random_uuid(),
  map_id uuid not null references public.curriculum_migration_maps(id),
  requisito_origem text, requisito_destino text,          -- manifesto_id
  classificacao text not null check (classificacao in ('identico','equivalente','novo','removido','alteracao_material')),
  justificativa text not null check (char_length(btrim(justificativa)) >= 10),
  fonte text not null check (char_length(btrim(fonte)) >= 10),
  check ((classificacao = 'novo'     and requisito_origem is null     and requisito_destino is not null)
      or (classificacao = 'removido' and requisito_origem is not null and requisito_destino is null)
      or (classificacao in ('identico','equivalente','alteracao_material') and requisito_origem is not null and requisito_destino is not null)),
  unique (map_id, requisito_origem), unique (map_id, requisito_destino)         -- 1:1; NULLs não colidem (novo/removido)
);
-- ambos: gatilho _proteger_registro_imutavel; RLS ligada; sem grant de escrita; leitura só por RPC/liderança

-- a atualização (proposta -> aplicada)
create table public.class_enrollment_updates (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.organizational_units(id),
  usuario_id uuid not null references public.profiles(id),
  de_member_class_id uuid not null references public.member_classes(id),
  para_member_class_id uuid references public.member_classes(id),            -- preenchido ao aplicar
  map_id uuid not null references public.curriculum_migration_maps(id), map_hash text not null,
  status text not null check (status in ('proposta','em_revisao','aguardando_aceite','aceita','adiada','recusada','aplicada','revertida','rejeitada','cancelada','obsoleta')),
  previa jsonb not null, previa_hash text not null,                          -- o que a pessoa viu e aceitou
  proposta_por uuid not null references public.profiles(id), revisado_por uuid references public.profiles(id),
  aceite_por uuid references public.profiles(id), aceite_papel text,         -- 'proprio' | 'responsavel'
  aceite_hash text, aceite_em timestamptz, adiada_ate date, aplicada_em timestamptz, revertida_em timestamptz, revertida_motivo text,
  created_at timestamptz not null default now(),
  check (revisado_por is distinct from usuario_id)                           -- ninguém revisa a própria
);
create unique index ux_update_aplicada on public.class_enrollment_updates (de_member_class_id) where status = 'aplicada';
create unique index ux_update_aberta   on public.class_enrollment_updates (de_member_class_id)
  where status in ('proposta','em_revisao','aguardando_aceite','aceita','adiada');

-- eventos append-only (auditoria própria; além de _auditar e class_completion_events)
create table public.class_enrollment_update_events ( id uuid primary key default gen_random_uuid(), update_id uuid not null references public.class_enrollment_updates(id),
  tipo text not null, ator_id uuid, ator_papel text, dados jsonb, created_at timestamptz not null default now() );

-- herança: nunca é aprovação; aponta a aprovação original
create table public.requirement_inheritances (
  id uuid primary key default gen_random_uuid(),
  update_id uuid not null references public.class_enrollment_updates(id),
  para_member_requirement_id uuid not null unique references public.member_requirements(id),
  de_member_requirement_id uuid not null references public.member_requirements(id),
  de_approval_id uuid not null references public.requirement_approvals(id),  -- NOT NULL: sem aprovação original não há herança
  map_item_id uuid not null references public.curriculum_migration_map_items(id),
  classificacao text not null check (classificacao in ('identico','equivalente')),
  created_at timestamptz not null default now()
);
-- member_classes.status ganha 'atualizada' (CHECK) e as leituras `<> 'cancelada'` passam a considerar o novo estado terminal;
-- gatilho: member_requirements.status='aprovado' só se existir requirement_approvals OU requirement_inheritances para ele (fecha o furo atual);
-- toda tabela nova termina com: select public._manutencao_instalar_guarda();   (teste 100)
```
RPCs (todas `security definer`, `search_path ''`, `clube_atual_id()`, `_exigir_classes_habilitado`): `classe_atualizacao_propor`, `_revisar`, `_aceitar`, `_adiar`, `_recusar`, `_aplicar(update_id, previa_hash)`, `_reverter`, `classe_atualizacao_ler` (a prévia 522 passa a ler o mapa; resposta idêntica para matrícula inexistente/de outro clube — sem oráculo).

## 9. Auditoria
`_auditar` para cada transição; `class_enrollment_update_events` (append-only) com ator, papel, hash, motivo; `class_completion_events` ganha tipos `matricula_atualizada` e `atualizacao_revertida` (CHECK ampliado, como na 330); sino/notificação à pessoa e à liderança; relatório "atualizações do clube" para a diretoria. O hash do mapa e o da prévia aparecem em toda leitura. Nenhum dado de criança sobe para coordenação (só números agregados).

## 10. PLANO DE TESTES (a escrever; não executado agora)
SQL (replay local, `run-tests.sh`) salvo indicação:
1. **Histórico íntegro após atualização:** hash/contagem de `member_requirements`, `requirement_submissions`, `requirement_approvals`, `class_documents`, snapshots e eventos da original idênticos antes e depois (comparação linha a linha, inclusive `created_at`).
2. **Equivalente herdado com rastreio:** mapa `equivalente` + origem aprovada ⇒ destino `aprovado`, `requirement_inheritances.de_approval_id` = aprovação original, **nenhuma linha nova** em `requirement_approvals`; leitura mostra "herdada" e o aprovador original.
3. **Idêntico herdado** (mesma verificação) e **idêntico recusado pelo validador se a assinatura difere** (vitest/node do manifesto).
4. **Tentativa de aprovação falsa bloqueada:** (a) `INSERT/UPDATE` de `member_requirements.status='aprovado'` sem aprovação nem herança ⇒ erro; (b) herança sem `de_approval_id` ⇒ erro; (c) chamar `_aplicar` com mapa adulterado/hash errado ⇒ erro; (d) cliente passando o próprio mapeamento/equivalência no corpo ⇒ ignorado; (e) escrita direta em `requirement_inheritances`/mapas pela API (anon/authenticated/liderança) ⇒ negada; (f) herdar de aprovação de **outra** pessoa ou de **outro** clube ⇒ erro.
5. **Origem não aprovada** (`em_andamento`, `correcao_solicitada`) nunca herda; `aguardando_avaliacao` **bloqueia** a aplicação.
6. **Alteração material** ⇒ pendente com link para histórico, **não** conta no percentual.
7. **Novo** ⇒ pendente; **removido** ⇒ fora da matrícula nova, visível na lista "versão anterior".
8. **Removido com tentativa aprovada:** a aprovação e a tentativa continuam na original, visíveis na leitura de histórico, não somem nem viram aprovação na nova.
9. **Mapa incompleto** (requisito sem linha) ⇒ validador recusa; sem mapa publicado ⇒ não há proposta; fusão/divisão marcada `equivalente` ⇒ recusada.
10. **Imutabilidade do mapa:** UPDATE/DELETE negados, mesmo para dono; nova revisão não altera atualização já aplicada (hash fixado).
11. **Atualização duplicada:** duas chamadas `_aplicar` sequenciais ⇒ mesmo resultado, uma só matrícula nova, uma só herança por requisito; segunda proposta enquanto há uma aberta ⇒ erro claro.
12. **Concorrência (2 sessões):** (a) duas `_aplicar` simultâneas ⇒ uma aplica, a outra devolve o mesmo; (b) `_aplicar` × `requisito_avaliar` na original ⇒ sem deadlock e sem aprovação perdida; resultado coerente com o hash (aprovação feita antes vira `obsoleta`/reprocessa; depois vira erro "matrícula atualizada"); (c) `_aplicar` × cancelamento da matrícula; (d) aceite duplo.
13. **Clube diferente:** liderança de outro clube, pessoa de outro clube, UUID forjado ⇒ mesma mensagem, sem oráculo; pessoa em dois clubes com a mesma classe: só a matrícula do clube em uso é afetada; header `x-clube-atual` trocado no meio ⇒ erro.
14. **Matrícula com investidura em andamento** (`aguardando_revisao`, `apto_investidura`, corrida aberta) ⇒ recusa; `investida`/`concluida` ⇒ recusa; devolvida a `em_andamento` ⇒ permitida só sem corrida aberta, snapshots antigos intactos.
15. **Papéis:** `pais`/`desbravador` não propõem por terceiros; candidato **não** revisa a própria atualização; menor de 18: aceite só do responsável vinculado (e **não** de um responsável de outra criança); adulto aceita sozinho.
16. **Aceite com hash desatualizado** (matrícula mudou entre aceite e aplicação) ⇒ `obsoleta`, nada gravado, mensagem amigável.
17. **Atomicidade:** falha forçada no meio (ex.: violação de constraint injetada num passo) ⇒ rollback total, original ainda `em_andamento`, nenhuma matrícula/herança/evento órfão.
18. **Conclusão por herança:** destino 100 % herdado ⇒ conclusão avaliada **uma vez**, snapshot `/2` com `herdado`, corrida de investidura normal; PDF recusa aprovado sem herança/aprovação.
19. **Conquista (527):** concluir a nova gera 1 ativa; pessoa com conquista ativa do mesmo código ⇒ atualização recusada; reversão com conquista ⇒ bloqueada.
20. **Fila/painéis:** matrícula `atualizada` fora de `fila_avaliacao_unificada`, `classe_avaliacoes_pendentes`, contagens do coordenador e jornada; `meu_portfolio` mostra a herança com proveniência.
21. **Rollback lógico:** reverter sem progresso ⇒ original volta a `em_andamento`, nova `cancelada` com histórico, nada apagado, comparação linha a linha do passo 1; reverter com progresso na nova ⇒ bloqueado; reverter com snapshot/investidura ⇒ bloqueado; **proposta nova** após reversão funciona; reabrir **não** passa pelo "ressuscitar" de `_classe_matricular`.
22. **Recusar/adiar:** recusa não altera nada; adiar até data e retomar; proposta expira; versão vigente trocada no meio ⇒ `obsoleta`.
23. **Regressão:** testes 31–39, 124–132 sem mudança; `classe_atualizacao_previa` mantém contrato (128); 523/526 intactos; teste 100 (guarda de manutenção) cobre as tabelas novas; modo manutenção bloqueia escrita.
24. **Storage:** anexos da original continuam acessíveis só a quem podia (policies atuais); a herança não amplia acesso; `_comprovacao_referenciada` enxerga referência herdada (evita GC futuro apagar arquivo ainda referenciado, `STORAGE-GC-DESENHO.md`).
25. **Vitest:** telas de proposta/revisão/aceite/aplicar; "herdada" com selo e link; texto de recusa sem custo; contrato `classes.js`; o app nunca oferece "atualizar" quando não há mapa.
26. **E2E (Supabase local):** Amigo 2026.3 → versão nova de teste com mapa fictício **assinado como fixture de teste** (não é conteúdo oficial): proposta → revisão → aceite do responsável (menor) → aplicação → continuar nova → concluir → investidura (fluxo regular completo) → verificar que o PDF da original ainda confere.

## 11. CRITÉRIOS PARA LIBERAR A IMPLEMENTAÇÃO (tudo precisa estar provado)
1. Decisões D1–D8 respondidas pelo dono e registradas neste documento.
2. **Mapa real**: pelo menos um par de versões com mapa **elaborado e aprovado por duas pessoas distintas** com fonte oficial, passando no validador (cobertura total, 1:1, `identico` conferido por assinatura) — sem isso não há o que testar nem aplicar.
3. Migração **só aditiva** provada por teste de contrato (testes 31–39, 124–132 verdes; `classe_atualizacao_previa` e 523/526 inalteradas).
4. Gatilho "aprovado exige aprovação ou herança" ativo **e** auditoria do banco local mostrando 0 linhas legadas violando (senão tratar antes).
5. Todos os cenários 1–24 acima verdes em replay do zero **e** em upgrade simulado; E2E 26 verde; concorrência (12) sem deadlock em ≥ 50 execuções repetidas.
6. Leituras que mostram "aprovado" (percentual, snapshot `/2`, PDF/Edge, portfólio, investidura_cartao, requisito_historico, painéis) todas cobrem herança/proveniência — lista de varredura com teste que falha se uma nova leitura ignorar a herança.
7. Ensaio num **banco local isolado com dados sintéticos** que reproduzam a forma do caso real (matrícula em versão arquivada, como a do Guia 2026.2 do Tenant 001), sem ler produção; qualquer conferência do Tenant 001 em produção só com autorização explícita do dono, na fase de deploy.
8. Texto de UX revisado pelo dono (recusa sem custo; "herdada"; aceite do responsável) e política LGPD para menor confirmada.
9. Plano de rollback testado (cenário 21) e script de produção idempotente, sem `begin/commit` dependente (o SQL Editor não segura transação), aprovado explicitamente pelo dono — implementação continua **proibida** sem essa autorização.

## 12. DECISÕES do dono
- **D1.** Quem tem autoridade para **aprovar** um mapa (e quem elabora)? Dois nomes distintos são obrigatórios?
- **D2.** Quem pode **propor**: só liderança, ou também a própria pessoa/responsável?
- **D3.** Rascunho/andamento de requisito pendente (`rascunho`): aparece como sugestão ou é descartado?
- **D4.** Herança de `equivalente`: automática ao aplicar, ou exige confirmação da liderança por item (modo estrito)?
- **D5.** Validade de uma proposta aberta e política de lembrete ao responsável.
- **D6.** Reversão com progresso novo na matrícula nova: bloquear (recomendado) ou permitir com histórico?
- **D7.** Versões que **exigem** atualização por mudança normativa (OMD): continua sempre opcional, ou haverá casos de obrigatoriedade com prazo? (hoje: nunca obrigatória).
- **D8.** A atualização vale também para Classes Avançadas e, no futuro, Liderança (ver `CLASSES-LIDERANCA-ARQUITETURA.md`) com o mesmo mapa/fluxo?
- **D9.** Matrículas já `investida`/`concluída`: confirmar que **nunca** são atualizadas (recomendado).
- **D10.** A matrícula real em versão arquivada (Guia 2026.2, Tenant 001): permanece e conclui na 2026.2 (decisão de 01/10), confirmada como caso-piloto **apenas simulado**?
