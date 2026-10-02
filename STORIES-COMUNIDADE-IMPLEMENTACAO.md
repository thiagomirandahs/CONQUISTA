# Stories para todos na Comunidade — implementação (migration 535)

Data: 02/10/2026. Branch de trabalho: `worktree-agent-a00e27420c91e188a` (a partir de `fase-9-seguranca-e-conteudo` = `5cb14a5`).
**Nada foi aplicado nem publicado em produção** (produção: ledger 534, front 5cb14a5). Tudo abaixo é local.

## 1. Causa (por que "não aparecem stories na Comunidade")
Não era bug: era a regra da 515 (decisão D1 de então). `rede_stories.alcance` tinha `check (alcance = 'clube')`,
`rede_story_publicar` não recebia alcance e o `RedeFeed.jsx` só montava a fileira de stories na aba "Meu Clube"
(ver `DIAGNOSTICO-STORIES-COMUNIDADE.md`). Produção (01/10): 7 stories, todos `clube`; 0 de alcance comunidade
(impossível por constraint).

**Decisão do dono (definitiva, 02/10/2026):** stories para TODOS na Comunidade; sem módulo de amigos, sem "seguir",
sem aprovação prévia (nem diretoria nem plataforma); a autorização dos pais para participar da Rede (491) continua
sendo exigida; moderação posterior (denúncia) continua.

## 2. Arquitetura existente reutilizada (nada paralelo)
| Peça | Reutilizada como |
|---|---|
| Tabela `rede_stories` (+ `rede_stories_vistos`) | mesma tabela; só a constraint de `alcance` mudou. "Visto" continua no servidor (`rede_story_visto`). |
| RPCs `rede_story_publicar`, `rede_stories`, `rede_story_visto`, `rede_story_apagar`, `comunidade_denunciar`, `comunidade_moderar`, `admin_comunidade_moderar`, `admin_comunidade_foto_assinar` | mesmas RPCs; duas ganharam `p_alcance` com default. |
| Função central de visibilidade `_rede_item_visivel` (515) | agora recebe o alcance DO STORY (antes, `'clube'` fixo). Mesma regra dos posts da Comunidade. |
| Bucket privado `comunidade`, caminho `<unidade>/<autor>/<uuid>.webp|jpg`, policy `_comunidade_pode_ver_foto`, upload policies 432/472 | iguais; a policy de leitura usa o alcance do story. |
| Saneamento 529 (`imagem_saneamento_enfileirar` pedido pelo app) | igual: o caminho é o mesmo, entra na fila com o clube. |
| Limpeza: gatilho `_rede_story_fora_do_ar`, `rede_marcar_fotos_para_apagar`, Edge `limpar-fotos-rede`, `rede_fotos_confirmar` | iguais (não olham alcance). |
| Catálogo do GC `_storage_referencias()` (531: `rede_stories.foto_path`) | igual. |
| Front: `FileiraStories`, `ViewerStories`, `NovoStory`, `Denuncia`, `AvatarRede` | mesmos componentes com a prop `alcance`. |
| Nome reduzido do menor fora do clube (`_comunidade_autor_json`, 515) | vale automaticamente na faixa da Comunidade. |

## 3. Alterações
### Banco — `supabase/migrations/20260930000535_rede-stories-para-todos-na-comunidade.sql`
1. `rede_stories_alcance_so_clube` sai; entra `rede_stories_alcance_valido check (alcance in ('clube','comunidade'))`.
   Índice parcial `rede_stories_comunidade_ativos_idx (expira_em desc) where status='publicado' and alcance='comunidade'`.
2. `_rede_story_visivel(story, uid)`: usa `s.alcance`.
3. `drop function rede_story_publicar(text,text)` + `create rede_story_publicar(p_foto_path, p_texto default null, p_alcance default 'clube')`
   (parâmetro novo no fim, com default: a chamada antiga de 2 argumentos é idêntica; sem overload no PostgREST).
   Alcance inválido → `Alcance inválido.`; `comunidade` nasce `publicado` pela regra única `rede_foto_exige_aprovacao()`
   (sem argumento — NÃO usa a regra de aprovação de foto dos posts da Comunidade). Resposta ganha `alcance`.
