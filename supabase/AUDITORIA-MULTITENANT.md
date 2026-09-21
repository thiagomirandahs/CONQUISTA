# Matriz de auditoria multi-tenant (clube = tenant)

Estado: **todos os módulos são por clube**. Tenant 001 = clube atual ("Filhos da Conquista", slug `filhos-da-conquista`);
Tenant 002 = clube de teste local. Esta matriz é **executável**: `supabase/tests/20_matriz_de_auditoria.sql` falha se uma
tabela/rotina nova entrar sem decidir a que clube pertence. Nada disto foi aplicado em produção.

## Modelo (o que vale para tudo)
- **Clube** = `organizational_units` (`type = 'clube'`). **Vínculo** = `organization_memberships` (1 clube por pessoa; papel
  `desbravador | conselheiro | instrutor | diretoria | tesoureiro | pais`).
- Toda tabela de dados tem `club_id uuid not null → organizational_units(id)`. O clube **nasce do dado** (gatilho: do dono, do pai da
  linha ou da unidade), nunca do cliente; um `club_id` forjado é recusado pela policy/gatilho.
- Permissões: `membro_ativo_no_clube(club)` (papel ≠ `pais`), `pode_gerir_no_clube(club)` (instrutor/diretoria),
  `pode_financeiro_no_clube(club)` (tesoureiro/diretoria), `tem_vinculo_unidade(club)` (qualquer vínculo ativo — só o PIX do
  responsável). Sempre com o clube **da linha** ou de quem chama (`clube_atual_id()`); os helpers globais legados
  (`pode_gerir()`, `eh_membro_ativo()`…) foram **removidos** (migration 26).
- RPCs `SECURITY DEFINER` derivam o clube de `clube_atual_id()` e conferem TUDO contra ele. UUID de outro clube responde igual a
  "não encontrado" (sem oráculo). Rotinas internas/cron não são executáveis por usuário.
- Cron: cada rotina é um laço por clube (`ordem created_at`), com a config e o prêmio/aviso do clube, isolando falhas
  (`exception when others → warning`); idempotente por clube.
- **Clube novo** nasce completo por `provisionar_clube()` (registro `_prov_*`): config padrão, catálogo de jogos (só a memória
  ligada), desafios de unidade, chat geral e **uma cópia do conteúdo** (missões/versículos) do clube legado.

## Matriz por módulo
| Módulo | Tabelas (club_id) | Quem lê / grava | RPCs e rotinas | Front | Teste (asserts) |
|---|---|---|---|---|---|
| Núcleo: unidades, atividades, entregas, pontos, fotos, eventos, temporadas, mensalidades, notificações | todas | membro do clube lê; liderança/financeiro do clube grava | ranking, aprovar entrega, temporadas, push | RLS | 02, 04, 05, 06, 07 |
| Responsáveis e convites | `responsaveis`, `club_invites` | `pais` só por `meus_filhos()`; convite com hash, 14 dias, uso único | `criar/listar/revogar_convite_responsavel`, `pedir/aprovar_vinculo` | Cadastro, Vínculos | 03, 08 |
| Config do clube | `config_clube` PK `(club_id, chave)` | membro/responsável lê (PIX); liderança do clube grava | `config_gravar(jsonb)`, `config_valor/definir` (internos) | `gravarConfig()` (RPC; fallback p/ banco antigo) | 13 (54) |
| Duelos | `desafios_unidade`, `duelos` | membro lê; liderança julga/cancela/apaga o do clube | `criar/julgar/cancelar/progresso_duelo` | Desafios | 14 (59) |
| Missões e devocional | `missoes_feitas`, `devocional`, **`desafios`, `versiculos` (conteúdo do clube)** | membro lê o próprio; liderança do clube avalia e **edita o conteúdo do clube** | `missao_do_dia`, `registrar_missao/devocional`, `missoes_pendentes`, `avaliar_missao` | Missões, Devocional, Conteúdo | 15 (76) |
| Leilão | `leiloes`, `leilao_itens`, `leilao_lances`, `leilao_lance_unidades` (recurso opcional `club_features`) | membro lê se o recurso está ligado no clube; ninguém grava direto | `criar/cancelar/encerrar_leilao`, `dar/confirmar/recusar_lance`, cron `fechar_leiloes_vencidos` | Leilão | 01, 16 (46) |
| Jogos | `jogos_trilha` (PK `(club_id,chave)`), `jogos_liberados`, `trilha_jogos`, `partidas`, `recordes`, `ajudas`, `chefao_golpes` | membro lê a própria trilha e o ranking/recordes do clube; liderança liga jogos e libera/tranca | `registrar_jogo`, `iniciar_jogo`, rodízio, `registrar_recorde`, ajudas, chefão, `catalogo_jogo_definir` | Trilha, Jogos, Chefão | 17 (96) |
| Cron dos jogos | (mesmas) | — | melhores do dia, campeão da semana, rodada da semana, lembretes, pagamento do chefão | — | 18 (32) |
| Chat | `chat_conversas`, `chat_mensagens`, `chat_participantes` | geral = clube; unidade = a unidade; direta = os 2; liderança modera o clube | `chat_enviar_*`, `chat_apagar_mensagem`, `chat_todas_conversas`, view `chat_mensagens_visiveis` | Chat | 19 (73) |
| Bichinho | `bichinhos` | o dono; "bichinhos do clube" só do clube | `bichinho_*`, `pets_do_clube` | Bichinho | 19 |
| Bíblia | `biblia_leituras`, `biblia_leitura_atual` (conteúdo `biblia_livros/versiculos` = plataforma) | o dono; liderança do clube | `biblia_iniciar/confirmar_leitura` | Bíblia | 19 |
| Storage | `comprovacoes` (**privado**), `imagens` (público por URL) | comprovante: dono ou liderança do clube do dono; imagens: sem listagem anônima, escrita só dono/liderança do clube | policies `storage.objects` | `upload.js` (sem fallback público p/ foto de criança) | 06, 11, 20 |
| Push | `push_subscriptions`, `push_tokens` (por pessoa) | envio só via `push_destinatarios(club_id)` | Edge Function `enviar-push` | `push.js` | 07 |

