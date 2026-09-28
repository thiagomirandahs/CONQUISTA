# Rede DBV — a Comunidade como "outro mundo" (migrations 470–472)

Continuação da [Comunidade fase 1](COMUNIDADE-FASE1.md). Todas as travas da fase 1 continuam: triagem de
texto no servidor, bloqueio de contato, sem mensagem privada, denúncia esconde na hora e avisa a diretoria,
foto só depois da diretoria aprovar, três avisos, limites e recurso `comunidade` somente da plataforma.

## Decisão do dono — 29/09/2026: publicação DIRETA com confirmação (migration 480)
- Post com foto E story **publicam direto**, sem esperar a diretoria. Antes de enviar, o app pergunta:
  post: "Tem certeza que quer publicar? Fica visível para todos os clubes da Rede DBV." · story: "Tem certeza que
  quer publicar este story? Ele fica visível para todos os clubes da Rede DBV por 24 horas." — botões **Publicar** e **Voltar**.
- A moderação passa a ser **por denúncia** (esconde na hora e avisa a diretoria do clube de quem publicou) até existir
  IA de imagem. Continua tudo o resto: triagem de texto no servidor, bucket ≤ 300 KB, EXIF fora (foto redesenhada no
  aparelho), três avisos, limites, autorização de USO (pais) e de IMAGEM (foto de rosto só com o papel arquivado).
- A regra vive num lugar só: `public.rede_foto_exige_aprovacao()` (hoje `select false`). Voltar para "passa pela
  diretoria" = migration nova com `select true`: post e story nascem `em_analise`, a fila "Fotos" da moderação volta a
  encher e, no story, as 24 h contam da APROVAÇÃO. Os testes 104/107/108 provam os dois caminhos.
- A aba "Fotos" da moderação continua na tela; com a regra de hoje fica vazia (e explica o porquê).

## Visual — estilo Instagram (29/09/2026; o visual de 28/09 foi reprovado pelo dono)
- Fundo branco; texto #0f172a, cinza #64748b, azul de ação #3b5bff; anéis de story azul→roxo (#3b5bff → #8b5cf6).
  Nada de sublinhado em nomes/rótulos, nada de neon; ícones de linha em SVG inline (`Icone` em `componentes.jsx`).
- Topo: logo + "Rede DBV" à esquerda; ➕ publicar e 🔔 notificações (o mesmo sino do app) em quadradinhos claros.
- Barra inferior SÓ de ícones: Início · Buscar · ➕ Publicar · Desafios · Perfil (avatar); ativo em azul com fundo suave.
  "Sair da rede", acessibilidade, regras e moderação ficam em `/rede/mais` (botão ☰ no meu perfil).
