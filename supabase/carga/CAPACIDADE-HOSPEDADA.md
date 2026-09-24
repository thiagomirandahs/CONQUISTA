# Capacidade no staging hospedado — plano gradual

> Fase 9.1, item 10. Ferramentas: `supabase/carga/rampa-hospedada.mjs` (guarda, tokens, rodada e
> veredito) e o mesmo `supabase/carga/k6-rampa-fase9.js` da fase 9, agora com `ALVO=hospedado`.
> Evidência: `supabase/e2e/evidencias-fase9_1/carga-hospedada/<rótulo>/`.

**Status: PENDENTE.** O staging hospedado ainda não existe. O plano, a guarda e a ferramenta estão
prontos e foram provados contra o staging local (§10). Isso prova a **ferramenta**, não a capacidade.

---

## 1. Por que outra rodada

A rampa da fase 9 foi **não-validante** por decisão prévia. Ela mediu esta máquina, e o teto (~500
simultâneos com conexão persistente) foi a rede do Docker no Windows. O banco nunca foi o limite:
pico de 22–42 conexões, zero espera por lock. A pergunta que ela não respondia continua em aberto:
**o projeto hospedado, com o plano e o compute do piloto, aguenta o pico do piloto com folga?** Só um
projeto hospedado responde isso.

## 2. Pré-requisitos

- **Um projeto de STAGING hospedado.** Não pode ser a produção nem o projeto do piloto depois que ele
  tiver criança de verdade. Precisa ter o **mesmo plano, compute e região** do piloto (Pro + Small,
  `AMBIENTE-DE-PRODUCAO.md` §1). Número medido em outro compute não se transfere.
- **A mesma release** de migrations do piloto.
- **2 ou 3 clubes sintéticos** com unidades, membros, pontos, mural, chat, mensalidades e jogos, e os
  **recursos ligados**. A família `piloto` conta como falha qualquer 4xx de recurso desligado, e um
  clube do plano gratuito (como o C do staging local) recusa jogos e mensalidade. Parte das pessoas
  precisa estar em dois clubes: foi assim que a fase 9 achou o defeito da 78.
- **Contas sintéticas com senha conhecida**, num arquivo **fora do repositório**:
  `[{ "email": "...", "senha": "...", "clube": "<uuid do clube>" }]`. Recomendado: ≥ 30 por clube.
  Vários usuários virtuais podem dividir uma conta nas leituras. Nas escritas, o limite do chat é
  por pessoa, então mais contas dão um número mais limpo.
- **Pendência de povoamento (decisão do dono):** o `popular-staging.mjs` foi feito para o stack local
  e confirma o e-mail pelo Mailpit. No hospedado, a confirmação exige SMTP de verdade. Há dois
  caminhos. (a) Criar as contas já confirmadas pela Admin API (`auth.admin.createUser` com
  `email_confirm`, pela `service_role`, da máquina do dono): é um seeder novo, **não implementado**.
  (b) Desligar a confirmação **só no staging hospedado**, só durante o povoamento, e ligar de novo,
  **nunca** no projeto do piloto.

## 3. O pico esperado e a margem

**Margem confortável** = o degrau ≥ **pico esperado × 3** passa o SLO em **todas** as famílias que
rodaram. O critério foi escrito antes da primeira rodada, como na fase 9.

```
pico esperado = clubes do piloto × membros ativos por clube × fração que abre o app junto
              = 3 × 40 × 0,5 = 60   (padrão: troque pelos números reais dos clubes convidados)
alvo          = 60 × 3 = 180  →  o degrau de 200 tem de passar
```

`PICO_ESPERADO` (ou `CLUBES_PILOTO`, `MEMBROS_POR_CLUBE`, `FRACAO_SIMULTANEA`) e `MARGEM` mudam a
conta. O `plano` mostra qual degrau decide. Se nenhum degrau alcança o alvo, o `plano` avisa e sai
com 1.

## 4. Degraus

| | padrão | por quê |
|---|---|---|
| degraus | 10 → 25 → 50 → 100 → 200 | pequenos no começo: um erro de dataset aparece com 10, não com 200 |
| subida | 30 s | |
| patamar | 120 s | só o patamar entra na conta. 2 min dão amostra para p99 com poucos usuários |
| resfriamento | 60 s com 0 usuários entre um degrau e o seguinte | na fase 9, a família que abortou deixou a rede entupida, e a seguinte herdou 3–6% de falha. O degrau seguinte não pode herdar a fila do anterior |
| pausa entre famílias | 120 s | idem |
| duração | ~18 min por família | |

