# Prevenir NOVOS arquivos órfãos no Storage (Fase 9, 01/10/2026)

Status: **migration 532 + Edge Function `storage-excluir` prontas e testadas SÓ localmente. Nada foi aplicado em produção, nenhuma função foi publicada, o cron nasce DESLIGADO.**
Complementa `STORAGE-GC-IMPLEMENTACAO.md` (que limpa o que JÁ é órfão) e `STORAGE-GC-AUDITORIA-88-E-INVENTARIO.md`.

## 1. Causa

Quatro caminhos do app removem ou trocam a LINHA do banco e nunca o ARQUIVO do Storage:

| Caminho | Onde no código | O que sobra |
|---|---|---|
| Apagar atividade | `Atividades.jsx` -> `from('atividades').delete()`; `entregas.atividade_id` é `on delete cascade` | foto/vídeo de cada entrega (`entregas.foto_url`, bucket `comprovacoes`) |
| Apagar foto do mural | `services/mural.js` `excluirFoto` apaga só a linha de `fotos` | `fotos.url` e `fotos.thumb` (bucket `imagens`) |
| Trocar foto de perfil | `services/usuarios.js` `atualizarFotoPerfil` (caminho novo a cada troca: `perfis/<uid>-<ts>`) | o arquivo da foto anterior (`profiles.foto`) — o órfão mais comum |
| Reenviar entrega / apagar entrega | `entregas` update/delete | o arquivo anterior |

O SQL não consegue apagar arquivo físico (apagar a linha de `storage.objects` deixa o arquivo no backend; é o problema da migration 280), então a correção tem de passar pela API do Storage, com cuidado: apagar arquivo errado é irreversível.

## 2. Desenho (fila + carência + reverificação + API do Storage)

```
 app (delete/update na tabela)
   -> gatilho AFTER (security definer, nunca falha a operação do usuário)
        enfileira o caminho ANTIGO que estava no banco  ---> public.storage_exclusao_fila (pendente, processar_apos = +7 dias)
 cron (DESLIGADO) -> storage_exclusao_rotina() -> pg_net -> Edge Function storage-excluir (header x-storage-excluir-secret)
   1. rpc _storage_exclusao_processar(8): reserva (FOR UPDATE SKIP LOCKED + reservado_ate 10 min), REVERIFICA, devolve só os excluíveis
   2. storage.remove([caminho])  <- caminho que o BANCO devolveu (o corpo da requisição é ignorado)
   3. rpc _storage_exclusao_confirmar(bucket, caminho, ok, codigo): 'excluido' só depois da API confirmar
```

### Tabela `storage_exclusao_fila`
`bucket, caminho, origem (tabela.coluna), motivo (apagado|trocado), dono_linha, dono_confere, enfileirada_em, processar_apos, estado (pendente|excluido|mantido|falhou), tentativas, ultima_mensagem (código curto, sem dado pessoal), reservado_ate, resolvida_em`; `unique (bucket, caminho)`. RLS ligado, sem policy, sem grant: só service_role/postgres.

### Quem enfileira (gatilhos `zz_storage_exclusao_*`)
`fotos` (url, thumb) · `entregas` (foto_url) · `missoes_feitas` (foto_url) · `devocional` (foto_url) · `profiles` (foto) · `unidades` (emblema, bandeira). Todas essas colunas já estão no catálogo da 531.
- O valor vem **sempre do que estava gravado no banco** (`old`), normalizado por `_storage_ref_chave` (URL pública/assinada ou caminho puro -> `bucket/caminho`). Não existe RPC de enfileiramento para o app (`_storage_exclusao_enfileirar` não é executável por anon/authenticated).
- Não enfileira: valor que não mudou, `null`, URL externa, rota interna, bucket fora dos 4 elegíveis, caminho com `..`, `//`, barra no início/fim, caractere de controle ou > 512, e valor que **ainda está em outra linha/coluna da própria tabela**.
- Enfileira mesmo que outra TABELA ainda referencie o arquivo (conferir todas as tabelas dentro da transação do usuário seria uma varredura do catálogo inteiro por linha apagada): a decisão completa é do processador. Isso é a única diferença em relação a "não enfileirar nada que tenha outra referência"; a garantia de segurança (nunca excluir referenciado) é do processador.
- Erro dentro do gatilho é engolido e vira registro em `infra_falhas` (`storage/exclusao-gatilho`): o usuário nunca perde a operação por causa da fila (provado no teste 137).
- Re-enfileirar: item `excluido|mantido|falhou` volta a `pendente` com carência nova; `pendente` mantém a carência mais longa.

