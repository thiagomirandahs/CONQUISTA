# Conquista curricular x Investidura (migration 527)

Duas coisas diferentes, que o código nunca deve misturar.

| | CONQUISTA CURRICULAR | INVESTIDURA |
|---|---|---|
| O que é | Fato da PESSOA: "concluiu a classe X" | Evento/processo do CLUBE: cerimônia + revisão (clube, distrito, região) da MATRÍCULA |
| Pertence a | `usuario_id` (a pessoa; não muda de clube) | `member_classes` / `class_investitures` (clube + matrícula) |
| Tabela | `curriculum_achievements` (tipo `classe`) | `member_classes.status = 'investida'`, `class_investitures`, `investiture_reviews`, snapshot, documentos |
| Unicidade | **1 ATIVA por pessoa + classe equivalente** (mesmo `codigo` oficial, qualquer clube/versão/origem), garantida pelo banco | Uma por matrícula; duas matrículas (clubes diferentes) da mesma classe podem existir e ser investidas, cada uma com o seu histórico |
| Duplica? | Nunca (índice `ux_curriculum_achievements_classe_ativa_pessoa`) | Não se aplica: é histórico do clube |
| Revogada | Fica no histórico para sempre (soft; origem, ator, clube, data e motivo intactos) e NÃO ocupa mais a vaga: nova conclusão válida gera NOVA ativa | `snapshot_revogar` revoga snapshot, investidura e a conquista da matrícula; a matrícula volta a `em_andamento` |

## Regra em uma frase
Quem concluiu uma classe tem UMA conquista ativa dela, em qualquer clube. A investidura de uma segunda matrícula equivalente
continua acontecendo normalmente (documento, revisão, cerimônia), mas, em vez de criar outra conquista, ela **reconhece** a existente
(`class_completion_recognitions`, migration 525). Se a conquista reconhecida for revogada, a matrícula investida com investidura registrada assume
(emite a própria) ou reconhece outra ativa.

## Como a regra é imposta (de baixo para cima)
1. Banco: `curriculum_achievements.classe_codigo` (chave de equivalência, preenchida por gatilho: `classes.codigo` se a versão é oficial; `id:<uuid>` se não é)
   + índice único parcial `(usuario_id, classe_codigo) where tipo='classe' and status='ativa'`. O índice antigo por clube agora só olha ativas.
2. Ponto único de emissão `_classe_emitir_ou_reconhecer`: advisory lock pessoa+código -> já há ativa equivalente? reconhece : insere; se o índice
   recusar (corrida sem lock) a violação vira reconhecimento, sem erro e sem estado parcial. Usado pelo gatilho `registrar_conquista_curricular`
   (investidura) e pela promoção `_conquista_revogada_promove_reconhecidas`.
3. Registro de classe concluída anteriormente (`classe_concluida_anteriormente_registrar`, 521): mesmo lock; recusa amigável "já consta ... neste clube / em outro clube".

## O que NÃO mudou: contagens por matrícula/clube
Investidura é contada por matrícula e por clube. Estas leituras continuam como estavam (consultam `member_classes` / `class_investitures`, não `curriculum_achievements`):
- `escopo_painel`, `escopo_painel_analitico`, `escopo_clube_detalhe` (painel do coordenador: números agregados por clube/distrito/região)
- `meu_inicio`, `minha_jornada` (a lista `investiduras` e `classes` é por matrícula do clube em uso; só `conquistas` lê a conquista, ativas)
- `minha_classe`, `documento_emitir`, `documento_conteudo`, `documento_verificar` (snapshot/investidura da matrícula)
- Rede (`_rede_conquistas_do_clube`): publica por matrícula investida do clube; só o filtro de revogadas foi ajustado (revogada sem substituta continua escondida; matrícula reinvestida volta a aparecer).
Se algum dia o produto quiser "total de classes concluídas por pessoa" (e não "investiduras do clube"), a fonte é `curriculum_achievements` com `status='ativa'`;
nunca somar investiduras para isso.

## Consequência prática
Reinvestir no MESMO clube depois de revogar a conquista (caso achado na 525) agora emite a nova conquista ativa; a revogada continua lá, intacta.
Se existirem duas ativas equivalentes legadas, a migration 527 aborta com mensagem clara (nada é apagado): revogue as sobras com motivo e reaplique.
Produção está sem conquistas de classe, então não há conflito.