4. `drop function rede_stories()` + `create rede_stories(p_alcance default 'clube')`:
   - `'clube'`/null = EXATAMENTE o comportamento anterior (`_rede_item_visivel(..., 'clube', ...)`: só o meu clube/área,
     qualquer alcance do story — os de alcance comunidade publicados por gente do meu clube continuam aí);
   - `'comunidade'` = `s.alcance='comunidade'` + `_rede_item_visivel(..., 'comunidade', ...)`: todos os clubes com a Rede
     ligada, autor ainda participante, publicado, dentro das 24 h; os meus primeiro; limite 60 pessoas; cada story traz `alcance`.
5. `_comunidade_pode_ver_foto` (corpo da 530) com `s.alcance` — é ela que decide a URL assinada do bucket privado.
6. `_plataforma_pode_item('story')`: inclui `s.alcance='comunidade'` (plataforma revisa denunciado/em análise, com log).
7. `comunidade_denunciar`: ramo `story` passa a exigir "quem denuncia poderia ver o story" também quando ele já está
   escondido (`oculto_denuncia`) — fecha uma brecha pré-existente (UUID de story oculto de OUTRO clube aceitava denúncia).

Sem tabela nova (não precisa de `_manutencao_instalar_guarda`); toda função `security definer` com `search_path = ''`;
nenhum grant/policy novo em tabela; `rede_stories` segue com RLS ligada, sem policy, acesso só por RPC.

### Front
- `src/services/rede.js`: `carregarStories(alcance='clube')` — `'clube'` chama `rede_stories()` SEM argumento (idêntico ao
  app publicado); `'comunidade'` manda `p_alcance` e devolve `null` se o banco não tem a 535 (PGRST202).
  `publicarStory({..., alcance})` — só manda `p_alcance` quando é `comunidade`; sem a 535 → mensagem amigável
  (`STORY_COMUNIDADE_INDISPONIVEL`) e apaga a foto subida. Novos textos: `CONFIRMAR_STORY_COMUNIDADE`
  ("Todos os clubes da Rede vão ver por 24 horas."), `confirmacaoDeStory`, `QUEM_VE_STORY`.
- `src/pages/rede/Stories.jsx`: `FileiraStories` com `alcance` (rótulo "Stories da Comunidade", nome do clube embaixo de
  cada pessoa, "+" = "Adicionar story na Comunidade"); `ViewerStories` assina a foto sob demanda com cache por caminho e
  pré-carrega SÓ o próximo; chip "· Todos os clubes" quando `story.alcance='comunidade'`; `NovoStory` com `alcance`
  (título, linha "quem vê" e confirmação próprias).
- `src/pages/rede/RedeFeed.jsx`: aba Comunidade monta a faixa (estado próprio, pedida só quando a aba abre; `false` =
  servidor sem a 535 → sem faixa); um só `<input type=file>` para as duas abas, alcance = aba atual; viewer abre o
  conjunto certo; publicar/fechar recarrega as faixas já pedidas; texto do vazio da Comunidade atualizado.
- Tutorial/ajuda: `src/lib/tutorial/tours.js`, `src/lib/tutorial/conteudo.js`, `src/pages/rede/RedeMais.jsx` (regras).
- Doc: `supabase/REDE-DBV.md` (seção nova + nota na 480).

## 4. Regras finais
| Ação | Quem |
|---|---|
| Publicar story `clube` | como antes: participante elegível (vínculo ativo, Rede ligada, criança autorizada, não `pais`, não suspenso); coordenação idem. |
| Publicar story `comunidade` | os MESMOS (sem exigir `pode_gerir_atividades`); nasce `publicado`. Limites 2/min e 10/dia somam os dois alcances; mesma triagem de texto; só foto. |
| Ver faixa Meu Clube | igual a antes (só o meu clube/área). |
| Ver faixa Comunidade | participante elegível de qualquer clube com a Rede ligada (inclui responsáveis, que só acompanham; coordenação idem). Menor de outro clube: nome reduzido, sem unidade, sem foto de rosto. |
| Abrir a mídia (URL assinada) | quem pode ver o story (policy do bucket privado com o alcance); autor; diretoria do clube do story; nunca anon, pendente, inativo, sem vínculo, clube desligado, criança com a autorização desligada. Expirado/apagado/removido: não assina. |
| Visto | reutiliza `rede_stories_vistos` (servidor), idempotente. |
| Excluir | só o autor (`rede_story_apagar`); diretoria não apaga, MODERA. |
| Denunciar | quem pode ver (inclusive outro clube); não o próprio; vai para a fila do clube DO AUTOR; esconde na hora (denunciante confiável); diretoria do clube do autor é avisada. |
| Moderar | diretoria do clube do AUTOR (`comunidade_moderar`) e `platform_admin` (`admin_comunidade_moderar`, só comunidade/coordenação denunciado ou em análise, tudo em `plataforma_acesso_log`). Diretoria de outro clube: "não encontrado". |
| Expiração | 24 h (`rede_horas_de_story`), igual. |
| Stories antigos | continuam `clube`. |

