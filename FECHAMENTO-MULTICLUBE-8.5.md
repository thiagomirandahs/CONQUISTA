# Fase 8.5 — Fechamento do checkpoint multi-clube

Parte de `checkpoint/multiclube-validado`, que fica **imutável** e não foi movida.

| | |
|---|---|
| Itens pedidos | 9 |
| Itens entregues | 9 |
| Defeitos encontrados | **11** (3 deles na correção da própria fase 8.4) |
| Migrations | `20260927000065` a `20260927000069` |
| Banco | **57 arquivos, 2.953 asserts, 0 falhas** |
| Frontend | **39 arquivos, 436 testes, 0 falhas** |
| Ambiente | 3 builds, verde |

---

## O que esta fase descobriu, e por quê só agora

A 8.4 provou que o produto funciona como SaaS multi-clube e corrigiu quatro BLOCKERs. Esta fase
atacou as superfícies que aquela declarou fechadas, e achou mais três — **duas delas na própria
correção da 8.4**. A razão é sempre a mesma, e vale mais do que os achados:

> Uma varredura de catálogo **por texto** encontra o que segue o padrão que ela procura, e fica
> calada sobre quem não segue. Ela não sabe distinguir "não achei nada" de "não olhei".

A migration 62 da fase 8.4 escopou 58 policies varrendo `pg_policies` com um regex. O relatório
daquela fase afirma que o teste comportamental mostrou "exatamente essas duas, e só essas duas"
superfícies que escapavam. **Eram seis** — e o motivo de o teste não pegar as outras quatro é pior
do que o próprio achado.

---

## Os achados

### BLOCKER 1 — `salvar_reuniao` apagava os pontos da pessoa em TODOS os clubes dela

*Migration 67. O mais grave do projeto até aqui, e não é vazamento de leitura: é destruição de dado.*

A tela de Apontamentos — a rotina mais banal que existe, o conselheiro lançando os pontos da reunião
da semana — fazia, por pessoa:

```sql
delete from public.pontos
 where usuario_id = v_alvo and origem = 'apontamento' and motivo = p_motivo;   -- sem clube
insert into public.pontos (usuario_id, origem, pontos, motivo, data, lancado_por, marca)
     values (v_alvo, 'apontamento', v_pts, p_motivo, p_data, v_uid, v_item->'marca');   -- sem club_id
```

O `delete` não tem clube. O `insert` não tem `club_id` — quem carimba é um gatilho que, sem clube
explícito, usa o **vínculo mais recente da pessoa**, que nada tem a ver com quem está lançando.

Medido no banco, com alguém em dois clubes:

| | |
|---|---|
| antes | apontamento "Reunião 12/03" = **30 no clube A**, **45 no clube B** |
| ação | a diretoria do clube A (sem autoridade nenhuma em B) salva a reunião |
| depois | **uma linha só, de 10 pontos, no clube B** |

Entraram duas linhas, sobrou uma, no clube errado, e o dado do clube de quem operou desapareceu. O
cabeçalho da própria função promete o contrário: *"Se qualquer linha falhar, NADA é alterado (sem
perda)"*.

### BLOCKER 2 — a escrita direta nunca foi escopada pela aba

*Migration 68.*

A migration 62 filtrava `cmd in ('SELECT','ALL')`. Policies de `INSERT`, `UPDATE` e `DELETE`
**separadas** — que são a maioria neste banco — nunca entraram. O resultado foi um produto em que
**ler** ficou preso à aba e **escrever** não.

A 8.4 chegou a tratar "operação no clube errado": a migration 64 corrigiu cinco funções
`security definer`. Mas função é um dos dois caminhos de escrita. O outro é o PostgREST gravando
direto na tabela — o caminho que o próprio app usa (a montagem dos três clubes cria unidades com
`sbB.from('unidades').insert(...)`). Esse ficou inteiro de fora.

Medido pelo gate novo, na primeira vez que rodou:

