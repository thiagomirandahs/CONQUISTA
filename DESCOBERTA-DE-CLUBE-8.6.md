# Fase 8.6 — Descoberta de clube e entrada multi-clube

| | |
|---|---|
| Itens pedidos | 12 |
| Itens entregues | 12 |
| Migrations | `20260928000070` a `20260928000072` |
| Banco | **58 arquivos, 3.015 asserts, 0 falhas** |
| Frontend | **39 arquivos, 436 testes, 0 falhas** |
| Ambiente | 3 builds, verde |
| Gate de invariante (8.5) | reexecutado: **336 sondagens**, com pessoa nos três clubes |

---

## A última suposição de clube único

Ela tinha duas metades, e uma alimentava a outra:

```
handle_new_user, ramo else:      v_club := public.clube_legado_id();
policy "anon le unidades tenant legado" on unidades:  club_id = clube_legado_id()
```

A policy dizia **quais unidades um desconhecido via** no formulário público; o `handle_new_user`
transformava aquela escolha em vínculo naquele clube. *"Na dúvida, é do clube legado"* era
literalmente verdade quando havia um clube só — com N clubes, significava que **quem se cadastrasse
pelo formulário público entrava na fila de aprovação de um cliente específico**, e que um clube novo
não tinha caminho de autocadastro nenhum. As duas saíram.

Junto foram os carimbadores `definir_club_{ponto,foto,notificacao}`, que terminavam em
`coalesce(…, clube_legado_id())`. Enquanto uma conta sem clube era impossível aquele ramo era
inalcançável; agora é o estado normal de quem acabou de se cadastrar, e sem a mudança um ponto
lançado para essa pessoa iria silenciosamente parar dentro do clube de um cliente. Viraram recusa.

**Uma correção de registro, e ela é sobre mim.** A migration 70 desta fase também tirou o
`coalesce(…, legado)` de dentro de `sincronizar_vinculo_perfil()`, descrevendo aquilo como um
fallback em uso. Não era: a função **não tem gatilho** desde a migration 34, que derrubou
`trg_00_sync_vinculo_perfil` quando a direção do espelho inverteu. Migrations posteriores a
redefiniram como se estivesse viva, e eu segui o mesmo erro. O efeito da minha mudança ali era
nenhum — quem impedia o fundador de cair no Tenant 001 sempre foi o ramo dele não ter
`insert into organization_memberships`. A função foi removida na migration 72: uma função
`security definer` órfã é superfície sem dono, e enquanto existir alguém continua mantendo-a
achando que faz alguma coisa.

A correção separa **identidade** de **vínculo**: cadastrar-se cria a conta, e nada mais. O vínculo
nasce por um caminho que diz *qual* clube.

O ramo `'fundador'` já fazia exatamente isso desde o onboarding. A mudança generaliza o que existia
em vez de inventar — e o ramo `'pais'` fica intacto de propósito, porque ali o clube vem do **token**
do convite, que é autoridade legítima e não um palpite.

---

## As três portas, e a regra que vale para todas

> O cliente nunca diz para qual clube está entrando. Ele apresenta um **segredo**, e o servidor
> descobre o clube a partir dele.

Um `club_id` na URL seria um palpite editável; um token é uma prova. É o que o item 2 pede em *"sem
confiar em club_id enviado pelo cliente"*.

| Porta | Para quem | O que concede |
|---|---|---|
| **Convite nominal** (`club_team_invites`) | a equipe, convidada por e-mail | vínculo ativo — a liderança já avalizou |
| **Convite com token** (`club_invites`) | o responsável, um link por pessoa | vínculo ativo de `pais` |
| **Código de entrada** (novo) | o desbravador, um cartaz/QR para o clube todo | **uma solicitação pendente** |

### O código não é uma chave, é um endereço

É o ponto do item 3 e está escrito no próprio SQL: apresentar o código **não faz de ninguém membro**.
Cria uma solicitação, e a liderança aprova pela tela que já existe. O código diz *"é para este
clube"*; quem diz *"esta pessoa entra"* continua sendo o clube.

A consequência prática: o código pode ser impresso num cartaz, e um código vazado não vira acesso —
vira, no pior caso, uma fila de solicitações para a liderança recusar.

| Propriedade | Como |
|---|---|
| Guardado em hash | `gen_random_bytes(8)` → `sha256`, a mesma receita do convite de responsável |
| Aparece uma vez | nem o banco sabe qual era; a liderança vê só o prefixo |
| Regenerável | gerar revoga o anterior no mesmo ato — nunca dois cartazes válidos |
| Expiração | configurável, e opcional: um mural dura o ano, um evento dura a tarde |
| Sem unidade | quem entra não escolhe unidade (item 6) |
| Sem papel de liderança | só `desbravador`/`conselheiro`; equipe entra por convite nominal |

### Por que abrir um código exige login

Decisão de privacidade (item 5). Sem sessão, tentar códigos ao acaso seria uma sonda **anônima e
ilimitada** contra a existência de clubes. Com sessão, cada tentativa tem dono, entra no limite de
abuso, e a enumeração deixa de ser gratuita. Quem chega pelo QR sem conta faz o cadastro primeiro —
e o cadastro não o coloca em clube nenhum, então nada se perde no caminho.

E `abrir` devolve **seis chaves**: nome, sigla, lema, logo, papel e o flag. Nada de membros,
unidades ou contagem. Um código de cartaz não pode virar um raio-X do clube para quem ainda não entrou.

---

## Os dois defeitos que o teste achou em mim