**Os tokens valem 1 hora** (`jwt_exp`), e cabem 2 ou 3 famílias por leva. O `rodar` confere antes de
cada família e **para**, pedindo `tokens` de novo, se a próxima não couber. O k6 repete a checagem
no início.

## 5. Cenários

| família | o que faz | escreve? |
|---|---|---|
| **piloto** | o dia de um membro, com as mesmas chamadas das telas. **Home**: `meu_contexto` + `meu_inicio`. Depois uma tela: 30% **ranking** (`ranking_totais`, unidades, `membros_do_clube`), 20% **mural** (300 fotos), 20% **chat** (conversa geral + 300 mensagens), 15% **jogos** (`status_jogos_do_dia`, `meu_progresso_trilha`), 15% a **própria mensalidade** (o aviso de cobrança). As proporções são estimativa, não medição | não |
| **rajada** | todos os usuários do degrau abrem o app em 10 s (o pico de um push) | não |
| **escrita** | mensagem no chat do clube + foto no mural (só a linha) | **sim**, só com `--escrever` |
| **upload** | arquivo no Storage | **sim**, só com `--escrever` |

**Login e refresh não viram família de carga, de propósito.** Todo o teste sai de **um** computador,
e portanto de um IP só. Com um IP, o login esbarra no limite por IP do Auth (30 por 5 min no
`config.toml`), e um "teste de carga de login" mediria o **limitador**, não a capacidade. As
perguntas que importam sobre login são outras, e cada uma tem o seu lugar:

- o limitador responde 429 rápido quando deve? → `AUTH-HOSPEDADO.md` §4;
- uma reunião de N crianças no mesmo Wi-Fi passa? → critério `limite-comporta-reuniao`;
- quanto demora um login de verdade? → o passo `tokens` mede isso: p50, p95 e os 429 de cada login,
  no ritmo de um a cada 11 s. Grava em `login.json`, sem nenhum token.

O refresh acontece uma vez por hora por pessoa. Na escala do piloto isso dá centésimos de
requisição por segundo. Um teste de refresh precisaria de **uma conta por usuário virtual**: os
refresh tokens giram, e reusar um entre usuários virtuais aciona a detecção de reuso, que derruba a
sessão. **Não foi implementado.**

## 6. SLO, parada e o que olhar no painel

- **"Aguenta"**, por degrau e só no patamar: falha ≤ 1%, p95 ≤ 1.000 ms, p99 ≤ 3.000 ms. É o mesmo
  critério da fase 9. Muda com `SLO_FALHA_PCT`, `SLO_P95_MS` e `SLO_P99_MS`.
- **Parada**: falha > 5%, p95 > 3 s ou p99 > 8 s, sobre o acumulado, depois de 20 s. A rodada aborta.
- **No painel, durante o patamar do degrau de margem** (Reports → Database): CPU do banco
  sustentada **abaixo de 80%**. Acima disso, "aguentou" vale só para hoje. É o gatilho de revisão
  do `AMBIENTE-DE-PRODUCAO.md` §1. Olhe também as conexões: nenhuma espera. Anote os dois números no
  `veredito.json`.
- **Latência de rede** entra no p95. Rode de uma máquina no Brasil, que é de onde as crianças acessam.

## 7. As guardas

Todas agem antes de qualquer requisição:

1. **Produção**: a mesma de `scripts/lib/hospedado.mjs`. A URL da produção vem de `.env` e
   `.env.production` daqui e do checkout principal, mais `AUTH_VERIFICAR_BLOQUEAR`. Alvo remoto sem
   produção conhecida também é recusado.
2. **`CARGA_BLOQUEAR`**: ponha aqui o projeto do **piloto** assim que ele tiver criança de verdade.
   Carga nunca roda onde há dado real.
3. **O k6 repete a guarda.** No modo local (o padrão), `BASE` fora da máquina é recusada. Com
   `ALVO=hospedado`, ele exige a lista `PRODUCAO_BLOQUEADA`, que o `rampa-hospedada.mjs` calcula, e
   recusa `BASE` que esteja nela. Recusa também token de outro projeto (`iss`) e token que expira
   antes do fim da rampa.
4. **Escrita** só com `--escrever`.
5. **Contas e tokens** nunca ficam dentro do repositório, a não ser em caminho coberto pelo
   `.gitignore`. O padrão é `<tmp>/conquista-carga-hospedada/`.