```
[dir_a_membro_b    | aba no clube B | insert em pontos] gravou no clube A
[instrutor_2clubes | aba no clube B | insert em pontos] gravou no clube A
[dir_a_membro_b    | aba INVÁLIDA   | insert em pontos] gravou no clube A
```

16 policies de escrita escopadas. Junto foi `mensalidades`, cuja policy `ALL` tinha o `with check`
escopado e o `using` não — quem tem permissão financeira em A lia as mensalidades de A pela aba de
B. Ela escapou da 62 por usar `pode_financeiro_no_clube`, fora do regex daquela varredura. Duas
varreduras, cada uma achando que a outra tinha coberto.

### BLOCKER 3 — as quatro tabelas de leilão liam a união dos clubes

*Migration 67.* `leilao_habilitado(club_id)` chama `membro_ativo_no_clube` sem consultar a aba —
exatamente a forma do chat antes da 8.4.

**Por que o teste 55 não pegou, e esta é a lição:** a varredura de leitura cruzada roda na seção 1
do arquivo; os leilões só nascem na seção 4. Quando a varredura passou, as tabelas estavam
**vazias**. "Nada vazou" e "não havia nada para vazar" tinham a mesma cara no relatório.

### BLOCKER 4 — a foto que a criança enviou atravessava clube

*Migration 69.* A evidência vai para `comprovacoes/<usuario_id>/requisitos/<ts>.jpg` — **o caminho
não tem clube.** A policy perguntava *"esta pessoa é do meu clube?"*, então a liderança do clube B
enxergava a pasta inteira de uma criança com vínculo em A e B, incluindo as fotos enviadas como
evidência de requisitos **do clube A**. E o `exists` não filtrava `status`: bastava um vínculo
suspenso ou encerrado.

Agora a pergunta é *"esta **evidência** é do meu clube?"*, respondida pela linha que guarda o
caminho — que tem `club_id`. As seis tabelas que usam o bucket estão escritas uma a uma: três
chamam a coluna de `evidencia_path` e três de `foto_url`, e uma varredura por nome de coluna
acharia metade.

### ALTO 5 — a identidade do produto e a de um cliente eram o mesmo arquivo

*Migration 65 + assets.* `public/icon-192.png`, `icon-512.png`, `logo.png` e `assets/logo.png` eram
o **brasão do Tenant 001**, com o nome dele e o ano de fundação desenhados na imagem. Esses arquivos
são o favicon, os ícones do PWA, o ícone do app Android e — o pior — o `icon` e o `badge` de **toda
notificação push de todo clube**.

E a marca do Tenant 001 no banco apontava `logo_url` para `/icon-192.png`. Incomodava nos dois
sentidos: um clube novo instalava um app com o brasão de outro clube na tela inicial, e o clube A
não podia trocar o próprio logo sem trocar o do produto.

Separado: o brasão virou `public/clubes/tenant-001.png`, e os caminhos globais receberam uma bússola
neutra, gerada de `public/marca-produto.svg`, versionado para poder ser regerado sem perda.

### ALTO 6 — `MARCA_LEGADA`, o fallback "sem clube", era a marca do Tenant 001

Era o que aparecia na tela de entrada, no primeiro quadro e em qualquer estado sem clube. O
comentário do próprio código já dizia *"pode sair quando o rollout terminar"*. O rollout terminou há
muitas fases; o que ficou foi todo cliente novo lendo o nome de outro clube.

### ALTO 7 — a marca guardada não tinha dono

`lerMarcaSalva()` devolvia a última marca vista para **quem quer que fosse**. Na troca de conta,
quem acabava de entrar via a identidade do clube da pessoa anterior durante o round-trip inteiro do
contexto — a janela de frames que o item 4 proíbe. Agora o registro carrega o `uid`.

### ALTO 8 — o app escolhia outro clube sozinho quando o seu deixava de valer