### O processador `_storage_exclusao_processar(p_limite)` (service_role/postgres)
Para cada item vencido e não reservado (lote máximo 20; a função usa 8), nesta ordem:
1. bucket elegível (`imagens`, `comprovacoes`, `comunidade`, `suporte-anexos`; **nunca** `publico`, `parceiros`, `documentos-emitidos`, `assinaturas-desenhadas`) -> senão `mantido: bucket_nao_elegivel`;
2. caminho sem `..`/`//`/controle -> senão `mantido: caminho_invalido`;
3. **dono do caminho = dono da linha** (`dono_confere`: o 1º ou 2º segmento é o id do dono, ou começa com `<id>-`) -> senão `mantido: dono_diferente`. É isto que impede forjar `foto_url` apontando para o arquivo de OUTRA pessoa;
4. o objeto existe em `storage.objects` -> senão `mantido: objeto_ausente`;
5. catálogo completo da 531 via `_storage_gc_fatos` (uma passada para o lote): qualquer referência em tabela viva, JSON ou histórico imutável -> `mantido: referenciado`; fila da Rede -> `em_fila_de_remocao`; clube na lixeira -> `clube_na_lixeira`; outras categorias não candidatas -> `mantido: <categoria>`;
6. objeto com menos de 7 dias de idade (`recente`) -> continua `pendente`, reagendado para quando completar 7 dias;
7. só `orfao` ou `clube_expurgado` é devolvido. O SQL nunca apaga arquivo.

### Confirmação `_storage_exclusao_confirmar(bucket, caminho, ok, msg)`
- `ok = true` -> `excluido`, **só** se o item foi entregue pelo processador (`reservado_ate` não nulo; senão `nao_reservado`, sem efeito). Idempotente (repetir devolve o estado atual; falha tardia não desfaz `excluido`).
- `ok = false` -> tentativas + 1, recuo 1 h · 2^(n-1) (1 h, 2 h, 4 h, 8 h); na 5ª vira `falhou` e gera linha em `infra_falhas` (`storage/exclusao`). Falha NÃO é escondida.
- A mensagem é limpa (uuid vira `<id>`, só `A-Za-z0-9_ .:<>-`, 120 caracteres): nada de caminho nem dado pessoal. A Edge Function manda apenas códigos (`removido`, `ja_ausente`, `erro_api 502`).

### Visibilidade
`admin_storage_exclusao_resumo()` (só admin da plataforma): contagens por estado, motivos de `mantido`, pendentes por bucket, vencidas agora e as últimas 20 falhas (bucket, origem, tentativas, código, data) — **sem caminho**.

### Edge Function `supabase/functions/storage-excluir`
`verify_jwt = false` + segredo `STORAGE_EXCLUIR_SECRET` no header `x-storage-excluir-secret` (comparação em tempo constante, falha fechada: sem segredo ou errado = 401, nada é tocado), igual a `sanear-imagens`. 1 lote de 8 por chamada; só apaga o que o banco devolveu; segunda trava em `_compartilhado/storage-excluir.ts` (bucket elegível + caminho seguro) antes do `remove()`; logs só com contagens.

## 3. Ordem de publicação (nada disto foi feito)

1. **Migration 532** em produção (SQL Editor, método de sempre: idempotente, sem `begin/commit`, conferir Tenant 001 antes/depois, linha no ledger). É aditiva: 1 tabela, funções e 6 gatilhos AFTER. **A partir daqui a fila começa a se encher**, mas nada é apagado (cron desligado, sem função).
2. **Deploy da função** `storage-excluir` + secret `STORAGE_EXCLUIR_SECRET` + Vault (`storage_excluir_url`, `storage_excluir_secret`, mesmo valor do secret). Teste manual com `curl` sem/ com segredo errado (401) e, com o segredo certo, fila vazia (`reservados: 0`).
3. **Ligar o cron SÓ com autorização do dono**: `select cron.alter_job((select jobid from cron.job where jobname='storage-excluir'), active := true);`. Antes de ligar, olhar `admin_storage_exclusao_resumo()` e a lista de `pendente`.
4. Depois de alguns ciclos: conferir `mantido` por motivo (muitos `referenciado` é normal) e zero `falhou`.

