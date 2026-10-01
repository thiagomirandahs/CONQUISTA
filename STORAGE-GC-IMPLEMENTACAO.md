# GC seguro do Storage — IMPLEMENTAÇÃO (Fase 9, 01/10/2026)

Status: **ferramenta de RELATÓRIO pronta e testada localmente. NADA apaga arquivo.** Atualiza o
`STORAGE-GC-DESENHO.md` (28/09). Cobre o item 13 de `PENDENCIAS-FASE8-CLASSIFICADAS.md` (arquivo plantado em
`conclusao-anterior`) e o risco nº 1 do desenho (expurgo de clube deixa arquivo físico órfão).

## 1. O que foi entregue

| Peça | Onde | O que faz |
|---|---|---|
| Catálogo de referências | migration **531**, `_storage_referencias()` | Lista versionada: qual tabela/coluna guarda caminho de arquivo, em qual bucket, de que forma (exato / texto dentro de JSON) e se é histórico imutável. 47 entradas (35 exceções justificadas). |
| Exceções justificadas | `_storage_referencias_excecoes()` | Colunas com nome "de arquivo" que NÃO apontam para o Storage (ex.: `fonte_url`, `pdf_hash`, `tipo_evidencia`), cada uma com o motivo. |
| Trava de schema | teste SQL **135** | Varre o `information_schema`: coluna nova com nome de caminho/foto/arquivo/url/anexo/logo… fora do catálogo e das exceções **falha o teste**. Bucket novo sem decisão também falha. |
| Inventário/fatos | `_storage_gc_fatos(listagem, dias)` / `_storage_gc_inventario(dias)` | Por arquivo: tamanho, idade, clube (ativo/lixeira/expurgado), nº de referências, se está na fila da Rede e a **categoria**. Só leitura (`STABLE`). Sem permissão para `anon`/`authenticated`. |
| Relatório do admin | RPC `admin_storage_gc_relatorio(p_dias, p_amostra)` | Só admin da plataforma. Contagens, bytes, buckets e amostra com **caminho mascarado** (UUID cortado em 8 caracteres, nome do arquivo some, fica a extensão). Nenhum dado pessoal. |
| Lógica pura | `src/lib/storageGc.js` (+ `storageGc.test.js`) | Mesma regra do SQL em JavaScript; o script confere as duas e acusa **divergência**. Tem uma rede de segurança (`conferirInvariantes`) que aborta o relatório se algum candidato violar uma exclusão. |
| Dry-run | `scripts/storage-gc-dryrun.mjs` | `--db` obrigatório, transação `READ ONLY`, relatório humano + JSON. `--aplicar` **não existe** (recusa com código 3). |
| Listagem da API | `scripts/storage-gc-listar-api.mjs` | Só `list()`: gera o JSON de arquivos físicos para achar os que **não têm linha** em `storage.objects`. |

## 2. Categorias

**Candidatas** (o que SERIA removido numa fase futura, autorizada à parte):

1. `orfao` — existe em `storage.objects`, nenhuma tabela do catálogo referencia, bucket no escopo, idade ≥ carência.
2. `arquivo_sem_linha` — existe fisicamente (listagem da API) mas não tem linha em `storage.objects`; sem referência; idade ≥ carência.
3. `clube_expurgado` — prefixo `<club_id>/` de clube com `clube_exclusoes.status = 'expurgado'` (a migration 280 só apaga a linha).
4. `conclusao_anterior_sem_registro` — pasta `<club>/<membro>/conclusao-anterior/` sem `curriculum_achievements.comprovante_path`. Motivo `sem_registro` (formato certo) ou `formato_invalido` (arquivo plantado fora do padrão).

**Nunca candidatas** (exclusões obrigatórias):

- `referenciado` — qualquer tabela/coluna/JSON do catálogo cita o caminho (URL do Storage é normalizada). Inclui os históricos imutáveis (snapshots, tentativas, logs, documentos, assinaturas).
- `protegido_bucket` — `documentos-emitidos`, `assinaturas-desenhadas`, `publico`, `parceiros` (documento emitido, assinatura e marca; logos antigas só são **relatadas**).
- `em_fila_de_remocao` — já está em `rede_fotos_para_apagar` (a rotina da Rede cuida).
- `clube_na_lixeira` — clube excluído mas recuperável.
- `recente` — menos que a carência. **Mínimo 7 dias, inegociável** (`--dias 1` vira 7; carência só pode subir).
- `bucket_fora_do_escopo` — bucket que ninguém catalogou (falha fechada). Hoje o escopo é `comprovacoes`, `imagens`, `comunidade`, `suporte-anexos`.
- `sem_data` — item de listagem sem data de criação.
- `sem_linha_referenciado` — existe fisicamente, é referenciado, mas não tem linha em `storage.objects` (anomalia a investigar).

