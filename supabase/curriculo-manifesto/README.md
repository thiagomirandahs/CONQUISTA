# Manifesto curricular 2026 — fase 2.5 (Consolidação Curricular)

Manifesto versionado e validável por máquina das **6 Classes Regulares** de Desbravadores (Amigo,
Companheiro, Pesquisador, Pioneiro, Excursionista, Guia), com as respectivas Classes Avançadas
pareadas. Transforma o levantamento de [`AUDITORIA-CURRICULO-OFICIAL.md`](../AUDITORIA-CURRICULO-OFICIAL.md)
em dados estruturados + um validador.

**Isto NÃO é o motor curricular de produção.** Nada aqui é lido pelo app nem pela migration 36/37 —
é um passo intermediário, só para provar proveniência, estrutura, versionamento e validação antes de
qualquer importação real em `curriculum_versions`/`classes`/`class_requirements`. Ver a seção
"Próximo passo" no fim.

## Estrutura

```
supabase/curriculo-manifesto/
  omds.json                  registro das OMDs citadas (número, data, status, fonte)
  classes/
    amigo.json                classe regular Amigo + classe avançada Amigo da Natureza
    companheiro.json          idem, Companheiro / Companheiro de Excursionismo
    pesquisador.json          idem, Pesquisador / Pesquisador de Campo e Bosque
    pioneiro.json             idem, Pioneiro / Pioneiro de Novas Fronteiras
    excursionista.json        idem, Excursionista / Excursionista na Mata
    guia.json                 idem, Guia / Guia de Exploração
  validar.mjs                validador + relatório de cobertura (CLI)
  validar.autoteste.mjs      autoteste do validador, com fixtures SINTÉTICAS
  gerar-importacao.mjs       (fase 3) gera a migration 40 + a fixture de teste A PARTIR deste manifesto
  conteudo-anual/            (fase 9.1) o conteúdo que muda todo ano (Curso de Leitura), um manifesto por ano
  validar-conteudo-anual.mjs (fase 9.1) validador do conteúdo anual (vigência fechada, sem lacuna, com fonte)
  gerar-conteudo-anual.mjs   (fase 9.1) gera o SQL de plataforma que publica um ano A PARTIR do manifesto validado
  conteudo-anual.autoteste.mjs  autoteste do validador/gerador do conteúdo anual (fixtures sintéticas)
  PUBLICACAO-CONTEUDO-ANUAL.md  procedimento operacional: quem publica, quando, como conferir, o que acontece se faltar
  README.md                  este arquivo
```

Rodar:
```bash
npm run curriculo:validar           # valida o manifesto real + imprime o relatório de cobertura
npm run curriculo:autoteste         # prova que o validador rejeita cada violação pedida (fixtures fake)
npm run curriculo:importacao:check  # a migration 40 e tests/_curriculo_regular_2026.sql batem com o manifesto? (gate)
npm run curriculo:importacao:gerar  # regera os dois (só depois de mudar o manifesto — e aí é VERSÃO NOVA, ver abaixo)
npm run curriculo:conteudo-anual:validar     # valida conteudo-anual/*.json (o Curso de Leitura de cada ano)
npm run curriculo:conteudo-anual:autoteste   # prova que o validador/gerador do conteúdo anual recusa o que deve
npm run curriculo:conteudo-anual:gerar -- 2027   # gera conteudo-anual/publicar-2027.sql a partir de conteudo-anual/2027.json
npm run curriculo:conteudo-anual:check       # o SQL gerado de cada ano ainda bate com o manifesto? (gate)
```

## Por que `publicado_em` ≠ `vigente_desde` (a regra mais importante daqui)

A auditoria descobriu que as páginas oficiais de classe são **vivas**: o carimbo de data/autor no
topo do artigo (ex.: "3 de novembro de 2017") nunca muda, mas o **conteúdo** é atualizado in-place
pela DSA conforme cada OMD entra em vigor — a página de Companheiro já mostra o livro definido pela
OMD 021/2024 (vigência plena só a partir de 2026), com o carimbo de 2017 intacto.