`escolherClubeAtual` terminava em `return usaveis[0].clubeId`. Quem perdesse o vínculo num clube
recarregava e **aparecia dentro do outro**, mesma sessão, sem aviso. Agora `resolverClubeDaAba`
devolve a situação (`resolvido` / `precisa_escolher` / `sem_vinculo`), o `ClubeGuard` mostra a
escolha, e a marca do clube perdido sai da tela no mesmo quadro.

### ALTO 9 — a evidência privada do clube emissor viajava com a conquista portátil

A conquista atravessa clube por desenho, e junto dela iam: o **comentário do avaliador** dentro do
snapshot selado, a **observação do revisor** institucional, a da cerimônia de investidura, e o
**motivo escrito ao revogar**. Nenhuma delas é "a conquista reconhecida"; todas são julgamento
interno de um clube sobre uma criança.

O mais revelador: o cabeçalho da migration que criou o snapshot **declara** *"NÃO copia evidências:
guarda só referência/flag"* — e cumpre isso para a evidência do desbravador, e não para o texto do
avaliador. E o teste 39 **congelava o vazamento**: ele exigia o comentário dentro do snapshot.

### ALTO 10 — o convite de equipe não expirava, e aceitava um papel que a tabela recusa

Sem prazo, um convite cria vínculo ativo com papel de liderança para sempre. E
`convite_equipe_criar` validava contra uma lista com `'desbravador'`, que o CHECK da tabela não tem:
convidar um desbravador passava pela validação e morria com um erro de constraint cru.

### ALTO 11 — a CSP do header e a da meta se intersectavam

Duas CSPs válidas para a mesma página são aplicadas em **interseção**, não em união. O `vercel.json`
cravava `https://*.supabase.co` enquanto a meta passou a sair do ambiente: um domínio próprio de API
seria permitido pela meta e negado pelo header, e o app quebraria **só em produção**.

---

## Item a item

| # | Pedido | Onde está | Prova |
|---|---|---|---|
| 1 | Remover identidade global do tenant | migration 65, assets, `marca.js`, HTML, manifest, Capacitor, Android, CI, README | `identidadeDoProduto.contract.test.js` — 12 asserts, varre src/, public/, HTML, manifest, config nativa e os **bytes** dos assets |
| 2 | Clube por aba após reload | `lib/clube.js` (sessionStorage) | teste unitário + **navegador**: duas abas em clubes diferentes, cada uma sobrevivendo a um carregamento completo no próprio clube |
| 3 | Nada de fallback silencioso | `resolverClubeDaAba` + `ClubeGuard` | `clube.test.js`, `guardasDoClube.test.jsx` |
| 4 | Logout zera o contexto | `Clube.jsx`, `Escopo.jsx`, `marca.js` | `Clube.test.jsx` (inclusive a janela de frames na troca de conta) + **navegador** |
| 5 | B1–B4 viram gate permanente | `56_gate_multiclube_permanente.sql` | 27 asserts; 144 sondagens de mutação |
| 6 | Exceção curricular preservada | migration 69 + classificação no gate | 20 exceções nomeadas, uma a uma, com o porquê escrito |
| 7 | Convites multi-clube | `ConvitesDeEquipe.jsx`, `services/equipe.js`, migration 66 | teste 54 (42 asserts) + **navegador**, fluxo completo |
| 8 | CSP/config do ambiente, fail-closed | `vite.config.js`, `vercel.json` | `build-por-ambiente.mjs`: 3 builds, dentro de `npm run check` |
| 9 | Sem features novas; rodar tudo | — | 57 arquivos de banco, 39 de frontend, gate de ambiente |

---

## O gate permanente (item 5)

A diferença entre *"o defeito X não voltou"* e *"esta classe de defeito não passa"*. Ele não sabe o
nome de nenhuma função corrigida. Conhece três coisas:

**1. A classificação explícita.** 20 superfícies que atravessam de propósito, cada uma com o porquê
escrito; todo o resto é operacional **por padrão** — o lado seguro. Um assert de completude impede
que uma tabela nova entre sem decisão. Isso importa porque, até aqui, a exceção curricular escapava
do escopo por aba **por acidente**: as policies dela delegam a `_pode_ver_conquista_curricular()` e
não casavam com o regex da migration 62. A exceção mais importante do produto era subproduto de uma
expressão regular.

