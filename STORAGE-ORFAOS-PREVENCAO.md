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
