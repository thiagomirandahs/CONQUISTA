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
  (`exception when others` → falha registrada em `cron_falhas` + warning); idempotente por clube.
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
| Chat | `chat_conversas`, `chat_mensagens`, `chat_participantes`, **`chat_mensagens_apagadas`** (texto original das moderadas) | geral = clube; unidade = a unidade; direta = os 2; liderança modera o clube; **o texto de mensagem apagada só existe na trilha, legível pela liderança do clube** (a mensagem guarda só o marcador) | `chat_enviar_*`, `chat_apagar_mensagem`, `chat_todas_conversas`, view `chat_mensagens_visiveis` | Chat, ChatModeracao (lê a view) | 19 (73), 23 (43) |
| Bichinho | `bichinhos` | o dono; "bichinhos do clube" só do clube | `bichinho_*`, `pets_do_clube` | Bichinho | 19 |
| Bíblia | `biblia_leituras`, `biblia_leitura_atual` (conteúdo `biblia_livros/versiculos` = plataforma) | o dono; liderança do clube | `biblia_iniciar/confirmar_leitura` | Bíblia | 19 |
| Storage | `comprovacoes` (**privado**), **`imagens` (privado; só imagem, até 15 MB)**, **`publico`** (reservado; asset realmente público) | comprovante: dono ou liderança do clube do dono; imagens: por CLUBE (colegas veem avatar/mural/emblema do próprio clube, responsável vê a foto do filho, comprovante antigo só dono+liderança; anon nunca); envio só no próprio escopo; `publico`: leitura por URL, escrita só da liderança do clube na pasta `<clube>/` | policies `storage.objects` (`pode_ver_imagem`, `pode_subir_imagem`, `pode_alterar_imagem`, `pode_gerir_pasta_publica`) | `lib/imagens.js` (URL assinada; cai na pública se falhar), `ImagemPrivada`, `Avatar`, `upload.js` (sem fallback público p/ foto de criança) | 06, 11, 20, 25 (62) + e2e real `npm run test:storage:e2e` (48) |
| Produto multi-clube | `recursos_catalogo` (plataforma), `club_features` (`club_id`), marca em `organizational_units.metadata->'marca'` | cada pessoa lê só os PRÓPRIOS vínculos; a liderança do clube grava marca e recursos do PRÓPRIO clube | `meu_contexto()`, `clube_marca_gravar`, `recurso_definir` | `ClubeContext`, `ClubeGuard`, `RotaRestrita`, `RecursoOpcional`, menu por recurso, tela `/clube` (identidade e recursos) | 26 (93) + Vitest (contexto, guardas, serviço, tela, contrato) + e2e real `npm run test:contexto:e2e` (42) |
| Push | `push_subscriptions`, `push_tokens` (por pessoa; endpoint só https) | envio só via `push_destinatarios(club_id)`; o aparelho segue quem está logado | `push_registrar`, `push_token_registrar`, Edge Function `enviar-push` | `push.js`, `pushNativo.js` | 07, 21 |

## Exceções declaradas (tabelas sem `club_id`, com o motivo — teste 20)
`organizational_units` (raiz) · `organization_memberships` (o clube é `organizational_unit_id`) · `profiles` (clube pelo vínculo) ·
`push_subscriptions`/`push_tokens` (dispositivo da pessoa) · `migracoes_aplicadas` (ledger) · `biblia_livros`/`biblia_versiculos`
(conteúdo da Bíblia, igual para todos).

## O que segue usando o clube legado — de propósito
Cadastro público (o app de cadastro ainda entra pelo Tenant 001) e sincronização de vínculo; o catálogo-modelo que clube novo
copia (jogos e conteúdo); `INSERT` manual no SQL Editor sem `club_id` em fotos/avisos/pontos (cai no Tenant 001, como sempre foi);
a policy que mostra as unidades ao cadastro anônimo.

## Camada de produto multi-clube (migration 33 + front) — o que o app passa a saber por SESSÃO
O app deixa de assumir "um clube, papel e unidade globais": `meu_contexto()` devolve, numa chamada, os vínculos DA PRÓPRIA pessoa (clube, papel NO clube, status, unidade NO clube,
marca e recursos efetivos) e o clube em que o SERVIDOR age. O `ClubeContext` do front resolve o clube em uso e expõe papel, permissões, recursos e marca; toda tela pergunta a ele.
- **Sem suposição global**: nenhuma tela lê `profile.papel`/`profile.unidade_id` (27 telas migradas; o teste de contrato do Vitest reprova a volta). O papel só vale com vínculo ATIVO
  (pendente, suspenso, erro de rede ou sem vínculo = nenhuma permissão: falha fechada) e o `ClubeGuard` só deixa entrar quem tem vínculo ativo com um clube em uso.