**Só relatado**: referência quebrada (tabela aponta para objeto inexistente), por origem. Linhas que admitem arquivo já apagado (foto da Rede após a vida útil, documento da idade depois da aprovação) não contam como quebra.

## 3. Procedimento do dry-run em PRODUÇÃO (somente leitura)

Quem roda: o dono da sessão, depois de revisar este documento. **Nenhum passo apaga nada.**

**Passo 0 — aplicar a migration 531.** Ela é aditiva: só cria funções (nenhuma tabela, nenhuma alteração de dado, nenhuma policy). Mesmo método das demais: SQL Editor, com o conteúdo do arquivo `supabase/migrations/20260930000531_storage-gc-catalogo-e-relatorio.sql` e a linha do ledger. Conferir o Tenant 001 antes e depois (não muda). Se preferir não aplicar nada em produção, o dry-run em uma cópia restaurada do backup dá o mesmo relatório.

**Passo 1 — relatório do banco** (somente leitura; use uma conexão de **leitura**, ex.: a URL do pooler com um papel só de leitura se existir; a transação já é `READ ONLY`):

```bash
node scripts/storage-gc-dryrun.mjs --db "postgresql://USUARIO:SENHA@HOST:5432/postgres?sslmode=require" \
  --dias 7 --rotulo producao-AAAA-MM-DD --json relatorio-gc.json
```

A URL é informada por você, na hora; o script nunca lê `.env`, variável de ambiente ou arquivo de produção para achar o banco, e não imprime a URL.

**Passo 2 (opcional, recomendado) — achar arquivo físico sem linha** (sobra do expurgo):

```bash
# a chave de serviço fica numa variável de ambiente CUJO NOME você escolhe; ela não vai na linha de comando
node scripts/storage-gc-listar-api.mjs --url https://SEU-PROJETO.supabase.co --chave-env NOME_DA_VARIAVEL --saida listagem.json
node scripts/storage-gc-dryrun.mjs --db "..." --listagem listagem.json --json relatorio-gc.json
```

Só `list()` é chamado; não há `remove()` em nenhum dos dois scripts.

**O que conferir no relatório**

1. Cabeçalho: `NADA foi apagado`, `somente_leitura: true`, `carencia_dias >= 7`. **`divergencias_sql_js` = 0** (se não for, não confie na lista).
2. **Total de objetos/bytes** bate com a ordem de grandeza conhecida (~447 objetos / 672 MB). Muito diferente = alvo errado.
3. **`referenciado` é a maior categoria** e `por_bucket` mostra 0 candidatos em `documentos-emitidos`, `assinaturas-desenhadas`, `publico`, `parceiros`.
4. **Candidatos**: espere sobretudo `orfao` em `imagens` (foto de perfil trocada deixa a anterior). Olhe a amostra mascarada: caminhos de requisito/documento da criança em `comprovacoes` como `orfao` merecem investigação (pode ser coluna não catalogada).
5. **`referencias_quebradas`**: valores altos em uma origem indicam arquivo sumido (ou catálogo errado). Só informativo.
6. **`conclusao_anterior_sem_registro` / `formato_invalido`**: conferir se existe tentativa de plantio; é o item 13 das pendências.
7. **`clube_expurgado` / `arquivo_sem_linha`** (com listagem): esses são os arquivos que a 280 deixou no backend — a prioridade LGPD.
8. Avisos no fim do resumo (ex.: "sem listagem da API").
9. Sem `--incluir-caminhos` o JSON é mascarado e pode ser compartilhado. Com `--incluir-caminhos` (exige `--json`) ele traz a lista completa de candidatos: **arquivo sensível, não compartilhar, não commitar**.

Alternativa sem script: logado como admin da plataforma, `select public.admin_storage_gc_relatorio(7, 10);` devolve o mesmo resumo (sem a parte da listagem).

## 4. Decisões pendentes do dono (atualizadas)

**D1 — Carência.** 7 dias é o piso fixo e o padrão. Mais dias = menos risco de pegar upload em andamento / rede ruim (a criança com 4G fraco pode enviar a foto e só salvar o requisito dias depois, se o aparelho ficar offline com rascunho); menos dias não é possível. Recomendação: 7 para o dry-run; **30** quando houver exclusão real.

