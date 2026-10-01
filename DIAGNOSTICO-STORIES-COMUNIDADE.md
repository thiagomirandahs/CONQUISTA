# Diagnóstico — stories na aba "Comunidade" da Rede DBV

Data: 01/10/2026. Somente leitura (código + contagens agregadas de produção, banco na migration 533). Nada publicado, nada aplicado.

## Classificação
**REGRA ATUAL (por desenho) — não é bug.** Stories são do clube por decisão do dono (migration 515, D1/D7). Secundário: havia um texto antigo no `REDE-DBV.md` dizendo "visível para todos os clubes" (documentação desatualizada, corrigida neste branch).

## Regra funcional atual
- 515 (`rede-alcance-meu-clube-e-comunidade`): "Stories ficam só 'clube' (constraint)". A coluna `rede_stories.alcance` existe com `check (alcance = 'clube')`: o banco NÃO aceita story com escopo comunidade.
- `RedeFeed.jsx` (comentário 517): "Meu Clube" = feed, stories, desafios; "Comunidade" = conquistas, atividades, eventos, avisos, fotos permitidas, **SEM stories nem desafios**. A fileira de stories só é renderizada com `filtro === 'meu_clube'`; na aba Comunidade nem a fileira é montada.
- Subtítulos: Meu Clube = "Só o seu clube vê"; Comunidade = "Todos os clubes da Rede".
- Confirmação de publicar story (`CONFIRMAR_STORY`): "Ele fica visível só para o seu clube por 24 horas."
- Não há como publicar story "na comunidade": o app só oferece o "+" da fileira (aba Meu Clube) e `rede_story_publicar` não recebe alcance.

## Consulta que o front chama
- Faixa de stories: `rede_stories()` (RPC), chamada UMA vez ao montar o feed (`carregarStories`), independente da aba; só é exibida na aba Meu Clube. Não há chamada diferente para a Comunidade.
- Filtros no servidor (515, `rede_stories`): `_rede_item_visivel(uid, ctx, modo, club_id, 'clube', autor, status)` = recurso comunidade ligado no clube do story + autor ainda participa (vínculo ativo; criança só com autorização dos pais) + **mesmo clube** (ou coordenação <-> clubes abaixo) ; `status='publicado'` e `expira_em > now()` (24 h; as 24 h contam da aprovação se a aprovação de foto for ligada); só o autor vê o próprio em análise. Denúncia oculta muda o status para `oculto_denuncia` e sai. Limite 60 pessoas, uma bolinha por pessoa. Sem cache no front além do estado local (recarrega ao fechar o viewer). RLS: tabela com RLS ligada sem policy, acesso só por RPC `security definer`.

## Dados de produção (só contagens)
- Stories: 7 no total, todos `alcance=clube`, `publicado`; 1 ativo (<24 h), 6 expirados. Em 24 h: 1 story, 1 clube, 1 autor.
- Stories com escopo comunidade: **0 (impossível por constraint)**.
- Clubes: 4; recurso `comunidade` ligado em 4/4. Denúncias de story pendentes: 0.
- Posts (para comparação): comunidade/publicado 2; clube/publicado 5.
- Conclusão: mesmo se a Comunidade exibisse stories, hoje só haveria 1 story ativo (de um clube). A impressão "não aparecem stories de todos" é consequência do desenho + pouco uso.

## Correção implementada neste branch
- Só documentação: `supabase/REDE-DBV.md` linhas 9–11 (texto do story agora diz "só para o seu clube"). Nenhuma alteração de código ou migration.

## Se o dono QUISER stories na Comunidade (decisão de privacidade — NÃO implementado)
Opções:
1. **Manter como está** (recomendado agora): stories = conversa interna do clube; Comunidade = conteúdo institucional da liderança. Ajustar a comunicação ao dono/usuários (subtítulo e vazio da Comunidade já explicam).
2. **Stories da liderança na Comunidade**: migration nova (>533) relaxando a constraint para `alcance in ('clube','comunidade')`, `rede_story_publicar(p_alcance)` só para `pode_gerir_atividades` (diretoria|instrutor, como D2), foto com aprovação da diretoria/plataforma (D5), `rede_stories(p_alcance)` com `_rede_item_visivel(..., s.alcance, ...)`, fileira na aba Comunidade, confirmação "visível para todos os clubes". Crianças nunca publicam lá. Risco baixo/médio: adultos, mas ainda imagem de crianças pode aparecer em foto da liderança; exige moderação de imagem humana.
3. **Stories de crianças para todos os clubes**: não recomendado. Contradiz D1/G7 (menor só visível dentro do próprio clube), LGPD art. 14 (melhor interesse da criança, consentimento específico dos pais para esse alcance), sem IA de imagem e moderação só por denúncia; conteúdo efêmero dificulta moderação a tempo.
Qualquer opção 2/3 exige novo teste SQL (alcance de story, menor, expiração) a ser rodado pelo agente principal; não foi rodado replay SQL aqui.