- **Marca por clube** (`metadata->'marca'`): nome, sigla, lema, descrição, ano, cores e logo. O que o clube não define é DERIVADO do nome (nunca "Filhos da Conquista" em outro clube).
  O Tenant 001 recebe do banco a marca de sempre (nome, FC, "Desbravadores · 1994", 1994, logo do app) — sem cor própria, o tema fica idêntico. Só a liderança do clube grava, com
  validação (cor #rrggbb; sem `<`/`>`; a logo só do bucket `publico` na pasta DO CLUBE — o app nunca carrega imagem de terceiro) e a tela avisa cor clara demais (texto branco ilegível).
- **Recursos (feature flags)**: `recursos_catalogo` (12 recursos; só o leilão nasce desligado) + escolha do clube em `club_features` (que passou a aceitar QUALQUER recurso do catálogo, por FK).
  O menu, a barra de baixo, a Gestão e as rotas obedecem (mesma matriz `RECURSO_POR_ROTA`). `recurso_habilitado_no_clube` usa o padrão do catálogo, então o gate de dados do leilão
  segue igual. Desligar o leilão com leilão aberto é recusado.
- **Limites honestos desta fase**: (1) as flags são de VISIBILIDADE — só o leilão tem gate de dados no banco; RLS/RPCs dos demais módulos seguem por clube e papel, não por flag;
  (2) o banco ainda tem **1 clube por pessoa** (`um_clube_por_pessoa`, `profiles.papel`/`unidade_id` únicos): o contexto e o formato de `meu_contexto` já suportam N vínculos e a troca de clube
  (testados com dublês e com vínculos forjados no SQL), mas o servidor só age em UM clube (`selecionavel`); trocar para outro é recusado ("indisponível") até a fase seguinte: papel e unidade por
  vínculo, `clube_vinculo_do_usuario` por clube, escolha do clube atual no servidor e relaxar `um_clube_por_pessoa`; (3) manifest do PWA, ícones, APK e título inicial do HTML seguem os do
  Tenant 001 (build white-label é outra fase); (4) antes de entrar, o login mostra a última marca vista no aparelho (ou a padrão) — o cadastro público segue pelo Tenant 001.
- Front publicado ANTES do SQL 33 funciona (modo legado: papel/unidade do perfil, marca legada, recursos como sempre); a tela de identidade avisa que falta o SQL.

## Hardening final (migrations 29–32) — congelamento da base
Pedido: remover a exposição do bucket público `imagens` e — quando seguro — tratar texto de mensagem moderada, oráculos de UUID e as dependências da Edge Function. Tudo com teste vermelho antes.
- **Texto de mensagem moderada** (migration 29; teste 23, 43 asserts + upgrade): qualquer membro do chat lia o `texto` da mensagem "removida pela liderança" direto pela tabela
  (a view escondia, a RLS da tabela não). Agora o original vai para `chat_mensagens_apagadas` (RLS: liderança do clube da mensagem; ninguém grava direto; FK composta
  mensagem+clube; fora do Realtime) e a linha guarda só `(mensagem apagada)`. Mensagens já apagadas em produção são migradas (backfill idempotente). Apagar é idempotente.
- **Oráculos de UUID** (migration 30; teste 24, 44 asserts): para quem vem de sessão de cliente, "UUID de outro clube" e "UUID inexistente" agora dão a MESMA resposta
  (42501, texto da RLS) em `pontos` (pessoa/unidade), `entregas` (atividade), `mensalidades` (pessoa) e `notificacoes` (destinatário); `entregas.avaliado_por` e
  `mensalidades.registrado_por` só aceitam quem faz a operação (antes aceitavam perfil de QUALQUER clube). O teste compara os dois casos, nos dois sentidos, e ainda varre
  AUTOMATICAMENTE toda função pública com 1 argumento uuid (~8 mil chamadas comparadas): nenhuma RPC distinguia. Dono do banco/cron/service_role mantêm a mensagem específica.
- **Bucket `imagens` privado** (migrations 31 e 32; teste 25, 62 asserts; e2e real 48): ver a linha Storage. A 31 (policies por clube + bucket `publico`) é segura em qualquer
  janela; a **32 é a virada** (`public = false`) e é um passo SEPARADO porque front/APK antigos mostram a imagem pela URL pública. O e2e com o Storage real achou o que o SQL não achava:
  o Storage atual grava o dono em `owner_id` e deixa `owner` NULO, então toda policy `owner = auth.uid()` (inclusive as de apagar/atualizar da migration 16) recusava o upload
  `upsert` de avatar/mural — as policies agora usam `dono_do_objeto(owner, owner_id)` (entende os dois formatos; os objetos antigos do Tenant 001 seguem com dono).
- **Edge Function** (`enviar-push`): `npm:@supabase/supabase-js@2.108.2` (a mesma do package-lock do app) e `npm:web-push@3.6.7`, versões EXATAS (era `esm.sh/...@2`). Travado por
  teste (Vitest) e provado no edge-runtime real (`npm run test:edge:bundle`); um pin inexistente faz o bundle falhar.

## Achados desta rodada (todos ganharam teste vermelho antes da correção)
- `chefao_config` gerado sem a coluna `club_id` no insert (migration 20) — achado pelo teste 17.
- View `chat_mensagens_visiveis` escondia o texto da mensagem apagada da moderação de outro clube — teste 19 (migration 26).
- Painel **Conteúdo** (Gestão) edita `desafios`/`versiculos` por nome de tabela dinâmico e tinha perdido a escrita da liderança
  (migration 22) — achado na varredura do front; catálogos viraram do clube (migration 27; teste 15).
- Regressões de desempenho e de "excluir usuário" da revisão anterior (migration 19; teste 12).
- **Revisões independentes da rodada 2** (red-team + regressão do Tenant 001; nenhuma leitura/escrita cruzada direta foi achada):
  um diretor de qualquer clube travava o cron de leilão de **todos** (ponto gigante estourava o int + laço sem isolamento por leilão);
  bucket `imagens` aceitava qualquer arquivo; aparelho de push ficava ligado ao usuário anterior; endpoint de push aceitava `http://`;
  `TRUNCATE` liberado ao usuário; cargo do instrutor revertido em silêncio; pré-voo sem 2 colunas; front-antes-do-SQL escondia o Leilão;
  chat sem limite mostrava as mensagens mais antigas; SQL solto de missões de foto quebrava depois da migration 27.
  Achados de BANCO: teste vermelho antes (21 e 22) e correção na migration 28. Achados de FRONT (Leilão antes do SQL, chat, push, tela de
  Usuários): correção + testes unitários novos (Vitest). E um bug meu pego no caminho: `LEAST(sum(...), teto)` devolvia o teto
  quando a soma era NULL (corrigido com `coalesce`, com asserts de "quem não tem ponto vê 0").

## Riscos residuais conhecidos
- (**resolvido** na migration 29) texto de mensagem apagada; (**resolvido** na 30) oráculos de UUID em pontos/entregas/mensalidades/notificações e `avaliado_por`/`registrado_por`.
  Resta o que o teste 24 NÃO alcança por desenho: RPCs com 2+ argumentos uuid são cobertas só nos casos escritos à mão (duelo, lance, vínculo); e `unidades.conselheiro_id`
  não tem FK nem uso em policy/função (aceita qualquer uuid, sem efeito de segurança hoje).
- Cadastro público aceita `unidade_id` de qualquer clube (o UUID não é listável fora do clube legado); `anon` lê as unidades do
  clube legado (id, nome, cor, conselheiro_id) porque o cadastro precisa.
- `profiles.teste` é editável pelo próprio usuário (só o exime de pontuar).
- Flags de recurso (fora o leilão) escondem a tela, não bloqueiam a API: um cliente que chame a RPC direto ainda acessa o módulo do PRÓPRIO clube (nunca de outro).
- Papel/unidade continuam também em `profiles` (sincronizados com o vínculo pelo banco); o front não os lê mais, mas o banco ainda depende deles (ver limite 2 acima).
- (**resolvido** nas migrations 31+32) bucket `imagens` público. **Enquanto a 32 não for aplicada, `imagens` segue público por URL** (é de propósito — ver o rollout). Depois dela:
  a URL assinada vale **24 h** e o front a guarda (memória + localStorage, por usuário, apagada ao sair) para o cache HTTP funcionar; alguém com acesso ao aparelho desbloqueado
  poderia ler as URLs guardadas nesse período. **APK e front antigos em cache** perdem avatar/mural/emblema depois da 32 (o APK embute o front e não se atualiza sozinho).
  Avatar de quem já saiu do clube deixa de aparecer aos colegas (a policy exige os dois ativos no mesmo clube).
- Front/APK **antigos em cache** não conhecem `config_gravar`: gravar PIX/popup/rodízio por eles falha até atualizar (leitura e o resto
  seguem). Por isso o front novo deve ir **antes** do SQL (ele cai no upsert antigo se a RPC ainda não existe).
- Sessões abertas não são derrubadas ao resetar senha/excluir usuário (o token expira sozinho).
- (**resolvido**) versões da Edge Function fixadas. Deno não roda no vitest: o contrato é lido do código e o bundle é provado em `npm run test:edge:bundle`.
- Jogo NOVO no catálogo: os SQLs futuros devem usar `catalogo_jogo_definir(...)`, não `insert into jogos_trilha` (o clube é NOT NULL).

## Como manter
- Migration nova com tabela nova ⇒ o teste 20 pede `club_id` ou uma exceção justificada.
- Recurso novo do app: entra no catálogo (`recursos_catalogo`), em `RECURSOS_PADRAO` (o Vitest confere os dois) e em `RECURSO_POR_ROTA`; a rota precisa do guarda (o contrato do Vitest confere).
- Policy nova em `storage.objects`: use `dono_do_objeto(owner, owner_id)` — `owner` sozinho vem NULO nos uploads de hoje. Rode `npm run test:storage:e2e`.
- `npm run test:db` (replay do zero), `npm run test:db:upgrade` (schema legado + dados vivos → todas as migrations),
  `npm run test:db:real` (**`supabase db reset` de verdade** + suíte no banco resultante; CLI 2.117.0 via `npx`).
