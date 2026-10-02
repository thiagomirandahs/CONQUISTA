# Investigação (somente leitura): variação do Storage, fila `profiles.foto`, 3 órfãos e os 12 que cruzam 30 dias

Produção, 02/10/2026 ~11:00 UTC (08:00 BRT). **APAGADOS: 0. Nenhuma escrita, nenhum enfileiramento, nenhuma Edge Function chamada, nenhum arquivo baixado.**
Só consultas de leitura (`default_transaction_read_only=on`) e leitura local de dumps (`pg_restore -f -`, sem restaurar).
Ids são `left(md5(valor),8)` (objetos: md5 do caminho; donos: md5 do uuid, 5 caracteres). Nenhum nome, e-mail, texto ou caminho completo.
Observação: os hashes deste documento são `md5(name)` e **não** coincidem com os hashes usados em `PRE-JANELA-CHAVES-APP-ERROS-PUSH-ORFAOS.md` (outro esquema de hash). A correspondência está na tabela C.

---

## (A) Variação do Storage entre a janela da 533 (01/10 ~22:2x UTC) e agora

Atual (confirmado agora): 362 objetos / 596.969.119 B.

| Bucket | Antes (obj / B) | Agora (obj / B) | Delta |
|---|---|---|---|
| comunidade | 10 / 1.120.919 | 7 / 721.987 | **-3 obj / -398.932 B** |
| imagens | 285 / 376.612.314 | 288 / 376.643.632 | **+3 obj / +31.318 B** |
| comprovacoes | 63 / 219.437.604 | 63 / 219.437.604 | 0 |
| publico | 4 / 165.896 | 4 / 165.896 | 0 |
| **total** | 362 / 597.336.733 | 362 / 596.969.119 | 0 obj / **-367.614 B** |

-398.932 + 31.318 = -367.614. A conta fecha ao byte.

### A.1 comunidade: -3 objetos / -398.932 B = limpeza de stories da Rede (cron `rede-limpar-fotos`)
- `cron.job_run_details` (job 30, `rede_limpeza_rotina()`): 02/10 05:35:00,32 UTC, `succeeded`. (O cron só dispara a rotina; o resultado vem do log da própria Rede.)
- `rede_limpeza_log` da Edge Function `limpar-fotos-rede` (origem `edge`): **02/10 05:35:03,17 UTC: 3 arquivos, 398.932 B, 0 erros**. Marcação (origem `marcacao`) no mesmo minuto: 3 stories.
- As 3 linhas de `rede_fotos_para_apagar` marcadas em 02/10 (motivo `story`) somam 143.145 + 112.408 + 143.379 = **398.932 B** (ids `808e931a`, `e258c815`, `a8162930`), `apagada_em` = 02/10 05:35:03,17; hoje 0 desses caminhos em `storage.objects`.
- Os 3 stories (`rede_stories`: `e175940f`, `98b2ab19`, `4a28d48b`) tinham `expira_em` entre 01/10 20:41 e 02/10 00:09 (24 h depois de publicados) e `foto_apagada_em` = 02/10 05:35:03,17. Exatamente o desenho (stories expiram em 24 h, limpeza 05:35 UTC).
- Estado da fila da Rede agora: 11 linhas históricas, **todas** com `apagada_em` preenchido, 0 pendentes, 0 com erro, 0 tentativas; 7 objetos restantes em `comunidade`, todos referenciados (idades 1,45–3,6 d).
- Mesma rotina já tinha rodado em 01/10 05:35 (1 story, 87.062 B + 1 foto de post, 123.163 B = 210.225 B), **antes** da janela da 533; não entra neste delta.

### A.2 imagens: +3 objetos / +31.318 B = três fotos de perfil novas
Objetos criados/alterados em `imagens` depois do baseline (consulta por `created_at`/`updated_at` > 01/10 22:00 UTC):