**D2 — Expurgo de clube (migration 280).** Hoje apaga só a LINHA de `storage.objects`; o arquivo físico (inclusive foto de criança) fica órfão e invisível.
- *Opção A (recomendada):* nova migration troca o `delete from storage.objects` por uma fila `storage_expurgo_fila(club_id, bucket, name)`; uma Edge Function apaga pela API (`remove()`), com log. Implica: tabela nova (+ `_manutencao_instalar_guarda`), Edge Function nova, e o expurgo passa a ser "lento": a LGPD é cumprida quando a fila esvazia.
- *Opção B:* manter como está e usar este GC (`clube_expurgado` + `arquivo_sem_linha`) como faxina manual periódica. Implica: arquivo de criança fica no backend até alguém rodar a faxina, e depende de listagem da API (a linha já se foi).
- *Até decidir:* nenhum expurgo novo deveria ser feito sem rodar a listagem antes (a linha é o único rastro).

**D3 — Anexos de suporte** (`suporte-anexos`). *Apagar quando o chamado fecha + N dias:* economiza cota, perde evidência de atendimento (definir N: 30/90). *Manter:* custo de armazenamento e retenção de imagem que o usuário mandou ao suporte. Hoje o GC só os trata se órfãos (sem `suporte_mensagens`).

**D4 — Quem aprova a lista e como (nova).** Qualquer remoção futura exige: lista gerada por este dry-run **com caminhos completos**, aprovada pelo dono (arquivo assinado/versionado fora do git), validade curta (ex.: 24 h), variável de confirmação, `--aplicar` numa fase própria com reconferência item a item e remoção só pela API. *Opção:* aprovação por categoria (ex.: só `clube_expurgado`) ou por lista item a item. Recomendação: começar só por `clube_expurgado` + `arquivo_sem_linha` (LGPD), depois `orfao` de `imagens`.

**D5 — Logos antigas e buckets públicos (nova).** `publico` e `parceiros` ficam fora (marca). Cada troca de logo deixa a anterior para sempre. Decidir se vale uma regra à parte (ex.: manter a atual e a anterior). Impacto: baixo (poucos KB).

**D6 — Fotos de perfil órfãs em `imagens` (nova).** É a maior fonte esperada de órfãos (`perfis/<uid>-<ts>`). Apagar é seguro pela regra (nada referencia), mas a Rede (migration 470) deixa a foto de perfil visível a outros por caminho: confirmar que nenhum link/cache em uso aponta para foto antiga antes de aprovar.

**D7 — Rotina periódica.** Só **relatório** semanal (dry-run) depois de 4 semanas revisadas, como no desenho; apagar continua ação humana.

## 5. Garantias e como estão testadas

- *Nunca candidato se referenciado / recente / bucket protegido / fila / lixeira / fora do escopo:* `src/lib/storageGc.test.js` (lógica) e `supabase/tests/135_storage_gc_relatorio.sql` (SQL, com referência por URL, caminho puro, JSON e registro real de `curriculum_achievements`).
- *Catálogo não apodrece:* teste 135 (coluna nova sem mapa, exceção/coluna inexistente, bucket novo).
- *Relatório sem dado pessoal e só do admin da plataforma:* teste 135 (nenhum UUID/caminho/nome no JSON; diretoria, membro e anônimo recusados; `storage.objects` intacto).
- *Script só lê:* teste vitest (sem `--db` recusa; `--aplicar`/`--apagar`/`--remover`/`--delete`/`--executar` recusam com código 3; não lê ambiente nem `.env`; sem `remove`/`delete`/DDL; `begin read only` + `default_transaction_read_only=on`) e a migration 531 é verificada por varredura (sem `delete`/`insert`/`update`/`create table`).
- *Sem remoção automática:* não existe cron, Edge Function nem RPC de remoção nesta fase.

## 6. Limitações conhecidas

- Referências em texto livre (`contem`) casam por substring do caminho: preferem proteger a mais (nunca a menos).
- URL com caracteres escapados (`%20`) no banco é decodificada só no lado JS; os nomes gerados pelo app são ASCII seguros, então o SQL não decodifica.
- Objetos de clube expurgado cujo caminho é legado (`<uid>/…`) não mostram o clube; aparecem como `orfao`/`arquivo_sem_linha` genéricos.
- Para volumes bem maiores (dezenas de milhares de objetos) o inventário faz uma busca por objeto nos blobs de histórico; hoje (≈447 objetos) é instantâneo. Revisar se crescer.