Por isso cada classe no manifesto tem os dois campos SEPARADOS, nunca um copiado do outro (o
validador rejeita se forem idênticos):

- **`fonte_base.publicado_em`**: o carimbo que a página mostra. Só serve pra saber "desde quando essa
  URL existe nesse formato" — não é vigência.
- **`vigente_desde`**: quando a versão ATUAL do conteúdo (já com todas as OMDs aplicadas) passou a
  valer de verdade — derivado da OMD mais recente que alterou (ou confirmou) a classe, respeitando
  qualquer período de transição que a própria OMD declare (ex.: OMD 021/2024 deu 2025 inteiro de
  transição; só é obrigatória a partir de `2026-01-01` — é essa data que entra em `vigente_desde`,
  não a data de publicação da OMD).

## O que cada campo de um requisito significa

```jsonc
{
  "id": "companheiro.I.5",              // único no manifesto inteiro (não só na classe)
  "codigo": "5",                        // código do item DENTRO da seção (como no cartão oficial)
  "ordem": 50,
  "descricao_resumida": "...",          // RESUMO/paráfrase curta — nunca o texto oficial completo
                                         // (ver "Direitos autorais" abaixo)
  "tipo": "simples",                    // simples (padrão) | anual_dinamico | escolha_n_de_m | escolha_n_de_m_sem_repeticao
  "escolha": { "n": 1, "opcoes": [...] },     // só quando tipo envolve escolha
  "grupo_sem_repeticao": "companheiro.especialidades_ja_concluidas_pela_pessoa", // só quando tipo = escolha_n_de_m_sem_repeticao
  "lacuna_schema": "escolha_n_de_m",    // marca qual das 4 lacunas da fase 2 este item exercita (se alguma)
  "status": "CONFIRMADO",               // CONFIRMADO (padrão) | ALTERADO_POR_OMD | PENDENTE_DE_VALIDACAO
  "alterado_por_omd": "OMD-021-2024",   // obrigatório quando status = ALTERADO_POR_OMD
  "confirmado_por_omd": "OMD-021-2024", // quando uma OMD reafirma "sem alteração" (reforça o CONFIRMADO)
  "proveniencia_pendente": {            // obrigatório (e SÓ permitido) quando status = PENDENTE_DE_VALIDACAO
    "motivo_pendencia": "...",
    "omd_referida": "OMD-007-2014",
    "acao_recomendada": "..."
  }
}
```

A **fonte** de um requisito é sempre a `fonte_base` da classe inteira (todo item de uma classe vem da
mesma página oficial) — não se repete em cada requisito. Um requisito só ganha campos extras quando
tem algo MAIS específico a dizer: uma OMD que o alterou/confirmou, ou uma pendência.

## As 4 lacunas de schema — modeladas aqui, ainda NÃO no banco

Tags `lacuna_schema` usadas no manifesto (contagem real no relatório de cobertura):

- **`requisito_anual_dinamico`**: "Ler o livro do Curso de Leitura do ano" — aparece em TODAS as 6
  classes regulares (item I.4), sempre distinto do "livro da classe" (item I.5, que só muda por OMD).
  O texto certo muda todo ano civil sem gerar uma nova versão da classe inteira.
- **`escolha_n_de_m`**: "Completar 1 das seguintes especialidades: a)... b)..." — o padrão mais comum
  do currículo (dezenas de ocorrências). `escolha.n` e `escolha.opcoes` capturam a regra.
- **`escolha_sem_repeticao`** (`escolha_n_de_m_sem_repeticao`): a variante "não realizada
  anteriormente" — a escolha não pode ser uma especialidade que a pessoa **já possui**, de qualquer
  classe/época anterior (não é só "não repetida nesta classe"; é o histórico inteiro da pessoa — ver
  a observação em cada ocorrência no manifesto). `grupo_sem_repeticao` é o rótulo do pool conceitual.