## Exceções declaradas (tabelas sem `club_id`, com o motivo — teste 20)
`organizational_units` (raiz) · `organization_memberships` (o clube é `organizational_unit_id`) · `profiles` (clube pelo vínculo) ·
`push_subscriptions`/`push_tokens` (dispositivo da pessoa) · `migracoes_aplicadas` (ledger) · `biblia_livros`/`biblia_versiculos`
(conteúdo da Bíblia, igual para todos).

## O que segue usando o clube legado — de propósito
Cadastro público (o app de cadastro ainda entra pelo Tenant 001) e sincronização de vínculo; o catálogo-modelo que clube novo
copia (jogos e conteúdo); `INSERT` manual no SQL Editor sem `club_id` em fotos/avisos/pontos (cai no Tenant 001, como sempre foi);
a policy que mostra as unidades ao cadastro anônimo.

## Achados desta rodada (todos ganharam teste vermelho antes da correção)
- `chefao_config` gerado sem a coluna `club_id` no insert (migration 20) — achado pelo teste 17.
- View `chat_mensagens_visiveis` escondia o texto da mensagem apagada da moderação de outro clube — teste 19 (migration 26).
- Painel **Conteúdo** (Gestão) edita `desafios`/`versiculos` por nome de tabela dinâmico e tinha perdido a escrita da liderança
  (migration 22) — achado na varredura do front; catálogos viraram do clube (migration 27; teste 15).
- Regressões de desempenho e de "excluir usuário" da revisão anterior (migration 19; teste 12).

## Riscos residuais conhecidos
- Bucket `imagens` continua **público por URL** (avatar/mural/emblema): quem tem a URL exata vê a imagem; não há listagem anônima.
- Front/APK **antigos em cache** não conhecem `config_gravar`: gravar PIX/popup/rodízio por eles falha até atualizar (leitura e o resto
  seguem). Por isso o front novo deve ir **antes** do SQL (ele cai no upsert antigo se a RPC ainda não existe).
- Sessões abertas não são derrubadas ao resetar senha/excluir usuário (o token expira sozinho).
- `esm.sh` da Edge Function não está com versão fixada.
- Jogo NOVO no catálogo: os SQLs futuros devem usar `catalogo_jogo_definir(...)`, não `insert into jogos_trilha` (o clube é NOT NULL).

## Como manter
- Migration nova com tabela nova ⇒ o teste 20 pede `club_id` ou uma exceção justificada.
- `npm run test:db` (replay do zero), `npm run test:db:upgrade` (schema legado + dados vivos → todas as migrations),
  `npm run test:db:real` (**`supabase db reset` de verdade** + suíte no banco resultante; CLI 2.117.0 via `npx`).