| Obj | pasta | tamanho | mime | criado (UTC) | observação |
|---|---|---|---|---|---|
| `94c2a6c6` | perfis/<uid>-ts.jpg | 9.672 | image/jpeg | 01/10 23:08:33 | enviada com 9.808 B e **regravada pelo `imagem-sanear`** (`imagem_saneamento`: saneada, 9.808 -> 9.672, 23:10:01). Só o tamanho final conta |
| `a9fead44` | perfis/<uid>-ts.webp | 12.876 | image/webp | 02/10 00:47:15 | saneamento: `ja_limpa`. **É o objeto da fila da parte B** (foto trocada 4 min depois) |
| `7d094bc1` | perfis/<uid>-ts.webp | 8.770 | image/webp | 02/10 00:51:33 | saneamento: `ja_limpa`. É a foto atual em `profiles.foto` |

9.672 + 12.876 + 8.770 = **31.318 B**. Bate exatamente.
Além disso houve um objeto **transitório**: `27c5dc6a` (`<uid>/documentos/<ts>.jpg`, foto de documento, 158.597 -> 158.461 B regravada pelo saneamento em 01/10 23:20:02) que existia no meio da janela e **hoje não existe mais** (apagado pelo fluxo de foto de documento da migration 380, que apaga depois da aprovação). Subiu e saiu depois do baseline: efeito líquido zero no delta (e por isso não aparece na soma acima).
`imagem_saneamento`: 102 linhas `ok` no total; as 4 acima são as únicas movimentadas desde 01/10 22:00 UTC. A regravação do saneamento só reduz bytes (-136 B por JPEG; webp sem mudança), nunca gera objeto novo.

### A.3 comprovacoes e publico
Sem mudança (63 / 219.437.604 B e 4 / 165.896 B). Nenhum upload, nenhuma exclusão.

### A.4 Conferências
- `select count(*) from _storage_gc_quebradas()` = **0** referências quebradas.
- `_storage_gc_fatos(null,30)` por categoria (obj / bytes):

| Bucket | Categoria | Obj | Bytes | Idade (d) min–max |
|---|---|---|---|---|
| comprovacoes | referenciado | 50 | 141.979.167 | 0,68–34,42 |
| comprovacoes | recente | 12 | 49.441.373 | 27,78–28,65 |
| comprovacoes | orfao | 1 | 28.017.064 | 30,53 |
| comunidade | referenciado | 7 | 721.987 | 1,45–3,60 |
| imagens | referenciado | 266 | 368.841.497 | 0,42–93,91 |
| imagens | recente | 20 | 6.781.582 | 0,43–23,71 |
| imagens | orfao | 2 | 1.020.553 | 62,34–82,84 |
| publico | referenciado | 1 | 45.018 | 5,87 |
| publico | protegido_bucket | 3 | 120.878 | 5,87 |

(Soma = 362 obj.) Só 3 órfãos, idêntico ao relatório pré-janela.

**Classificação de A: ESPERADO.** Diferença inteiramente explicada por (i) 3 stories expirados apagados pela rotina diária da Rede, (ii) 3 fotos de perfil novas (uma já regravada pelo saneamento) e (iii) um objeto de documento que veio e foi. Nada de bug, nada de objeto sumido sem registro, 0 quebradas.
Limite honesto: o baseline foi fornecido por total/bucket, não por lista de objetos; a prova é aritmética + timestamps (soma exata nos dois buckets). Objetos que tenham entrado e saído com efeito líquido zero entre 22:2x e hoje só seriam visíveis se deixassem rastro (o do documento deixou, via `imagem_saneamento`).

---

## (B) Item pendente da fila `storage_exclusao_fila` (`profiles.foto`)

Único registro da tabela (estados: 1 `pendente`, nenhum resolvido).

| Campo | Valor |
|---|---|
| Objeto antigo | `a9fead44`, bucket `imagens`, `perfis/<uid>-<ts>.webp`, 12.876 B, image/webp |
| origem / motivo | `profiles.foto` / `trocado` |
| `dono_confere` | **true** (o 2º segmento do caminho começa com o uuid do dono da linha, `dono_linha`) |
| `enfileirada_em` | 02/10 00:51:34,12 UTC |
| `processar_apos` | 09/10 00:51:34,12 UTC |
| **carência** | `processar_apos - enfileirada_em` = **7 dias exatos** |
| estado / tentativas / reserva | pendente / 0 / sem reserva, sem mensagem |
| objeto no Storage | **existe** (`created_at` 02/10 00:47:15, 0,43 d de idade; `updated_at` igual) |
| avatar NOVO | `7d094bc1` (criado 00:51:33,84, **0,3 s antes** de enfileirar), **referenciado** por `profiles.foto` do mesmo dono (1 linha); `_storage_gc_fatos` -> `referenciado`, referencias = 1 |
| antigo referenciado? | `_storage_gc_fatos`: referencias = **0**, categoria `recente`. `profiles` com o caminho antigo: 0. `_storage_gc_referencias_coletar()` (catálogo completo, formas `exato` e `contem`): **0 linhas** para o par (antigo) e 0 em blobs |
| Enfileirador | única função que insere na fila é `_storage_exclusao_enfileirar` (só gatilhos). Nada enfileira órfão automaticamente; `reconciliar-armazenamento` (cron 22) não apaga objeto nem toca a fila |