Como a carência é de 7 dias, mesmo com tudo ligado o primeiro arquivo só pode ser apagado 7 dias depois do evento.

## 4. Riscos e limites

- **Janela entre a reverificação e o `remove()`** (segundos): se, nesse intervalo, alguém passar a referenciar o arquivo (só é possível para quem já sabe o caminho exato) ele seria removido. Mitigação: carência de 7 dias, lote pequeno, dono do caminho obrigatório. Residual aceito; se o dono quiser zerar, a função pode chamar uma rechecagem final por item (custo: mais uma passada de catálogo).
- **Custo do catálogo**: cada processamento com itens vencidos faz uma passada completa em `_storage_referencias()` (47 consultas). Com lote de 8 a cada 15 min, e só quando há item vencido, é irrelevante na escala atual.
- **Escala do gatilho**: a checagem "ainda em outra linha da tabela" é um `exists` sem índice; em tabela com dezenas de milhares de linhas e exclusão em massa (expurgo de clube) isso custa. Se virar problema, criar índice parcial na coluna.
- **Fila cresce** se o cron ficar desligado (1 linha por arquivo trocado/apagado): desprezível.
- **Comparação bruta no gatilho**: o mesmo arquivo guardado uma vez como caminho e outra como URL não é reconhecido como "outra referência" no gatilho; o processador reconhece (normaliza).
- **Nome com caractere especial na URL** (`%20`): o catálogo compara texto cru; os caminhos do app são `uuid`/timestamp, sem esse caso.
- **Eventos fora das 6 tabelas** (ex.: `member_requirements.evidencia_path` trocado, `suporte_mensagens.anexo_path`) não enfileiram; o histórico imutável (`requirement_submissions`) mantém o arquivo vivo de propósito, e o GC cuida do resto.

## 5. O que NÃO resolve

- Os **88 arquivos que já são órfãos** (86 seguros, 2 indeterminados) continuam com o GC de `STORAGE-GC-IMPLEMENTACAO.md`/`STORAGE-GC-AUDITORIA-88-E-INVENTARIO.md`; a fila só vê eventos DEPOIS da 532. Um backfill seria uma decisão à parte.
- O expurgo de clube (migration 280) deixa arquivo físico órfão em tabelas fora destes 6 gatilhos (e a linha de `storage.objects` some sem a API); o GC (`clube_expurgado`) continua necessário. Onde o expurgo apagar linhas das 6 tabelas, os gatilhos também enfileiram.
- Arquivos de logo no bucket `publico`/`parceiros` (protegidos) não entram.
- Nenhuma mudança de UI.

## 6. Fluxos do front que apagam arquivo por conta própria (apenas listados, NADA alterado)

Todos recebem o caminho do próprio fluxo do app (não da fila) e dependem das policies de Storage; nenhum usa a fila:
- `src/lib/upload.js` `descartarComprovacao` (`comprovacoes`, só o dono apaga o que ninguém referencia — migration 173);
- `src/lib/imagens/upload.js` `removerComSeguranca` (exige `clubId` e caminho do clube; "NÃO é GC", ninguém chama automaticamente);
- `src/services/classesAnteriores.js` `apagarEnviado`, `src/services/documentoIdade.js` `apagarArquivo`, `src/services/comunidade.js` e `src/services/rede.js` `apagarArquivo` (limpeza de upload cujo registro falhou).

## 7. Testes

