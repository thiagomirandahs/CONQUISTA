# CONSENTIMENTO DE IMAGEM — auditoria e desenho técnico (Fase 6, item 6 · 30/09/2026)

**Escopo desta rodada:** entender o estado atual e, SE possível sem mudar o fluxo jurídico, criar a estrutura técnica de
auditoria. **Nenhum texto jurídico foi escrito.** Nada muda para o usuário (mesmos dois booleanos, mesma tela).

## 1. Estado atual (verificado no código e nas migrations)

| Peça | O que faz | Onde |
|---|---|---|
| `rede_autorizacao_imagem` | **1 linha por criança/clube** com `arquivada` (booleano marcado pela diretoria) e o "desligar" do responsável. Cada mudança **sobrescreve** a linha. | migration 470, 490, 491 |
| `rede_marcar_autorizacao_imagem` | RPC da diretoria: marca/desmarca "papel arquivado". | 470 |
| `_rede_imagem_autorizada(uid)` | verdadeiro só com `arquivada = true` e sem recusa de responsável; coordenação (adulto) passa direto. | 490 |
| `comunidade_autorizacoes` + `_comunidade_autorizado` | o "não" do responsável para a **participação** do filho na Rede (a criança entra liberada; o responsável só desliga). | 432, 491 |
| Trilha genérica `auditoria_operacoes` | registra ator/alvo/detalhe de operações; **só o admin da plataforma lê**, janela curta (últimas 500 linhas / 90 dias). | 77 |

### O que **É** registrado hoje
- O **estado atual** (arquivada sim/não; responsável desligou sim/não).
- Uma linha genérica na trilha de operações (ator, alvo, quando), visível só ao admin da plataforma e por tempo limitado.

### O que **NÃO** é registrado hoje
| Requisito do dono | Hoje |
|---|---|
| quem autorizou | só na trilha genérica (admin da plataforma); a **diretoria do clube não consegue provar** |
| responsável | idem |
| usuário/criança | sim (é a chave da linha) |
| **versão do termo** | **não existe campo** (e o texto do termo ainda não existe) |
| data/hora da autorização | só a última alteração (sobrescreve) |
| data/hora da revogação | só a última alteração (sobrescreve) |
| origem (papel/app/banco) | não |
| clube | sim |
| **histórico imutável** | **não**: cada marcação apaga o "antes" |

**Conclusão:** hoje o consentimento é um **booleano com data da última mudança**, sem histórico. Não há estrutura reutilizável
para prova posterior (o que valia antes? quem marcou? quando o responsável desligou?).

## 2. Validade REAL das URLs assinadas (verificada no código, não suposta)

| Conteúdo | Bucket | Validade da URL | Onde |
|---|---|---|---|
| **Foto de perfil / avatar** (a que aparece na Rede) | `imagens` | **24 h** (`VALIDADE_S = 24*60*60`) | `src/lib/imagens.js:20` |
| Cache do aparelho | localStorage por usuário | reaproveita a URL **enquanto restarem > 2 h** (`MARGEM_MS`); falha é lembrada por 1 min | `src/lib/imagens.js:21`, `:117-127` |
| **Foto de post** da Rede | `comunidade` | **10 min** (`createSignedUrl(path, 600)`) | `src/services/comunidade.js:89` |
| Comprovações / documentos / suporte | vários | 5 min a 1 h | `missoes.js` (1 h), `documentos.js` e `institucional.js` (5 min), `suporte.js` (10 min) |

**Consequência para a revogação:**
- **Revogar impede NOVAS URLs imediatamente** (o gate `_rede_imagem_autorizada` roda no JSON e na policy de Storage).
- Uma URL de **foto de perfil** já emitida antes da revogação continua abrindo por **até 24 h** (pior caso: emitida no
  instante anterior). Uma URL de **foto de post**, por **até 10 min**.
- Esse é o mesmo comportamento do app do clube. Deve constar no termo quando ele existir. Não expor a URL além do necessário:
  ela só existe em memória/localStorage do próprio aparelho e nunca vai para log nem para o servidor.
- **Mitigação técnica possível (não feita agora, decisão do dono):** reduzir `VALIDADE_S` das fotos de perfil (ex.: 1 h) —
  troca menos exposição por mais chamadas de assinatura em 4G fraco.

## 3. Estrutura técnica implementada (migration 503 — só técnica)

Arquivo: `supabase/migrations/20260930000503_rede-consentimento-imagem-auditavel.sql` · teste `113_rede_consentimento_auditavel.sql`.

1. **`rede_consentimento_imagem_historico`** — **append-only**: uma linha por evento, escrita **só por gatilho**, nunca editada nem apagada
   (mesmo gatilho `_proteger_registro_imutavel` das investiduras). Colunas: `quando`, `club_id`, `usuario_id` (sem FK: sobrevive à conta),
   `escopo` (`imagem` | `participacao`), `evento` (`arquivada`, `desmarcada`, `desligada_pelo_responsavel`, `religada_pelo_responsavel`,
   `participacao_revogada`, `participacao_religada`, `alterada`, `registro_removido`), `ator`, `papel_ator` (`diretoria` | `responsavel` | `banco`),
   `origem` (`app` | `service_role` | `banco`), `antes`/`depois` (só os booleanos de hoje), `versao_termo` (nula).
   Sem nome, foto ou dado sensível: **só ids e booleanos**.
2. **Gatilhos** em `rede_autorizacao_imagem` e `comunidade_autorizacoes`: marcar, desmarcar, desligar e religar viram linhas.
   **Revogar nunca apaga histórico — só acrescenta.**
3. **`rede_autorizacao_imagem.versao_termo`** (nulo): campo reservado. Nenhuma RPC grava hoje. Quando o Termo existir, a RPC de marcação
   passa a receber a versão e o gatilho a copia. **Não inventa texto jurídico.**
4. **Leitura só pela RPC** `rede_consentimento_imagem_historico(p_usuario, p_limite)`: diretoria do clube em uso (só o próprio clube) ou admin da
   plataforma. Ninguém acessa a tabela direto (RLS ligado, sem grants).
5. Termina com `_manutencao_instalar_guarda()` (teste 100). Idempotente.
6. Expurgo de clube (280) continua funcionando (mesmo caminho das investiduras).

**Não altera:** as RPCs de marcação, `_rede_imagem_autorizada`, as policies de Storage, a tela, nenhum booleano, nenhuma regra de acesso.

## 4. Próximo passo (depende do dono / jurídico)

1. **Texto do termo** (jurídico): quando existir, definir a versão (`2026.1`…) e ligar `versao_termo` na RPC de marcação.
2. **Tela da diretoria** para consultar o histórico de uma criança (a RPC já existe; falta a UI) — próxima fase.
3. **Decidir a validade** das URLs de foto de perfil (24 h hoje) — impacto de privacidade x custo em rede fraca.
4. **Consentimento do responsável no app** (hoje o papel é assinado presencialmente e arquivado pela diretoria; o app só registra o "arquivado"): se o dono quiser assinatura digital do responsável, é fluxo novo e jurídico.
5. Aplicar 503 em produção **só depois** de aprovada; é aditiva (tabela nova + coluna nula + gatilhos), sem apagar nada.