Ambos na migration que eu tinha acabado de escrever, e ambos do tipo que passa porque **o resultado
parece certo**.

### 1. `perform` redefine `found`

As quatro funções faziam:

```sql
select ... into v_row ...;
perform _entrada_registrar_tentativa(found);
if not found then raise ...
```

`perform` também redefine `found` no plpgsql — e `_entrada_registrar_tentativa` faz um `insert`. O
resultado do `select` era apagado antes de ser testado: **um código inválido seguia adiante com a
linha vazia**.

O pior é o que isso fez com os testes. Os asserts de oráculo comparavam a resposta de um código
revogado com a de um inexistente e as achavam iguais — **porque as duas estavam igualmente erradas**.
Passavam vazios. Agora há um assert exigindo que a recusa *seja* uma recusa, **antes** da comparação:

> "As duas são iguais" não significa nada sem "e as duas são a recusa certa".

### 2. A recusa por exceção apagava o registro da tentativa

`raise` desfaz a transação — e leva junto o `insert` da tentativa que acabou de ser feito. **Cada
tentativa errada apagava a própria prova de ter existido**, e o limite de abuso contaria até zero
para sempre. Teria ido para produção parecendo um rate limit.

A recusa virou **valor** (`encontrado: false`), que é o que faz o registro sobreviver.

---

## Item a item

| # | Pedido | Onde | Prova |
|---|---|---|---|
| 1 | Identidade sem vínculo, sem fallback legado | migration 70 | teste 57 + **navegador**: conta nova cai em "Você ainda não participa de nenhum clube", não no Tenant 001 |
| 2 | Entrada por convite, reaproveitando o motor | migration 71 (`convite_abrir`/`convite_aceitar`) | quem já tem conta usa o mesmo link sem criar outra identidade |
| 3 | Código/QR revogável, com expiração | `club_entry_codes` + 5 RPCs | 56 asserts; **navegador**: gerado na tela, usado, aprovado |
| 4 | Responsável preservado | ramo `'pais'` intacto | não existe código que dê papel de `pais` |
| 5 | Privacidade na descoberta | `entrada_abrir` | exatamente 6 chaves; nenhum endpoint lista clubes |
| 6 | Unidade só depois do destino | sem unidade na entrada | a liderança atribui em Usuários |
| 7 | Conta sem clube é estado válido | `ClubeGuard` | **navegador**: "Entrar com código" como ação principal |
| 8 | Multi-clube | teste 57 §5 | A usa código de B e de C: 3 vínculos, o de A intacto e ativo |
| 9 | Abuso | `entrada_tentativas` | limite por pessoa; revogado = vencido = inexistente |
| 10 | Migração e contrato | migrations 70 e 72 + teste 57 | assert de catálogo impede o fallback de voltar; superfície anônima agora exigida **vazia** |
| 11 | Gate de isolamento reexecutado | teste 56 ampliado | 336 sondagens, 8 mutações novas, pessoa nos três clubes |
| 12 | Navegador | — | ver abaixo |

---

## A jornada de navegador

**novo usuário → cadastro → sem clube → código B → solicitação → aprovação → B**, ponta a ponta, com
o estado conferido no banco ao final:

```
Novata da 8.6 | Águias do Vale | desbravador | ativo | sem unidade | origem: codigo_de_entrada
```

Três coisas que só apareceram ali:

- a tela de cadastro **ainda dizia** *"aguardando a aprovação da diretoria"*. Não há diretoria
  nenhuma esperando — prometer uma aprovação que nunca vem é pior do que não dizer nada, porque a
  pessoa fica esperando em vez de dar o próximo passo. Corrigido;
- o passo "Confirme o clube" mostra a marca de B, e o **título da aba continua `DesbravaClube`**: o
  clube que está sendo apenas *previsto* não contamina a identidade do app;
- e um erro meu de método, que vale registrar: montei o teste com duas abas, uma por conta. Não
  existe: `localStorage` é compartilhado na origem e é onde o supabase-js guarda a sessão, então
  logar numa aba **troca a sessão da outra**. Duas contas simultâneas no mesmo navegador não são
  possíveis. Refiz em sequência, que é como as pessoas realmente usam — cada uma no seu aparelho.

---

## O que fica em aberto

**A entrada de responsável por link ainda não tem tela.** As RPCs existem e estão testadas
(`convite_abrir`/`convite_aceitar`), e `/entrar?convite=` já as consome — mas a jornada completa do
responsável (entrar no clube **e** pedir o vínculo com a criança) tem dois passos, e só o primeiro
passou pelo navegador nesta fase. O segundo continua sendo o fluxo de sempre, intacto.

**O `?convite=` continua chegando ao cadastro também.** O caminho antigo (token consumido dentro do
`signUp`) segue funcionando para quem ainda não tem conta — de propósito, para não quebrar convites
já enviados. São dois caminhos para o mesmo token, e o momento de unificá-los é quando o segundo
tiver rodagem suficiente.

---

## Conclusão

Os 12 itens estão entregues, com todos os gates verdes.

O que muda no produto é maior do que as duas migrations sugerem: até esta fase, **o DesbravaClube
tinha um clube com privilégio de nascença**. Qualquer conta criada sem contexto ia para ele, qualquer
linha sem clube determinado ia para ele, e a tela pública mostrava as unidades dele para todo mundo.
Isso não aparecia como defeito porque era invisível de dentro — era o comportamento *normal*.

Agora não existe clube padrão. Uma conta sem clube é um estado válido e tratado, e entrar em um clube
é um ato com dono: alguém apresenta um segredo, e alguém do clube decide.