Observação do cenário: a pessoa subiu uma foto às 00:47 e trocou por outra às 00:51 (4 min). A antiga (webp pequeno, 12 KB) ficou sem referência, exatamente o caso de "trocado" que a 532 trata.

### O processador revalida tudo? Leitura de `_storage_exclusao_processar` (migration 532; conferido contra a definição em produção)
Confirmado que a função em produção contém as mesmas travas (`dono_diferente`, `objeto_ausente`, chamada a `_storage_gc_fatos(v_fonte, v_dias)`, categorias `orfao`/`clube_expurgado`). Sequência a cada execução (cron `storage-excluir`, a cada 15 min; só dispara se houver item vencido; segredos `storage_excluir_url/secret` do Vault existem):
1. Só pega `estado='pendente'`, `processar_apos <= now()` e sem reserva ativa (`FOR UPDATE SKIP LOCKED`, lote máx. 8; reserva 10 min).
2. Sem catálogo: bucket precisa estar em `buckets_elegiveis` (imagens, comprovacoes, comunidade, suporte-anexos), caminho sem `//`, `..`, controle, e **`dono_confere` tem de ser true** (flag gravada no enfileiramento) e o **objeto tem de existir** (`objeto_ausente` -> `mantido`).
3. Catálogo completo numa passada (`_storage_gc_fatos` com a carência de 7 dias): `referenciado` -> `mantido` (nunca apaga); `em_fila_de_remocao`, `clube_na_lixeira`, bucket protegido etc. -> `mantido`; **`recente` (< 7 dias de idade do objeto) -> continua `pendente` e reagenda**; só `orfao` ou `clube_expurgado` é devolvido para exclusão.
4. A exclusão física é da Edge Function (API do Storage); o SQL só reserva e confirma (`_storage_exclusao_confirmar` só aceita item reservado).
Pontos de atenção (não bloqueiam): `dono_confere` é revalidado pela flag gravada, não recalculado ao processar (a flag foi calculada com o caminho real e é imutável para este item: confere); a idade e as referências são recalculadas na hora, então se o objeto antigo voltasse a ser referenciado (ex.: foto de perfil restaurada), o item viraria `mantido`.

**Elegível em: 09/10/2026 00:51:34 UTC (08/10 21:51 BRT)**; o cron seguinte (a cada 15 min) deve processar no máximo ~15 min depois. Nesse momento o objeto terá 7,0 d de idade (>= carência).
**Seguro aguardar: SIM.** Nada a fazer; nenhum item da fila pode ser executado antes de 09/10 e, se algo mudar até lá, a revalidação segura o item.

---

## (C) Os 3 órfãos (categoria `orfao`, `_storage_gc_fatos(null,30)`)

Todos com **0 referências** e **não** na fila 532. NÃO apagados. Idades de hoje 11:00 UTC.