Uso local da fase 9 intacto: sem nenhuma variável nova, o `k6-rampa-fase9.js` gera **as mesmas
opções** de antes nas quatro famílias (conferido pelo `k6 inspect`, antes e depois).

## 8. Como rodar

```bash
export BASE_HOSPEDADO=https://<ref-do-staging-hospedado>.supabase.co
export ANON_HOSPEDADO=<anon do staging hospedado>
export PICO_ESPERADO=<clubes × membros × fração>     # ou deixe o padrão (60)

node supabase/carga/rampa-hospedada.mjs plano                       # confere tudo, sem carga
node supabase/carga/rampa-hospedada.mjs tokens /fora/do/repo/contas.json --rotulo hosp-AAAA-MM-DD
node supabase/carga/rampa-hospedada.mjs rodar piloto rajada --rotulo hosp-AAAA-MM-DD
# (e, com tokens novos, se quiser as escritas)
node supabase/carga/rampa-hospedada.mjs rodar escrita --escrever --rotulo hosp-AAAA-MM-DD
```

Saída: `<família>-k6.txt` (a tabela por degrau), `login.json` e `veredito.json`
(`margem_confortavel: SIM | NAO`), em `supabase/e2e/evidencias-fase9_1/carga-hospedada/<rótulo>/`.
O JSON bruto do k6 fica em `supabase/carga/resultado-hospedado-<família>.json`, ignorado pelo git.
Pré-requisito: Docker com a imagem `grafana/k6`, o mesmo da fase 9.

## 9. Limpeza depois de `--escrever`

No SQL Editor do **staging hospedado**, nunca em outro lugar:

```sql
delete from public.fotos where legenda = 'carga-rampa';
delete from public.chat_mensagens where texto like 'carga %' and created_at > now() - interval '1 day';
```

Os arquivos do `upload` (`mural/*-carga-*` no bucket `imagens`) se apagam pelo painel (Storage) ou
pela API do Storage. O SQL não apaga arquivo: o `storage.protect_delete` impede, e a fase 9 aprendeu
isso deixando 18.966 linhas órfãs.

## 10. 3.000 simultâneos continua sendo meta de arquitetura

O piloto é de 2–3 clubes. O gate dele é a margem do §3. **3.000 simultâneos** continua como meta de
arquitetura, e fica para um teste posterior. Esse teste precisa de três coisas que não fazem parte
do piloto: vários geradores de carga (vários IPs, várias máquinas ou k6 cloud), o compute alvo
daquela escala e um dataset de ~100 clubes, como o `gerar-dataset.sql` da fase 9. Os números
locais da fase 9 (500 aguentando, rajada de 3.000) continuam **não-validantes**.

## 11. O que foi provado nesta rodada

| o quê | resultado |
|---|---|
| uso local intacto | `k6 inspect` do script antes e depois, famílias leitura, escrita, upload e rajada: **opções idênticas** |
| guarda do k6 (com `--network none`) | recusou `BASE` remota no modo local; `ALVO=hospedado` sem lista; `BASE` = produção real; `ALVO` desconhecido |
| resfriamento | com `RESFRIAR_S=60`, as etapas ganham "descida 5 s + 60 s com 0" entre os degraus |
| guardas do `rampa-hospedada.mjs` | recusou a produção real (`plano` e `rodar`), `CARGA_BLOQUEAR`, `escrita` sem `--escrever` e arquivo de tokens dentro do repositório sem `.gitignore` |
| rodada de fumaça contra o **staging local** (só leitura, `piloto` + `rajada`, degraus 2 → 4, resfriamento 3 s) | 0% de falha. As 10 operações da família piloto responderam 2xx (contexto, início, ranking, unidades, conversa, chat, mural, jogos do dia, trilha, mensalidade). `membros` ficou de fora (`PULAR=membros`): a RPC `membros_do_clube` chega com a migration 80, que ainda não estava no staging. Veredito: **NAO-SE-APLICA** (alvo local). Evidência em `carga-hospedada/prova-staging-local/` |
| passo `tokens` (login de verdade) | **não exercitado**: ele cria sessões no Auth, e o staging é só leitura nesta rodada. Para a fumaça, os tokens foram assinados com a chave do staging local para 12 identidades sintéticas, com validade de 15 min, e apagados depois |
| capacidade do projeto hospedado | **não medida** (PENDENTE) |