- Feed: fileira de stories (rolagem horizontal só nela) → filtro discreto "Todos ▾ · Meu clube" → posts de ponta a
  ponta (cabeçalho com avatar/nome/"Clube · há 8 h", compartilhar e ⋮ com Denunciar/Apagar; foto 4:5; ♡ · 💬 · 🔖;
  legenda com "mais" e #hashtags em azul; post sem foto vira bloco de texto maior). Duplo toque curte.
- Perfil: avatar grande + contadores; abas por ícone: Fotos (grade 3 colunas) · Textos (lista) · Conquistas ·
  Desafios · Salvos (só no meu).

## Stories (migration 480)
- Foto (retrato 9:16 até 1080×1920, WebP ≤ ~150 KB, sem EXIF — `FOTO_STORY` em `src/lib/imagem.js`) + texto opcional
  até 120 (triagem). Duram **24 h** (`rede_horas_de_story()`). Limite: 2 por minuto, 10 por dia.
- Fileira (`rede_stories`): uma bolinha por pessoa, os meus primeiro, depois os não vistos; "visto" por usuário
  (`rede_stories_vistos`). Só aparece story de quem ainda participa da rede (recurso ligado, vínculo ativo, criança
  com a autorização dos pais) — o responsável retirar a autorização tira o story do ar na hora.
- Viewer em tela cheia: barras no topo, avança sozinho em 5 s, toque à direita/esquerda avança/volta, segurar pausa,
  arrastar para baixo (ou ✕/Esc) fecha; nome + clube + tempo; Denunciar (ou Apagar, se for meu).
- Denúncia: `comunidade_denunciar('story', …)` — mesma regra dos posts; Manter/Ocultar/Remover na mesma moderação.
- Arquivos no bucket `comunidade`, mesmo caminho dos posts. Fora do ar (apagado/removido/recusado) entra na fila de
  apagar NA HORA; expirado entra na marcação diária (motivo `story`); a Edge Function `limpar-fotos-rede` apaga e
  `rede_fotos_confirmar` marca `foto_apagada_em`. Arquivo de story nunca é tratado como órfão.

## Buscar (migration 481)
- `/rede/buscar` → `rede_buscar(termo, clube)`: pessoas pelo NOME PÚBLICO (nome + sobrenome) ou pelo clube, e clubes
  com o recurso ligado. Só quem participa da rede; responsáveis não aparecem; nunca busca pelo nome completo.
  Tocar num clube lista as pessoas dele na rede; tocar numa pessoa abre o perfil.

## Telas (`/rede/*`, layout próprio — não usa o AppLayout do clube)
- (até 28/09: cabeçalho com gradiente e barra com rótulos — substituído pelo estilo Instagram acima.)
- `/comunidade` e `/gestao/comunidade` redirecionam para `/rede` e `/rede/moderacao`.
- Classes NÃO aparecem na rede (decisão do dono).
- `/rede/buscar` (busca) é nova (481).

## Regras novas
- **Nome exibido**: nome + sobrenome (duas primeiras palavras; "de/da/do/dos/das/e" são pulados) + nome do
  clube embaixo. Antes era só o primeiro nome (teste 104 ajustado, com o motivo no comentário).
- **Autorização de uso de imagem** (`rede_autorizacao_imagem`): a diretoria marca "arquivada" (papel assinado na
  admissão) por membro na moderação; o responsável vinculado DESLIGA (e religa o que ele desligou) em Meus filhos.
  O "não" do responsável vale em qualquer clube e a diretoria remarcar não passa por cima dele. Sem autorização:
  iniciais, nunca a foto de rosto (feed, perfil e o arquivo do bucket `imagens`, por policy própria).
- **Autorização de USO da Comunidade** (pais, 432) continua separada: uma é "pode entrar na rede", a outra
  "a foto de rosto pode aparecer" — consentimentos diferentes (LGPD art. 14), por isso não unificamos.
- **Publicação por tipo**: livre, foto, desafio (desafio ativo), conquista (classe, especialidade, investidura,
  acampamento, outra). Texto até 300. Descrição da imagem (alt) até 200, também passa pela triagem.
- **Desafios da rede**: só o admin da plataforma cria (/admin → Comunidade). Participação = post com
  `desafio_id`, 1 por pessoa por desafio (volta a poder se o post sair do ar). Pontos só no perfil da rede —
  NÃO entram em `public.pontos` nem no ranking do clube.
- **Salvos**: `rede_salvos`, cada um só vê os seus (aba no meu perfil).
- **Moderação**: Manter = restaurar · Ocultar = nova ação `ocultar` (só conteúdo denunciado que ficou no ar; sem
  aviso ao autor) · Remover = remover. Fila de fotos (Aprovar/Recusar) e a lista "Autorização de imagem".

## Armazenamento mínimo e vida útil das fotos
- **No aparelho** (`otimizarFoto` em `src/lib/imagem.js`): sempre redesenha em canvas (sem EXIF/GPS), WebP
  (JPEG se o navegador não exportar WebP), lado maior ≤ 1080 px, qualidade 0,70; acima de 150 KB baixa a
  qualidade até 0,5 e depois o lado até 720 px. A tela mostra "Foto otimizada: 3,4 MB → 110 KB".
  Avatar: 256 px, ≤ 30 KB.
- **No servidor**: bucket `comunidade` privado, só `image/jpeg`/`image/webp`, **limite 300 KB** (app adulterado
  não sobe arquivo grande).
- **Vida útil**: foto de post expira em **90 dias** (`foto_expira_em`); o post continua, sem a foto ("foto
  expirada"). Recusada/removida/apagada/retirada entra na fila de apagar na hora (gatilho). Órfã (subiu e não
  virou post) em 1 dia. Avatar fica enquanto o membro estiver ativo.
- **Quem apaga**: o Supabase não deixa apagar arquivo por SQL (`storage.protect_objects_delete`). O banco só
  marca (`rede_fotos_para_apagar`); a Edge Function **`limpar-fotos-rede`** (service_role) lê a fila, remove
  pela API do Storage em lotes de 100 e confirma. Cada rodada vai para `rede_limpeza_log` (arquivos e bytes).
- **Agendamento**: pg_cron `rede-limpar-fotos` (05:35 UTC) roda `rede_limpeza_rotina()`: marca e, se o Vault
  tiver `rede_limpeza_url` e `rede_limpeza_secret`, chama a Edge Function por pg_net. Sem eles (banco local),
  só marca e registra em `infra_falhas`.

### A conta
| | tamanho |
|---|---|
| Foto de celular típica | 3–5 MB |
| Depois da otimização | ~100–150 KB (≈ 30–40× menor) |
| 1.000 posts/mês com foto | ≈ 150 MB/mês |
| Total com expiração de 90 dias | estável em ~450 MB (3 meses de fotos) |

## Para ligar em produção (depende do dono)
1. Aplicar 470–472 e 480–481 (script idempotente, SQL Editor não segura `begin/commit`).
2. Publicar a Edge Function `limpar-fotos-rede` (Verify JWT desligado) com o secret `REDE_LIMPEZA_SECRET`.
3. No Vault: `rede_limpeza_url` (URL da função) e `rede_limpeza_secret` (o mesmo valor).
4. Push do app (a rede depende da 471: `rede_feed`).

## Pendente / decisões do dono
- Pontos da rede no ranking do clube? (hoje: não)
- Alcance (todos os clubes com o recurso x por região) e horário do feed para menores — iguais à fase 1.
- IA de imagem (até lá: publicação direta com confirmação + moderação por denúncia — decisão de 29/09/2026).
- Texto do termo de uso de imagem (papel da admissão) — revisão jurídica.