| Item | Bucket | Mime | Tamanho | Criado (UTC) / idade | Origem do caminho | Dumps em que aparece (`storage.objects` / tabela referenciadora) | Cópia local | Classificação |
|---|---|---|---|---|---|---|---|---|
| **A** `eca3a3c2` (pré-janela: `fac1a2bb`) | comprovacoes | video/quicktime (`.mov`) | 28.017.064 B | 01/09 22:12:08,88 / **30,53 d** | `<uid>/atividades/<ts>.mov` = `subirComprovacao(tipo 'atividades')` em `Atividades.jsx` (entrega de atividade com vídeo) | 4/4 dumps (pre-fase8, pre-fase9, pre-533, referencia-limpa, todos de 01/10) em `storage.objects` e `club_storage_objetos`; **0** em `entregas`/`missoes_feitas`/`fotos` | existe cópia em `storage-2026-10-01/comprovacoes` (28.017.064 B, igual) | **INDETERMINADO -> PRESERVAR** (duplicata provável, não provada) |
| **B** `bfc0c424` (pré-janela: `4bdb99ef`) | imagens | image/jpeg | 151.135 B | 11/07 14:52:52 / 82,84 d | legado `atividades/<atividade>-<pessoa>-<ts>.jpg` (entrega de atividade no bucket `imagens`, antes de existir `comprovacoes`) | 4/4 dumps em `storage.objects` e `club_storage_objetos`; 0 em tabelas referenciadoras (nos dumps de 30/09 e 01/10 a pessoa já não tem perfil nem entrega) | existe cópia em `storage-2026-10-01/imagens` | **SEGURO (candidato)**, com autorização do dono |
| **C** `459389ee` (pré-janela: `6462631f`) | imagens | image/heic | 869.418 B | 01/08 02:54:49,98 / 62,34 d | legado `atividades/<atividade>-<pessoa>-<ts>.heic` | 4/4 dumps em `storage.objects`/`club_storage_objetos`; 0 em tabelas referenciadoras | existe cópia em `storage-2026-10-01/imagens` | **INDETERMINADO -> PRESERVAR** até decisão do dono |

(Backups de storage anteriores a 01/10 não existem em disco; só `storage-2026-10-01`, baixado em 01/10 13:05–14:15 antes de qualquer exclusão. Os dumps de banco de 30/09 e 01/10 estão listados abaixo; **dump de 24/09 não está nesta máquina**, a referência a ele vem dos documentos anteriores.)

### C.B (JPG, 82 d): por que virou órfão
- Atividade existe (prazo 11/07; hoje 12 entregas). A pessoa do caminho **não tem perfil, nem membership, nem entrega hoje**. Ela ainda existe em `auth.users` (conta de admin da plataforma, sem vínculo de clube). Nos dumps de 30/09 (`pre-fase6`, `pre-fase7`) e 01/10 ela já não tem perfil/entrega. Conclusão: a entrega foi apagada junto com o perfil antes de 30/09 e, como a trava 532 só existe desde 01/10, o arquivo ficou. Isto conversa com a conclusão anterior (entrega aprovada existia no dump de 24/09). **Não provado** aqui porque o dump de 24/09 não está disponível; é a única parte herdada.
- Valor para o usuário: nenhum previsível (a entrega que ele comprovava já não existe). Seguro, condicionado à autorização.

### C.C (HEIC, 62 d): por que é indeterminado
- Atividade existe (prazo 31/07, `Serviços`, 50 pts; 9 entregas). A pessoa **existe** e tem 2 entregas aprovadas (05/07 jpg e 13/07 heic), **nenhuma** para esta atividade. O upload é de 01/08 02:54 UTC = **31/07 23:54 no horário de Brasília**, 6 min antes do fim do prazo. Há outras 2 fotos da mesma pessoa na pasta de atividades, ambas referenciadas.
- Hipóteses (nenhuma provada): upload concluído e o `upsert` em `entregas` nunca chegou; ou a pessoa desistiu; ou o envio falhou no fim do prazo. Não há prova de que a pessoa tenha tentado de novo (0 entrega para o par).
- Privacidade: é um HEIC original (não saneado, EXIF/GPS possível) de um menor, ou seja, apagar é benéfico, mas o valor para o usuário (uma entrega que nunca foi registrada) só o dono pode decidir.

### C.A (o `.mov` de 28 MB): evidências comparadas só por metadados