## 5. Multiclube / privacidade (provado no teste SQL 141 e no E2E)
Outro clube elegível vê `comunidade` e NÃO vê `clube` (faixa, visto, denúncia, Storage); sem vínculo, pendente,
inativo, clube com recurso desligado, criança com a autorização desligada, responsável (publicar), anon: bloqueados;
UUID forjado responde igual ao "não disponível"; autor que sai do clube / clube que desliga / pais que desligam →
some da Comunidade e o arquivo deixa de abrir; coordenação continua com o que já tinha (teste 109 segue verde).

## 6. Storage
Bucket privado (`public=false`, jpeg|webp, 300 KB), mesmo caminho, compressão sem metadados no cliente
(`prepararFotoStory`/`FOTO_STORY`), `solicitarSaneamento` → fila 529 (E2E confere a linha com o clube), fila de apagar
(gatilho na hora para apagado/removido; marcação diária para expirado — E2E confere `rede_fotos_pendentes` para o
service_role), catálogo do GC cobre `rede_stories.foto_path` (teste 141). Sem vídeo: `uploadsMidia.contract.test.js` intacto.

## 7. UX (mobile-first)
Faixa com rolagem lateral só dentro dela (`overflow-x-auto overscroll-x-contain`), itens de 72 px, avatar 60 px, nome e
clube truncados, "+" de 28 px sobre alvo de 60 px, botões do viewer 44 px; teclado (←/→/Esc) no desktop; nada de neon
(variáveis do tema da Rede). Subtítulos: "Só o seu clube vê" × "Todos os clubes da Rede". Confirmação do story da
Comunidade: "Publicar este story na Comunidade? Todos os clubes da Rede vão ver por 24 horas." · Publicar para todos
os clubes / Voltar. Tela de novo story mostra "quem vê" antes do botão.

## 8. Performance
Uma chamada por faixa (a da Comunidade só quando a aba abre; voltar à aba não repete); a RPC devolve só caminhos
(nenhuma mídia); o viewer assina/baixa a foto do story aberto e pré-carrega apenas o próximo (cache por caminho dentro do
viewer); avatares com `loading="lazy"`; limite de 60 pessoas no servidor; índice parcial para o alcance comunidade;
filtros baratos (`alcance`, `status`, `expira_em`) antes da função de visibilidade.

## 9. Testes
- SQL novo `supabase/tests/141_rede_stories_comunidade.sql` (154 asserts): estrutura/assinaturas únicas/grants/anon;
  "sem módulo de amigos" (nenhuma tabela/RPC/coluna); publicar clube × comunidade (chamada antiga, criança, adulto,
  limites somados, triagem, quem não publica); listar por alcance e default = antigo (`rede_stories() = rede_stories('clube')
  = rede_stories(null)`); menor reduzido; Storage (bucket privado, quem abre); visto/apagar/denunciar por id e UUID
  forjado; denúncia de outro clube → oculta, fila do clube do autor, diretoria de outro clube negada, plataforma modera e
  assina com log, brecha do story oculto fechada; remover; excluir o próprio (idempotente); expirado (faixa, Storage, visto,
  denúncia, marcação diária, confirmação da Edge, catálogo do GC); autor inativado / recurso desligado / pais desligam.
- SQL 122 (contrato antigo "story só clube") atualizado explicitamente para a regra nova e MAIS estrito: só `clube|comunidade`,
  nulo recusado, NOT NULL com default `clube`, única constraint de alcance.
