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
  README.md                  este arquivo
```

Rodar:
```bash
npm run curriculo:validar      # valida o manifesto real + imprime o relatório de cobertura
npm run curriculo:autoteste    # prova que o validador rejeita cada violação pedida (fixtures fake)
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
| `requisito_anual_dinamico` | `dynamic_content_definitions` + `dynamic_content_values` (vigência sem sobreposição) + `conteudo_dinamico_resolver(chave, data)`; `class_requirements.conteudo_dinamico_definicao_id` |
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

`Companheiro de Excursionismo`, `Excursionista na Mata`, `Pioneiro de Novas Fronteiras` e
`Guia de Exploração` foram lidas **integralmente**, texto bruto, direto da página oficial
(`cobertura: "completa"`). `Amigo da Natureza` e `Pesquisador de Campo e Bosque` vieram de um resumo
extraído automaticamente da mesma página oficial (`cobertura: "resumo_fonte_oficial"`) — confiável
(mesma fonte primária), mas não conferido item a item contra o texto bruto. As 6 Classes Regulares
(o pedido explícito desta fase) foram todas lidas de forma completa.

## Próximo passo (não fazer sem aprovação)

Depois de aprovado, o caminho natural é: (1) evoluir o schema pras 4 lacunas (ou decidir
conscientemente não representá-las ainda, documentando a perda), (2) escrever um importador que leia
este manifesto e gere as linhas de `curriculum_versions`/`classes`/`class_sections`/
`class_requirements` com `origem='oficial'`, preenchendo `fonte_hash`/`fonte_arquivo`/`importado_em`/
`importado_por` (migration 37) a partir da proveniência já capturada aqui. Esta fase 2.5 não faz isso.