| | Objeto A (órfão) | Objeto B (`b267ec88`, referenciado) |
|---|---|---|
| pasta / dono | mesma pessoa, mesma pasta `atividades` | idem |
| mime / bytes | video/quicktime / **28.017.064** | video/quicktime / **28.017.064** |
| `contentLength` do metadata | 28.017.064 | 28.017.064 |
| timestamp do nome (início do envio no cliente) | 01/09 22:11:10 | 01/09 22:12:25,9 (+75,45 s) |
| `created_at` no Storage (fim do envio) | **22:12:08,877** | **22:12:52,01** (+43,13 s) |
| duração do envio (nome -> criado) | ~58 s | ~26 s |
| ETag | `b668...-2` (multipart, 2 partes) | `c099...-2` (multipart, 2 partes) — **diferentes** |
| referenciado por | nada (0) | `entregas` 216507df, status **aprovada**, 2000 pts, `created_at` 22:12:52,388 (**0,38 s depois** do objeto B) |
| atividade | `24f52` (Espiritual, 2000 pts, criada 01/09 21:53, prazo 01/09, 4 entregas) | idem |
| apareceu em dumps | `storage.objects` e `club_storage_objetos` (4/4); **nunca** em `entregas` | em `storage.objects` e **em `entregas`** (4/4) |

A pessoa tem 4 entregas no total (3 em julho: 2 reprovadas e 1 aprovada; 1 em 01/09, aprovada) e **exatamente 2** objetos nesta atividade: A (órfão) e B (referenciado). Não há terceiro.

**Provado (por metadados do banco, sem baixar):**
1. A e B são do mesmo dono, mesma pasta, mesmo mime, **mesmo tamanho ao byte**, criados a 43 s um do outro.
2. B é o objeto da entrega aprovada; A nunca foi referenciado em `entregas`/`missoes_feitas`/`fotos` em nenhum dos 4 dumps (todos de 01/10) nem hoje. A entrega foi gravada 0,38 s depois de B, não depois de A (se A tivesse gerado a entrega, `created_at` seria ~22:12:08).
3. Cronologia coerente com "envio, nada acontece na tela, a pessoa tenta de novo": A terminou, 17 s depois começou B.
4. Não há nenhum outro objeto da pessoa que concorra por ser a "versão boa" de A.

**NÃO provado:**
1. Que o **conteúdo** de A seja igual ao de B. Os ETags são diferentes; ambos são multipart ("-2"). Em multipart, o ETag é o MD5 dos MD5 das partes + nº de partes; mudam se o conteúdo muda **ou** se os limites das partes mudam (o envio do `supabase-js` é uma POST única e o servidor fatia em partes; não verifiquei se a fatiagem é determinística). Logo ETag diferente **nem prova diferença nem prova igualdade**.
2. Que A seja uma "tentativa falha" e não um arquivo diferente (outro vídeo do mesmo tamanho em bytes, improvável mas possível, p. ex. o mesmo vídeo recomprimido pelo iOS com tamanho idêntico: raro, mas não excluído).
3. Que a pessoa **não tenha valor** em A (se A fosse outro vídeo, só A o conteria).
4. A **assinatura mágica/duração** do arquivo (exigiria ler o conteúdo).

**Classificação: INDETERMINADO -> PRESERVAR.** "30 dias" não torna seguro. Pelos dados, duplicata de envio é a explicação mais provável (mesmo dono, mesmo bytes, 43 s, só B virou entrega), mas não é prova.

**Como provar duplicidade sem baixar de produção (procedimento futuro, não executado):**
1. Só com autorização do dono do clube/Thiago (é vídeo de menor). Nunca assistir ao vídeo; só calcular hash.
2. O arquivo de A **e** de B **já existem em disco local** (`storage-2026-10-01/comprovacoes`, mesmos 28.017.064 B, copiados em 01/10 13:05-14:15 antes de qualquer exclusão). Máquina local, offline: `sha256sum` dos dois (ou `cmp`); não precisa baixar nada novo de produção. Iguais -> duplicata comprovada (cópia local vira a prova, A pode entrar no lote seguro). Diferentes -> A é conteúdo próprio: fica preservado e o dono decide (devolver à pessoa, ou apagar com ciência).
3. Registrar só os dois sha256 + hashes curtos no manifesto do GC (sem caminho), com data e quem autorizou.
4. Alternativa de baixo custo sem tocar em bytes: pedir ao Storage um HEAD com `If-None-Match` não ajuda (ETag multipart); o hash local é o caminho.

---

## (D) Os 12 objetos que cruzam 30 dias em 03–04/10