**2. Um assert estrutural**, resolvendo um nível de indireção (a policy do chat não cita `club_id`,
ela delega). É o que torna **durável** a correção da 8.4: a migration 62 rodou uma vez e o escopo não
existe no fonte de migration nenhuma — qualquer `drop policy; create policy` futuro o desfazia em
silêncio, e nenhum teste comportamental pegaria.

**3. Uma invariante para mutação**, que dispensa enumerar expectativa caso a caso:

> nenhuma chamada pode alterar linha de um clube que não seja o da requisição.

6 identidades × 4 contextos × 6 mutações = **144 sondagens sob uma regra só**. A sonda mede o estado
**fora da RLS** — senão uma escrita no clube errado ficaria invisível para quem mede, exatamente no
caso que o gate existe para pegar — e desfaz tudo, carregando a medição para fora pela própria
exceção que provoca o rollback.

### Três erros de método que o gate corrige

| | |
|---|---|
| **Varredura antes do fixture** | a do teste 55 media tabelas vazias. Agora ela roda depois de tudo, e cada clube prova ter dado antes de o zero contar |
| **Só `club_id`** | conquista e snapshot usam `club_id_origem` e nunca tinham sido varridos para leitura |
| **Erro engolido como 0** | `t.ve`/`t.nv` transformam exceção em zero: falha de medição ficava idêntica a "não vi nada" |

---

## O que fica em aberto

**O autocadastro só entra no Tenant 001.** `unidades` é legível por `anon` quando o clube é o
legado, para a tela de cadastro montar o seletor de unidade — e o cadastro manda essa `unidade_id`
para `handle_new_user`. Consequência: quem abre o cadastro de **qualquer** clube recebe a lista de
unidades do Tenant 001, e um clube novo não tem caminho de autocadastro (a entrada dele é por
convite).

Não é falha de isolamento — nome de unidade não é segredo, e a policy cobre um clube só. É a última
peça do produto que ainda supõe clube único, e consertá-la é **decidir como o cadastro descobre para
qual clube a pessoa está entrando**: produto, não segurança. Fica com assert próprio no gate, para
não ser esquecida nem acompanhada em silêncio.

**O `appId` do Android continua `app.filhosdaconquista`.** Não é texto que alguém lê: é a chave de
identidade da instalação na Play Store e no Firebase. Trocá-lo publica um aplicativo diferente, deixa
quem já instalou sem caminho de atualização e invalida os tokens de push registrados. Dívida
reconhecida, com custo real e momento certo para pagar (junto de uma publicação nova). É a **única**
isenção do contrato de identidade, nomeada e travada por um teste que exige que ela continue sendo
exatamente essa.

**Achado colateral, corrigido:** o teste 30 falhava todas as noites, das 21h à meia-noite. O banco
roda em UTC e o chefão conta em São Paulo; nesse intervalo `current_date` já virou e o início da
batalha caía três horas no futuro. Descoberto rodando a suíte às 21h06. Um teste que só passa em
parte do dia não é um teste.

---

## Conclusão

Os 9 itens estão entregues, com todos os gates verdes. O que esta fase muda na leitura do produto
não são os 11 defeitos — é o que eles têm em comum.

A fase 8.4 fechou a leitura e declarou o multi-clube validado. A 8.5 mostrou que a mesma pergunta
tinha três outras portas (a escrita direta, o objeto no Storage, o documento portátil), e que a
ferramenta usada para encontrar a primeira — varrer o catálogo por texto — é estruturalmente incapaz
de encontrar as outras. Por isso o entregável central não é uma correção: é um gate que parte de uma
**invariante** em vez de uma lista, e que falha quando alguém acrescenta superfície sem decidir de
que lado ela fica.