- SQL **137** (`supabase/tests/137_storage_exclusao_fila.sql`, 129 asserts): gatilhos (atividade em cascata, foto url+thumb, avatar, não-mudança, outra linha), carência, referenciado/nova referência, objeto novo, ataque de caminho forjado (dono do caminho != dono da linha), bucket protegido na fila, caminhos maliciosos, reserva/expiração, confirmação idempotente, falha com recuo e teto, mensagem sem uuid, resumo do admin sem caminho, gatilho que não derruba a operação, cron desligado, anon/authenticated sem acesso a nada. Ajustes em `20_matriz_de_auditoria.sql` (exceção declarada da nova tabela) — teste desatualizado, regra mantida; a 135 passa sem mudança graças às 2 exceções novas em `_storage_referencias_excecoes()`.
- Vitest `src/lib/storageExcluirServidor.test.js` (15): bucket elegível, caminho seguro, tradução da resposta da API, contrato da função.
- E2E real local `npm run test:storage-exclusao:e2e` (34 verificações): Storage real + função no edge-runtime (porta 54398): o arquivo físico só some depois da carência, sem referência, >7 dias, dono certo; referenciado/forjado/`publico` permanecem; 4 chamadas simultâneas nunca apagam o mesmo item duas vezes.
- `npm run test:edge:bundle` empacota a nova função.

## 8. Decisões do dono

1. **Carência**: 7 dias é o piso do GC (inegociável) e o valor adotado. Subir é só mudar `carencia_dias` na política.
2. **Ligar o cron** (e quando): só depois de 532 + função + secret + Vault. Sugestão: ligar, observar 2 dias, conferir `admin_storage_exclusao_resumo()`.
3. **Backfill dos 88 órfãos**: continua fora; decidir à parte (via GC existente).
4. **Gatilho em mais tabelas** (ex.: `suporte_mensagens`, evidências em andamento): hoje só as 6 de arquivo "próprio e sem histórico".
5. **Rechecagem final por item** antes do `remove()` (fecha a janela de segundos): aceitável hoje; opcional.
6. **Chave de rotação do segredo** `STORAGE_EXCLUIR_SECRET`: seguir o padrão de `SEGURANCA-ROTACAO-DE-CHAVES.md`.

## 9. Migration 533 — lacunas que a 532 não cobria (Fase 9, 01/10/2026, só local, NÃO publicada)

Arquivo: `supabase/migrations/20260930000533_storage-exclusao-lacunas.sql`. **Aditiva**: não cria tabela, não altera nenhuma função/gatilho/RPC da 532 nem do app, não faz backfill, não apaga nada. Reutiliza a fila, a política (carência 7 dias, lote máximo 8, 4 buckets elegíveis), `_storage_exclusao_enfileirar`, `_storage_exclusao_processar` (revalida tudo, inclusive o histórico imutável) e `_storage_exclusao_confirmar`; a exclusão física continua só na Edge Function `storage-excluir`. O caminho vem sempre do valor OLD guardado no banco; não existe RPC de enfileiramento.

### 9.1 Lacunas cobertas (cada uma comprovada no schema/RPC/front)

| Tabela.coluna | Evento que deixa o arquivo órfão (evidência) | Gatilho 533 | Dono da linha |
|---|---|---|---|
| `member_requirements.evidencia_path` | `requisito_salvar` faz `evidencia_path = coalesce(p_evidencia_path, evidencia_path)` (troca a foto; `src/services/classes.js` envia foto nova a cada salvar); DELETE por cascata (matrícula/usuário/clube) | UPDATE OF + DELETE | `usuario_id` |
| `member_requirements.rascunho_anexos` (jsonb `[{path,...}]`) | `requisito_relatorio_salvar` regrava a lista inteira (`rascunho_anexos = coalesce(p_anexos,'[]')`, migrations 510/514): anexo removido da lista fica órfão | UPDATE OF + DELETE | `usuario_id` |
| `member_specialty_requirements.evidencia_path` / `rascunho_anexos` | idem, `especialidade_requisito_salvar` / `especialidade_requisito_relatorio_salvar` (511/514) | UPDATE OF + DELETE | `usuario_id` |
| `experiences.imagem_path` | `experiencia_salvar` troca o caminho (`coalesce(...)`, 049); DELETE de experiência; `experiencia_nova_versao` copia o mesmo caminho (por isso o processador mantém o que a cópia ainda usa) | UPDATE OF + DELETE | `criado_por` |
| `experience_submissions.arquivo_path` | **`experiencia_etapa_enviar` faz UPSERT** (`on conflict (participation_id, stage_id, ocorrencia) do update set arquivo_path = excluded.arquivo_path`, 049 linha 988): reenviar a etapa troca o arquivo; DELETE por cascata da experiência/participação | UPDATE OF + DELETE | `usuario_id` |
| `suporte_mensagens.anexo_path` | **`suporte_rotina()` (cron `suporte-rotina`, ativo) apaga chamado `fechado` há 2+ anos** e as mensagens vão em cascata; exclusão de conta (`auth.users` cascade) também; o cabeçalho da 290 já avisava "o arquivo do anexo fica órfão" | só DELETE (mensagem nunca é editada) | `autor_id` |