- **`prazo_conclusao`**: confirmado como regra real nas Classes de Liderança ("Líder: 1 a 3 anos";
  "Líder Máster: até 3 anos") — mas Liderança está **fora deste manifesto** de propósito (ver abaixo),
  então não há nenhuma instância real de `prazo_conclusao` nos dados das 6 Classes Regulares. O tipo
  fica definido aqui só como preparação de formato para quando Liderança entrar.

**Fase 2.6 (migration `20260921000038_motor-de-regras-curriculares.sql`)**: as 4 lacunas passaram a ter
representação própria no banco — sem achatar nada. O validador carrega o registro
`REPRESENTACAO_DAS_LACUNAS` (em `validar.mjs`) mapeando cada tag ao mecanismo que a representa, e
**rejeita** qualquer `lacuna_schema` fora dele (regra 8): uma tag desconhecida significaria conteúdo que
o schema ainda achataria. O relatório de cobertura imprime esse mapa no fim.

| tag | representação no banco |
|---|---|
| `requisito_anual_dinamico` | `dynamic_content_definitions` + `dynamic_content_values` (ano explícito, vigência FECHADA dentro do ano, sem sobreposição — migration 84) + `conteudo_dinamico_resolver(chave, data)` (dia no Brasil, nunca outro ano); `class_requirements.conteudo_dinamico_definicao_id`; o valor usado fica em `member_requirements.conteudo_fixado` |
| `escolha_n_de_m` | `requirement_option_groups(n_minimo)` + `requirement_options`; `opcoes_satisfeitas_automaticamente()` |
| `escolha_sem_repeticao` | `requirement_option_groups.sem_repeticao` + `especialidade_ja_concluida_pela_pessoa()` sobre `curriculum_achievements` (histórico curricular **portátil**, com proveniência) |
| `prazo_conclusao` | `classes/specialties.prazo_minimo_dias/prazo_maximo_dias` + `prazo_situacao()`; o gatilho de conclusão respeita o mínimo |

O manifesto em si NÃO mudou e continua NÃO importado — a fase 2.6 só deu ao motor a capacidade de
representá-lo. Importar é a próxima etapa, ainda dependente de aprovação.

## O que fica de fora deste manifesto (de propósito)

- **Classes de Liderança** (Líder, Líder Máster, Líder Máster Avançado): nenhum arquivo aqui as
  representa. Ficam de fora até existir hierarquia de aprovação acima do clube no modelo (Campo/
  Regional) — ver `AUDITORIA-CURRICULO-OFICIAL.md` §8 e §10.4.
- **Catálogo de Especialidades**: o manifesto só REFERENCIA nomes de especialidade como texto livre
  dentro de `escolha.opcoes` de uma Classe Regular/Avançada (porque é assim que o cartão de classe
  cita elas) — não existe um `especialidades/*.json` aqui. O Manual de Especialidades é produto
  comprado, não gratuito (ver auditoria §7); importar o catálogo é outra fase.
- **Rede social como fonte**: a possível OMD 022/2026 está registrada em `omds.json` com
  `status: "PENDENTE_DE_VALIDACAO"` só para o validador saber que ela existe-porém-não-conta — nenhum
  requisito deste manifesto se apoia nela, e o validador rejeita ativamente qualquer tentativa de
  citá-la como fonte de uma regra confirmada.

## Direitos autorais — por que `descricao_resumida` é curta

O texto completo de cada cartão é material da DSA/Casa Publicadora Brasileira. Cada
`descricao_resumida` é um RESUMO/paráfrase (o suficiente para entender do que se trata e provar a
estrutura/contagem), nunca uma cópia literal do cartão. O texto oficial completo, quando for a hora de
importar de verdade, deve ser copiado diretamente da fonte oficial (o `fonte_base.url` de cada
classe) — não reconstruído de memória nem copiado deste manifesto.