Todos em `comprovacoes`, `<uid>/atividades/<ts>.<ext>`, categoria `recente`, referencias = **0** hoje, nenhum na fila 532. Soma 49.441.373 B (47,2 MiB). Cruzam 30 d entre **03/10 19:19 UTC** e **04/10 16:20 UTC**. Dono = md5 do uuid (5 caracteres).

| # | Obj | Dono | Tamanho (B) | Mime (ext.) | Criado UTC | Cruza 30 d (UTC) | Grupo |
|---|---|---|---|---|---|---|---|
| 1 | `733b4440` | `435e5` | 17.224.187 | video/mp4 (`.mp4`), multipart | 03/09 19:19:09 | 03/10 19:19 | G3 |
| 2 | `2965d0fa` | `fa9d0` | 1.936.316 | video/quicktime (`.mp4`) | 03/09 19:26:24 | 03/10 19:26 | G1 |
| 3 | `b4fd0dde` | `fa9d0` | 1.936.316 | idem | 03/09 19:26:29 | 03/10 19:26 | G1 |
| 4 | `2f2db017` | `fa9d0` | 1.936.316 | idem | 03/09 19:26:42 | 03/10 19:26 | G1 |
| 5 | `9c834891` | `fa9d0` | 1.022.495 | video/quicktime (`.mov`) | 03/09 19:29:51 | 03/10 19:29 | G2 |
| 6 | `795e0efe` | `fa9d0` | 1.022.495 | idem | 03/09 19:29:55 | 03/10 19:29 | G2 |
| 7 | `8590f919` | `e1900` | 105.372 | image/jpeg | 04/09 15:42:10 | 04/10 15:42 | G4 |
| 8 | `0f5e6ed3` | `435e5` | 92.950 | image/jpeg | 04/09 15:44:08 | 04/10 15:44 | G4 |
| 9 | `320706c1` | `fa9d0` | 377.694 | image/jpeg | 04/09 15:45:29 | 04/10 15:45 | G4 |
| 10 | `fdf87a16` | `59559` | 78.078 | image/jpeg | 04/09 15:46:11 | 04/10 15:46 | G4 |
| 11 | `cfcf82f0` | `8e496` | 42.372 | image/jpeg | 04/09 15:58:41 | 04/10 15:58 | G4 |
| 12 | `5b028d6d` | `5da28` | 23.666.782 | video/mp4 (`.mp4`), multipart | 04/09 16:20:59 | 04/10 16:20 | G4 |

Notas de leitura: 6 pessoas distintas (`435e5` aparece 2x; `fa9d0` aparece 6x). Perfis: 4 desbravadores e 2 conselheiros, todos ativos.