**Correção da análise anterior** (`FASE9-PRIVACIDADE-MIDIA-ANALISE.md` §9 dizia "nenhum update/delete" para `experience_submissions.arquivo_path` e `suporte_mensagens.anexo_path`): estava errada. A busca por `update` não enxergou o **upsert** de `experiencia_etapa_enviar`, e a busca por `delete` não enxergou o expurgo de `suporte_rotina()` nem a cascata de conta. Por isso as duas entraram (não é mecanismo hipotético: os dois fluxos existem hoje). Nada ficou em "SEM FLUXO ATUAL" por esse critério.

### 9.2 Como funciona

- Função nova `_storage_exclusao_gatilho_jsonb()` (a `_storage_exclusao_gatilho` publicada na 532 não foi tocada). Argumentos: coluna do dono + `'coluna:bucket'` (texto) ou `'coluna[]:bucket'` (array jsonb de `{path}`).
- Enfileira só o que estava no OLD e **não está em nenhuma coluna vigiada da linha nova** (comparação por `bucket/caminho` normalizado: caminho puro e URL pública do mesmo arquivo são o mesmo arquivo); no DELETE, tudo que estava no OLD. O caminho **novo nunca entra**; a mesma foto regravada não enfileira; o mesmo arquivo nas duas colunas (foto + anexo) gera uma linha só; trocar de novo antes da carência cai no upsert da 532 (mesma linha, `processar_apos` nunca encurta).
- Não faz a varredura "o valor ainda está em outra linha da tabela" que a 532 faz (seria seq scan numa tabela quente): essa checagem fica toda no processador, que consulta o catálogo (`_storage_referencias`) na hora de excluir. Efeito: mais itens entram na fila e viram `mantido:referenciado` (ex.: foto já ENVIADA que sai do rascunho, protegida pelo histórico `requirement_submissions`); nenhum é excluído por engano.
- Gatilhos de UPDATE são `AFTER UPDATE OF <colunas> ... WHEN (old.col is distinct from new.col)`: o autosave que regrava o mesmo valor, e qualquer update de outra coluna, **nem executam a função**.
- Falha para o lado seguro: dono nulo/diferente (`dono_confere = false`) = o processador mantém (`mantido:dono_diferente`). Imagem de experiência sem `criado_por`, ou criada por outra liderança que não o criador, fica órfã de propósito.
- O gatilho nunca falha a operação do usuário (erro engolido + `infra_falhas`), como na 532.

### 9.3 O que continua fora (monitorar)

- Nenhuma coluna de arquivo conhecida ficou sem cobertura. Seguem fora, por desenho: `comprovacoes_documento.evidencia_path` (a foto do documento já é apagada pelo app depois da conferência, migration 380), `curriculum_achievements.comprovante_path` (histórico), buckets `publico`/`parceiros`/`documentos-emitidos`/`assinaturas-desenhadas` (protegidos) e os 88 órfãos antigos (GC existente).
- **Monitorar**: se aparecer UI que grave `experiences.imagem_path` (hoje nenhuma tela do `src/` grava; só a RPC aceita o campo), definir a convenção de pasta `<uid>/experiencias/...` para o dono conferir; sem isso a maioria das imagens trocadas ficará `mantido:dono_diferente`.
- `suporte_mensagens`: o primeiro expurgo real só ocorre 2 anos depois dos primeiros chamados fechados (central de chamados nasceu em 09/2026); a cobertura está pronta e testada com a rotina real.

### 9.4 Ordem de publicação

1. Aplicar a **migration 533** (única etapa). A Edge Function `storage-excluir`, o secret, o Vault e o cron já são os da 532; **nada mais para publicar**. Pré-condição: 532 aplicada (produção está nela). Sem 533, nada muda; com 533 e cron desligado, a fila só acumula itens (inofensivo).
2. Ligar o cron continua sendo a decisão do dono (§8 item 2), agora cobrindo também essas tabelas.
3. Front: nenhuma mudança (compatível com o front de HEAD e com o publicado 62c3665: nenhuma assinatura de RPC mudou; ver 9.6).