- Vitest: `src/pages/rede/StoriesComunidade.test.jsx` (22: faixa, chamadas, textos, publicar com alcance, viewer, mídia sob
  demanda, teclado, degradação sem a 535, mobile, "sem amigos" varrendo serviços e telas) e
  `src/services/redeStoriesAlcance.test.js` (11: assinatura antiga preservada, p_alcance, PGRST202 → null/mensagem, limpeza
  da foto). `RedeFeed.test.jsx` (regra antiga "Comunidade sem stories") atualizado para a regra nova, mais estrito (cada aba
  só a própria faixa, chamadas exatas); `RedeStoriesBuscar.test.jsx` passa a exigir `alcance: 'clube'` explícito.
- E2E novo `supabase/tests/e2e/rede-stories-comunidade.mjs` (`npm run test:rede:stories:e2e`, 37 asserts, Storage real):
  upload no caminho, saneamento, publicar comunidade/antigo/inválido, outro clube vê/assina/URL abre 200 image/*, nega o
  de alcance clube, visto, apagar alheio, diretoria de outro clube, mesmo clube vê os dois, clube desligado, anon, forjado,
  expirado (deixa de assinar; marcação diária), apagado (fila na hora; `rede_fotos_pendentes` para o service_role).

## 10. Gates (todos locais; ver resposta final para os números)
`npm run check` (lint 0 erros / vitest / ambiente) · build de produção · SQL 141 isolado · SQL completo + upgrade simulado ·
contrato RPC (front novo e 5cb14a5 × banco 534 e 535) · E2E rede, admin-foto, stories, storage.

## 11. Riscos
- **Privacidade de menores (decisão do dono, não rediscutida):** a FOTO do story de uma criança passa a ser vista por
  todos os clubes por 24 h, sem aprovação prévia e sem IA de imagem; a proteção é a autorização dos pais (491), a triagem de
  texto, limites, denúncia (esconde na hora) e moderação posterior. O nome/unidade/rosto no avatar continuam protegidos
  (515). Recomendação operacional: o termo dos pais deve dizer que o story pode ir para toda a Rede.
- Conteúdo efêmero (24 h) dificulta moderação a tempo; a denúncia por qualquer leitor de qualquer clube mitiga.
- URL assinada já emitida (600 s) continua abrindo depois de expirar/apagar (comportamento existente; o E2E registra como info).
- Limites de story (10/dia) são por pessoa, somando alcances — não há limite global por clube na Comunidade.
- Avisos do lint (react-hooks `set-state-in-effect`) são do padrão já existente no projeto; 0 erros.

## 12. Compatibilidade com produção (ledger 534, front 5cb14a5)
- **Front antigo + banco 535:** `rede_stories()` e `rede_story_publicar(p_foto_path, p_texto)` continuam resolvendo
  (defaults; sem overload); comportamento idêntico (teste 141 "default = antigo"; contrato RPC: todas existem).
- **Front novo + banco 534:** `rede_stories({p_alcance})` → PGRST202 → serviço devolve `null` → aba Comunidade sem a faixa,
  resto normal; faixa do Meu Clube e publicar no clube chamam sem `p_alcance` (iguais). Publicar na Comunidade só é
  possível pela faixa (que não aparece); se chamado, mensagem amigável e a foto subida é apagada (vitest).
- Ordem da janela: banco (535) antes do front.

## 13. Plano de janela sugerido (NÃO executado)
1. Conferir ledger de produção = `20260930000534` e o Tenant 001 (contagens de `rede_stories` por alcance/status).
2. Aplicar a 535 em transação com `lock_timeout` (o SQL Editor não segura `begin/commit`: a migration é idempotente —
   `drop function if exists` + `create or replace`, constraint com `drop if exists`) e inserir o ledger
   (`20260930000535`, `rede-stories-para-todos-na-comunidade`).
3. Conferir: `select pg_get_function_identity_arguments(oid) from pg_proc where proname in ('rede_stories','rede_story_publicar')`
   → `p_alcance text` e `p_foto_path text, p_texto text, p_alcance text`; constraint `rede_stories_alcance_valido`; smoke com o app
   publicado (faixa do Meu Clube igual).
4. Push + deploy do front (Vercel) e OTA do Android; nenhuma Edge Function muda.
5. Depois: conferir contagem de stories `comunidade` e denúncias nas primeiras 24 h; atualizar o termo dos pais se o dono quiser.