### Padrões e provas por metadados
- **G1 (#2-#4): mesma pessoa, mesmo vídeo 3x em 18 s.** Os 3 têm **o mesmo ETag, sem sufixo de partes** (`ade8b05b...`): em upload de parte única o ETag é o MD5 do corpo, então os 3 arquivos têm **conteúdo MD5-idêntico (provado entre eles)**. Idem **G2 (#5, #6)**: 2x em 4 s, mesmo ETag `7ea6459d...`, também MD5-idêntico. Isto é prova real de duplicidade **entre as cópias**, não de que haja um gêmeo referenciado.
- **Nenhuma dessas cópias tem gêmeo referenciado**: nenhum objeto referenciado de `comprovacoes` com o mesmo tamanho (0 em todos os 12), nenhuma entrega da pessoa nos ±10 min, nem no dia seguinte (para `fa9d0`: 0 entregas de 02 a 06/09). Ou seja, ao contrário de A, estes 12 **não são sombra de uma entrega aprovada**: se todos forem apagados, **o único exemplar do conteúdo enviado some do Storage** (resta apenas a cópia local de 01/10, ver observação abaixo).
- **G3 (#1)**: um mp4 de 17 MB (multipart), pessoa com entrega aprovada no dia anterior (02/09 21:20, jpg, atividade `bd7c9`); a nova tentativa de 03/09 não virou entrega. Sem gêmeo.
- **G4 (#7-#12): 6 pessoas diferentes em 38 minutos (04/09 15:42-16:20)**, 5 fotos e 1 mp4, **nenhuma com entrega**. Quatro dessas pessoas (`e1900`, `435e5`, `5da28`, `8e496`) já tinham entrega aprovada na atividade anterior em 02/09; `fa9d0` e `59559` não tinham entrega em 02/09.

### Contexto que explica o padrão (provado no banco)
- **Não havia atividade aberta em 03–04/09.** Última atividade aberta: `bd7c9` (prazo 02/09, 5 entregas, última 02/09 23:19). A próxima, `d8c4a`, só foi criada em 16/09. O app esconde atividades com prazo vencido de quem não é liderança (`Atividades.jsx`: `prazoEncerrado`), e **o servidor não confere prazo** na entrega (nenhuma regra em migration). Então os envios de 03–04/09 só se explicam por (i) tela já aberta de 02/09 (cliente não reavalia o prazo), (ii) atividade que o cliente ainda mostrava por data local, ou (iii) outro motivo de falha do registro. **Não provado** qual.
- Quatro das seis pessoas (`435e5`, `5da28`, `8e496`, `fa9d0`) fizeram entrega **aprovada** na atividade seguinte (`d8c4a`, 16-18/09). `e1900` e `59559` não.

### Classificação antecipada
Nenhum é REFERENCIADO (0 refs). Nenhum em uso hoje.

| Grupo | Objetos | Classificação antecipada | Motivo provável |
|---|---|---|---|
| G1 | #2, #3, #4 | **POSSÍVEL ÓRFÃO, MD5-idênticos entre si.** Duplicata de envio **provada** entre as 3 cópias; **não** há entrega que as referencie | Mesmo vídeo 3x em 18 s por uma pessoa: upload concluído, registro não gravado, tocou de novo, de novo |
| G2 | #5, #6 | idem (2 cópias, 4 s) | idem |
| G3 | #1 | **INDETERMINADO** (único exemplar, sem gêmeo, sem entrega) | upload sem registro |
| G4 | #7-#12 | **INDETERMINADO**: 6 pessoas, 6 objetos, sem entrega, atividade fechada | upload sem registro, possível atividade encerrada |

Cópias locais: **verificado, os 12 têm cópia em `storage-2026-10-01/comprovacoes`** (backup de 01/10, feito antes de qualquer exclusão). Isso reduz o risco de perda, mas é uma única cópia fora do Storage, sem redundância.

### O que acontece quando cruzarem
**Nada, automaticamente.** Cruzar 30 d só muda a categoria de `recente` para `orfao` em `_storage_gc_fatos`. Não existe cron nem função que exclua órfão: a única entrada na fila de exclusão é `_storage_exclusao_enfileirar` (acionada por UPDATE/DELETE de linha, não por idade), e o `storage-excluir` só processa a fila. A 4/10 16:20 UTC (13:20 BRT), nenhum dos 12 será tocado.

### Proposta (decisão do dono; nada executado)
1. **Antes de 03/10 19:19 UTC:** nada precisa ser feito para proteger; a categoria passará a `orfao` mas ninguém apaga.
2. **Dupla checagem local de G1/G2** (autorizada, só hash): como o ETag de parte única é o MD5 do corpo, a duplicidade já está provada. Decisão do dono: manter **1 cópia por grupo** (a mais antiga) e liberar as outras 2 (G1) e 1 (G2) para o lote seguro, ou preservar tudo.
3. **G3 e G4 (9 objetos, 6 pessoas):** não apagar sem decisão. Opções: (a) perguntar às pessoas se queriam registrar a entrega; (b) preservar por tempo definido (p. ex. 60 d) e reavaliar; (c) apagar com autorização, ciente de que é o único exemplar.
4. Corrigir a causa (já feito localmente, commit `606e56a`, ainda não publicado): descartar o upload quando o registro falha; e considerar validar o prazo no servidor (hoje só o cliente esconde).

---

## Conferência final
- Referências quebradas: **0**.
- Categorias de `_storage_gc_fatos(null,30)`: 3 órfãos, 12 recentes (comprovacoes) + 20 recentes (imagens), restante referenciado/protegido (tabela A.4).
- Cron `storage-excluir` a cada 15 min, 1 item pendente (vence 09/10 00:51 UTC), 0 resolvido, 0 falha.
- **APAGADOS: 0.**