### 9.5 Riscos e custo (medido, banco local, 2000 updates em `member_requirements`, transação com rollback)

| Cenário (N = 2000) | com gatilho | sem gatilho | extra por update |
|---|---|---|---|
| autosave: rascunho muda, anexos/foto iguais (WHEN corta) | 113 ms | 184 ms | ~0 (ruído) |
| update de coluna não vigiada (`updated_at`) | 569 ms | 622 ms | ~0 (ruído) |
| **pior caso**: cada update troca a foto (enfileira o antigo) | 1344 ms | 339 ms | **+0,50 ms** |
| cada update troca 1 de 2 anexos | 1482 ms | 504 ms | **+0,49 ms** |

Leitura: o caso comum (salvar rascunho sem trocar arquivo) não paga nada; trocar arquivo custa ~0,5 ms por save (um upsert na fila). Em DELETE em cascata o custo é por linha apagada (limpeza de clube grande enfileira N linhas de uma vez; carência de 7 dias dilui o processamento). A fila cresce com itens `mantido`/`excluido` (linhas pequenas, sem dado pessoal); considerar purga de `excluido/mantido` antigos no futuro. Cada save de rascunho continua gravando `member_requirements` como já gravava (a 533 não adiciona escrita quando nada muda).

Outros riscos: (a) o `UPDATE OF ... WHEN` depende de o app gravar a coluna; migrations futuras que tragam novas colunas de arquivo precisam do gatilho (o teste 135 já cobra o catálogo, a 138 conta os gatilhos); (b) volume de `mantido:referenciado` por fotos já enviadas — esperado.

### 9.6 Testes e compatibilidade

- SQL **138** (`supabase/tests/138_storage_exclusao_lacunas.sql`, 99 asserts, estável em 3 execuções seguidas; derrubar um gatilho faz ~51 asserts falharem): troca/remoção/DELETE por tabela, array jsonb (item removido, reordenado, trocado, esvaziado, não-array), mesma foto em URL, não duplica nem encurta, histórico imutável, voltou a ser referenciado (mesma linha e outra linha), forjado (arquivo de outro usuário, UUID inexistente, dono nulo), bucket protegido por URL, objeto ausente/novo, carência, lote máximo 8 (12 itens → 8 | 4 | 0), reserva sem duplicidade, idempotência, falha da Edge Function (recuo, 5ª = `falhou` + `infra_falhas`), gatilho que nunca derruba a operação, expurgo real do suporte (`suporte_rotina()`), upsert real de etapa de experiência. Foto trocada pela RPC real `requisito_salvar`.
- E2E real local `npm run test:storage-exclusao-533:e2e` (28 verificações, função na porta 54397): arquivo antigo some fisicamente, novo permanece; voltou a ser referenciado / outra linha / tentativa enviada / forjado NÃO somem; DELETE da linha; limpeza final com 0 objetos, 0 fila e 0 `infra_falhas`. Os E2E 532 (34) e saneamento (45) seguem verdes.
- Compatibilidade: a 533 só cria 2 funções internas novas e 9 gatilhos (nenhuma assinatura de RPC do app muda). `contrato-rpc-front.mjs` com o `src` de HEAD (338 RPCs) e com o front publicado 62c3665 (337 RPCs) contra o banco com 533: todas existem; `npm run test:compat:front-antigo` 11/11, 15/15, 12/12.

### 9.7 Decisões do dono (533)

1. Aprovar a 533 como está (cobre as 6 colunas acima) e a ordem "só migration".
2. **Imagem de experiência**: aceitar o dono = `criado_por`, e definir a pasta `<uid>/experiencias/` quando houver tela de upload.
3. **Suporte**: confirmar que o anexo deve sair junto com o expurgo de 2 anos (e na exclusão de conta); alternativa é manter o arquivo (sem gatilho).
4. Aceitar que arquivo **enviado** (histórico) nunca é apagado pela fila, só o rascunho abandonado.
5. Purga futura de linhas `excluido`/`mantido` da fila (hoje não há).