## Cobertura da fonte por classe avançada

Desde a **2026.4** as 6 avançadas estão com `cobertura: "completa"`: todas foram reconferidas item a item
contra o texto bruto da seção "CLASSE AVANÇADA" da página oficial (25/09/2026). `Amigo da Natureza` e
`Pesquisador de Campo e Bosque`, que até a 2026.3 vinham de um resumo automatizado, subiram para completa
nessa conferência. A pendência do item 11 de Pesquisador de Campo e Bosque (OMD 007/2014) foi resolvida
relendo o PDF original: "Item 11: excluído" + a transcrição do item que sai, sem "LEIA-SE" = exclusão
simples com renumeração — é exatamente o que a página viva mostra (ver `observacao` do item e `omds.json`).

## Fase 3 — este manifesto É a fonte do catálogo oficial (migrations 39/40)

As 6 Classes Regulares foram importadas pro banco **exclusivamente daqui**: `gerar-importacao.mjs` valida o
manifesto (mesmo `validarDados`), monta o pacote canônico (só `classe_regular` das 6 — as avançadas ficam
de fora), calcula o sha256 e gera `supabase/migrations/20260921000040_importar-classes-regulares-2026-1.sql`
(uma chamada a `curriculo_importar_classes_regulares(pacote, hash)`, definida na migration 39) e
`supabase/tests/_curriculo_regular_2026.sql` (o mesmo pacote, pro teste de integridade 36 comparar
manifesto → banco). Ninguém copia requisito pra SQL à mão. Regras que valem daqui pra frente:

- **Mudou o manifesto? É versão nova.** O importador recusa a MESMA `manifesto_versao` com outro conteúdo
  (hash diferente) — uma versão publicada nunca é editada. Suba `manifesto_versao` (e `gerado_em`) em todos
  os `classes/*.json`, regere (`curriculo:importacao:gerar`) e a migration nova cria outra `curriculum_version`;
  a anterior fica, com o histórico de quem andou nela.
- **`curriculo:importacao:check` é gate**: manifesto editado sem regerar = falha.
- **`36_curriculo_oficial_integridade.sql` é gate permanente**: requisito editado à mão no SQL = falha.
- O valor anual do Curso de Leitura NÃO está no manifesto das classes nem na migration de importação — tem
  manifesto PRÓPRIO, um por ano, em `conteudo-anual/<ano>.json` (fase 9.1, migration 84). O validador exige
  ano explícito, vigência fechada dentro do ano, fonte e o ano inteiro coberto para as seis classes; o
  gerador produz o SQL de plataforma (`conteudo_anual_publicar(pacote, hash)`), a única porta de publicação.
  Quem publica, quando (antes de 1º de janeiro) e como conferir: [`PUBLICACAO-CONTEUDO-ANUAL.md`](PUBLICACAO-CONTEUDO-ANUAL.md).

O que ainda NÃO é importado: Liderança, catálogo de Especialidades. (As Classes Avançadas entram desde a
2026.4 — ver abaixo.)

### Classes Avançadas no pacote (2026.4, migrations 120/121)

- O gerador põe a `classe_regular` das 6 em `classes` (como sempre) e cada `classe_avancada` **sem pendência** em
  `classes_avancadas` (a `secao_unica` vira `secoes: [..]`). Avançada com requisito `PENDENTE_DE_VALIDACAO` fica
  FORA do pacote e o gerador avisa — nunca se publica pendência.
- Cada avançada declara `idade_minima` (= a da regular pareada; o validador e o importador recusam diferente),
  `vigente_desde` (a do cartão da regular — é o mesmo cartão/página) e a seção única com `codigo`/`ordem`.
