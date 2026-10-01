# Veracidade da página pública (/, /conheca, /planos, /adquirir)

Cada afirmação publicada foi conferida contra o produto atual (CLAUDE.md, `supabase/REDE-DBV.md`, telas em `src/pages`).
Só entra o que está **DISPONÍVEL**. O conteúdo mora em `src/pages/landing/conteudo.js` e `src/lib/apresentacao/etapas.js`.

| Afirmação publicada | Estado | Onde / base |
|---|---|---|
| Classes regulares e avançadas com requisitos oficiais | DISPONÍVEL | Currículo 2026.4 (6 regulares + 6 avançadas) |
| Comprovação por foto ou texto; relato complementar em cada requisito | DISPONÍVEL | `tipo_evidencia`, relato em todo requisito |
| Relatório estruturado | DISPONÍVEL | AvaliarClasse.relatorio |
| Avaliação pela liderança (aprova/pede correção) e histórico de tentativas | DISPONÍVEL | AvaliarClasse, migration 360 |
| Classes anteriores e registro de classe já concluída | DISPONÍVEL | ClasseConcluidaAnterior, migration 525 |
| Documento em PDF com assinatura e QR Code de verificação | DISPONÍVEL | Edge Functions de PDF + /verificar |
| Inscrição por link, QR Code ou código; entrada pendente até a diretoria aprovar | DISPONÍVEL | Gestão > Inscrições / Aprovações |
| Identidade do clube (nome, sigla, lema, cores, logo) | DISPONÍVEL | `marca.js`, ClubeConfig |
| Membros, unidades, presença, pontos, ranking, jogos, missões, desafios | DISPONÍVEL | Gestão, Jornada, Jogos |
| Mensalidades: controle do pago/pendente + chave Pix do clube | DISPONÍVEL | Sem pagamento dentro do app (a página diz isso) |
| Avisos, agenda, chat moderado | DISPONÍVEL | |
| Responsável acompanha pontos, presenças e mensalidade pendente (Meu Filho) | DISPONÍVEL | MeuFilho; depois do vínculo confirmado |
| Multiclube (alternar entre clubes com dados separados) | DISPONÍVEL | migration 34 |
| Painel da coordenação, só números agregados | DISPONÍVEL | migration 390 |
| Licença anual, teste grátis, cortesia, pagamento combinado direto | DISPONÍVEL | Preço vem do banco (`planos_disponiveis`), nada fixo no código |
| Rede DBV: Meu Clube x Comunidade, stories de 24 h, conquistas, desafios, curtir/comentar/salvar | DISPONÍVEL (clubes habilitados) | Texto diz "disponível para clubes habilitados" e "liberada aos poucos, clube a clube" |
| Rede DBV: moderação, denúncia que oculta na hora e avisa a diretoria, triagem de texto | DISPONÍVEL | migrations 430-432, 480 |
| Rede DBV: sem mensagem privada e sem troca de contatos | DISPONÍVEL | `REDE-DBV.md` (bloqueio de contato) |
| Rede DBV: criança só participa com autorização dos responsáveis; foto de rosto só com autorização de imagem | DISPONÍVEL | migration 470/480 |
| Administração centralizada da plataforma (uma frase, sem detalhe) | DISPONÍVEL | /admin |
| Funciona no celular, sem instalar (PWA) | DISPONÍVEL | |
| Cada clube isolado; acesso por cargo; histórico de ações | DISPONÍVEL | RLS, `club_id` |
| Catálogo oficial de Especialidades | EM PREPARAÇÃO | **Omitido na landing.** Em /conheca (etapa 5) aparece como recurso da plataforma, "catálogo oficial em preparação" |
| Audiolivros / leituras | EM PREPARAÇÃO | Não mencionado |
| Classes de Liderança | PLANEJADO | Não mencionado |
| Pagamento online / gateway | PLANEJADO | Não mencionado (só: "pagamento combinado direto" e "fora do aplicativo") |
| Vídeos curtos em /conheca | PLANEJADO | Estrutura pronta (`VideoCurto`), nenhuma etapa tem vídeo: sem player vazio e sem data |
| Abertura geral da Rede DBV | PLANEJADO | Não prometida |

## Desvios do pedido (por veracidade)
- "Publicação interclubes só pela liderança" **não** foi afirmada: no produto atual (migration 480) post e story publicam direto, com confirmação,
  e crianças podem publicar com autorização dos responsáveis. O texto diz o que é verdade (autorização, moderação, sem mensagem privada).
- A captura `classe.webp` (e `requisitos`) é uma tela real e mostra o botão "Especialidades" do app. A imagem não foi alterada; o texto
  e o alt da página não citam Especialidades.