- **Pré-requisito** (fonte: https://www.adventistas.org/pt/desbravadores/classes/ — "Classes Avançadas …
  seguindo a idade da classe regular correspondente"): a avançada exige a regular pareada **iniciada ou
  concluída** (feita junto ou depois). A fonte oficial não diz que a regular precisa estar concluída antes, então
  isso não foi inventado. Fica em `curriculum_dependencies` (`modo = 'iniciada_ou_concluida'`, migration 120) e é
  checado por CÓDIGO em qualquer versão oficial (Amigo feita/iniciada na 2026.3 vale para a avançada da 2026.4).
  Se o manual/OMD exigir conclusão, basta `update curriculum_dependencies set modo = 'concluida'`.
- Número da migration de uma versão nova: próximo livre, ou `CURRICULO_MIGRATION_NUMERO=<14 dígitos>` quando há
  faixa reservada (a 2026.4 foi gerada com `20260930000121`).

### Revisões do manifesto (histórico)

Cada `classes/*.json` pode ter uma chave de topo `revisoes` (fora de `classe_regular`; o gerador não a
inclui no pacote — é proveniência da revisão, não conteúdo): `versao`, `data`, `itens`, `fonte` e `motivo`.

- **2026.4 (25/09/2026)** — publica as **6 Classes Avançadas** (63 requisitos, cada um com `tipo_evidencia`, descrição
  em paráfrase própria, escolhas N-de-M nominadas). Regulares **inalteradas** em conteúdo; mesmo assim é versão nova
  do pacote (hash novo), então a `20260930000121` (gerada) publica a 2026.4 e **arquiva** a 2026.3 — quem começou na
  2026.3 continua nela (envio/avaliação não exigem versão publicada; só iniciar exige). Importador:
  `20260930000120_importador-classes-avancadas.sql`.
- **2026.3 (25/09/2026)** — achado em produção: todo requisito nascia com `tipo_evidencia='nenhuma'` e a tela
  não oferecia como comprovar nada. Cada requisito passa a ter a chave opcional **`tipo_evidencia`**
  (`nenhuma` = a liderança confere pessoalmente | `texto` = produção escrita/explicação | `foto` = atividade
  prática, serviço, evento) e, opcional, **`evidencia_obrigatoria`** (padrão: true para texto/foto). O importador
  aceita as duas desde a migration `20260930000105_importador-tipo-de-comprovacao.sql`; a 2026.3 é publicada pela
  `20260930000106` (gerada), que arquiva a 2026.2. Também: `descricao_resumida` enriquecida (paráfrase própria) e
  escolhas nominadas; divergências site × cartão agrupado resolvidas pelo site oficial + OMD 021/2024 (ver `revisoes`
  de cada `classes/*.json`).
- **2026.2 (22/09/2026)** — revisão pontual de `amigo.IX.1` contra a página oficial (texto bruto): o oficial é
  "Completar uma especialidade na área de Artes e habilidades manuais." — categoria **aberta**, sem lista.
  A 2026.1 representava isso como uma opção artificial entre parênteses (erro de representação nosso). Passa
  a `escolha: {n: 1}` **sem `opcoes`** (= o cartão não lista opções; a área está no texto; na tela vira
  "qual especialidade você fez?"), como `companheiro.IX.1`. De quebra, `amigo.VII.1` alínea e) é
  **"Aves de estimação"** (não "Aves"). A migration 43 (gerada) publica a 2026.2 e **arquiva** a 2026.1
  (migration 40 fica intocada — história; quem começou nela continua nela). O importador (migration 42)
  passou a aceitar `escolha_n_de_m` com `escolha.n` e sem `opcoes`, e a arquivar a publicada anterior do
  mesmo identificador ao importar uma versão nova.
- **2026.1 (22/09/2026)** — primeira importação (migration 40).

Regra do gerador: uma migration POR versão (`..._importar-classes-regulares-<versão>.sql`); a da versão
atual é encontrada pelo slug (e conferida por `--check`); versão nova ganha o próximo número livre.
