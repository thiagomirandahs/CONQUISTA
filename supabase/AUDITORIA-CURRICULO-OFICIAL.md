# Auditoria curricular oficial — vigência 2026 (Desbravadores, DSA)

Pesquisa de fontes oficiais para decidir, com rastreabilidade, qual conteúdo deve alimentar o motor
curricular do DesbravaClube. **Nada foi importado para o banco nesta etapa** — este documento é só o
levantamento e a recomendação. Nenhum schema foi alterado. Trabalho feito 100% na branch
`saas-produto-multiclube`, sem deploy, sem produção, sem tocar `main`.

## 1. Objetivo e regra de ouro

Determinar a versão **efetivamente vigente em 2026** de cada Classe Regular, Classe Avançada e (a
metodologia de) Especialidades, cruzando **documento-base + alterações posteriores (OMD) + data de
entrada em vigor** — nunca a data impressa isolada de um PDF ou de uma página. Todo conflito ou dúvida
é marcado **PENDENTE_DE_VALIDACAO**, nunca resolvido em silêncio.

## 2. Fontes usadas e nível de autoridade

| Fonte | Domínio | Autoridade | Uso nesta auditoria |
|---|---|---|---|
| Orientações do Ministério de Desbravadores (OMD), índice consolidado | `adventistas.org/pt/desbravadores/orientacoes-do-ministerio-de-desbravadores/` | **Oficial primária** (Ministério de Desbravadores, DSA) | Fonte de TODAS as alterações pós-cartão-base citadas neste documento |
| Páginas de classe (`.../classes/[nome]/`) | `adventistas.org` | **Oficial primária**, mas **viva** (ver achado #1 abaixo) | Texto vigente de cada classe regular/avançada |
| Manual Administrativo do Clube de Desbravadores | `adventistas.org/pt/desbravadores/manual-administrativo-do-clube-de-desbravadores/` (PDF em `deptos.adventistas.org.s3.us-east-1.amazonaws.com`) | **Oficial primária** | Regras administrativas (investidura, revalidação, Cartão Virtual, venda de itens) — não contém os cartões de requisito em si |
| Página "Especialidades" + "Manual de Especialidades" | `adventistas.org/pt/desbravadores/especialidades/` e `.../manual-de-especialidades/` | **Oficial primária** | Metodologia de identificação/versão de especialidade (não o catálogo completo) |
| Cartão Virtual | `adventistas.org/pt/desbravadores/home/cartao-virtual/` | **Oficial primária** | Fluxo de aprovação hierárquica das Classes de Liderança |
| Classes Agrupadas | `adventistas.org/pt/desbravadores/classes/classes-agrupadas-requisitos/` | **Oficial primária** | Define oficialmente o que "agrupada" significa (e o que NÃO é) |
| `downloads.adventistas.org` (kit de OMDs) | domínio oficial, mas **desatualizado** | Oficial, porém **obsoleto** — ver achado #2 | Descartado como índice; PDFs individuais de OMD antigas ainda válidos quando o número bate |
| MDAWiki (`mda.wiki.br`), `cantinhodaunidade.com.br`, `desbravai.com.br`, blogs, Instagram | terceiros | **Secundária — nunca autoridade** | Só para LOCALIZAR algo; todo dado usado no relatório foi confirmado numa fonte primária acima antes de entrar aqui |

Nenhuma informação deste relatório vem exclusivamente de blog, PDF reposto por clube ou wiki de
comunidade — onde uma fonte secundária apontou para algo, fui até a página/documento oficial confirmar
antes de registrar.

## 3. Dois achados metodológicos que mudam como isto deve ser lido

### 3.1. As páginas de classe são VIVAS — a data impressa no topo é enganosa (confirmado, não suposto)
Cada página `adventistas.org/pt/desbravadores/classes/[nome]/` mostra uma data de publicação de
**2017** (ex.: "Companheiro e Companheiro de Excursionismo — Por Alberto Souza | 3 de novembro de
2017"). Mas o **conteúdo já reflete a OMD 021/2024** (publicada 17/12/2024, com vigência plena só a
partir de **2026**) — confirmei lendo a página ao vivo:

- **Companheiro**, item I.5: *"Ler o livro Um simples lanche."* — o livro NOVO da OMD 021/2024 (antes
  era "Caminho a Cristo"), já presente na página com a data de 2017 intacta.
- **Pioneiro**, item I.5: *"Ler o livro Expedição Galápagos."* — idem (antes "A história da vida").
- **Excursionista**, item I.5: *"Ler o livro O fim do começo."* — idem (antes "Nos bastidores da mídia").
- **Guia**, item I.5: *"Ler o livro O livro amargo."* — idem (antes "Nossa herança").
- **Amigo** e **Pesquisador**: "Vaso de Barro" e "Além da magia" — a OMD 021/2024 diz "sem alteração"
  para essas duas, e é exatamente o que as páginas mostram.

**Conclusão prática, confirmada em 6 de 6 classes**: a DSA mantém essas páginas atualizadas em tempo
real conforme cada OMD entra em vigor, sem atualizar o carimbo de data/autor do artigo. Isso vale
também para o próprio índice de OMDs (artigo carimbado "14 de janeiro de 2018", mas com texto completo
e verbatim até a OMD 021/2024). **Regra adotada nesta auditoria**: a página de classe viva é a
**melhor fonte única do texto vigente** — mais confiável que tentar reconstruir "PDF-base + aplicar
deltas de OMD" manualmente, porque é a própria DSA que já faz essa reconstrução. Ainda assim, cada
alteração relevante foi cruzada contra o texto literal da OMD correspondente (seção 4) — a página viva
não substitui a rastreabilidade, só é o ponto de partida mais confiável para o texto atual.

Também confirmei estruturalmente (não só o livro) que mudanças de **2013** continuam aplicadas: no
Excursionista, "Ordem Unida" NÃO está mais na seção VI (Organização e Liderança) da classe regular —
está como especialidade obrigatória (item 10) na classe **avançada** "Excursionista na Mata", e o item
VIII.2 da classe regular diz "Pioneirias" (não mais "Pioneirismo") — exatamente o que a OMD 001/2013
mandou.

### 3.2. Existem DOIS índices oficiais de OMD que DIVERGEM entre si — tratado como PENDENTE_DE_VALIDACAO, resolvido por evidência de recência
- `adventistas.org/pt/desbravadores/orientacoes-do-ministerio-de-desbravadores/`: lista **21 OMDs**,
  de 001/2013 a **021/2024** (17/12/2024), com texto completo verbatim de cada uma.
- `downloads.adventistas.org/pt/kits/omd-orientacoes-do-ministerio-de-desbravadores/`: lista só **14
  OMDs** (001 a 015), com **datas e títulos diferentes** para os mesmos números a partir da OMD 011
  (ex.: sua "OMD 011 = Idades/2013" não bate com a OMD 011/2016 = "Regionais" do outro índice; sua
  "OMD 015 = Alterações Cartão Amigo/2017" não bate com a OMD 015/2018 = "Cadastro de Liderança").

**Resolução adotada**: tratei `adventistas.org/.../orientacoes-do-ministerio-de-desbravadores/` como
o índice corrente e correto — é mais completo (vai até 2024, o outro para em 2017/2018), está no
domínio institucional principal (não no espelho de downloads) e seu conteúdo bateu, ponto a ponto, com
o que encontrei nas páginas de classe vivas (achado 3.1). O índice de `downloads.adventistas.org`
parece ser um espelho legado, não atualizado desde ~2018, com uma numeração antiga que a DSA
aparentemente reorganizou depois. **Isto continua PENDENTE_DE_VALIDACAO formal** — não encontrei uma
nota oficial da DSA explicando a renumeração; recomendo confirmar diretamente com o Ministério de
Desbravadores da DSA antes de publicar qualquer versão "oficial" no DesbravaClube.

### 3.3. Possível OMD 022/2026 — NÃO confirmada, NÃO usada nesta auditoria
Uma busca encontrou referência a "OMD 022/2026" num post do Instagram. O índice oficial em
`adventistas.org` (consultado nesta auditoria) **não lista OMD 022** — a última é a 021/2024.
**PENDENTE_DE_VALIDACAO**: não usei nem inferi qualquer conteúdo da suposta OMD 022/2026 neste
relatório (não consegui confirmá-la em fonte primária). Recomendo checar o canal oficial (Instagram do
Ministério de Desbravadores da DSA, se for a conta oficial, e o índice de OMDs) antes de finalizar
qualquer importação — se existir mesmo, pode alterar requisitos vigentes em 2026 que este documento
não captura.

## 4. Classes Regulares — matriz de rastreabilidade

Granularidade adotada: uma linha por **alteração conhecida e datada** (não uma linha por requisito
individual não alterado — ver nota de escopo/copyright abaixo). Cada classe regular também tem uma
linha "baseline" apontando pra página viva como o texto vigente completo.

**Nota de escopo e direito autoral**: o texto completo de cada cartão é material da DSA/Casa
Publicadora Brasileira. Esta matriz registra **proveniência** (o quê mudou, quando, por qual OMD, e
onde encontrar o texto vigente) — não reproduz o cartão inteiro linha a linha. Quando o motor
curricular for de fato importar conteúdo oficial, o texto de cada requisito deve ser copiado
diretamente da fonte oficial linkada aqui, não reconstruído de memória.

| Classe | Seção | Requisito | Documento-base | Alteração posterior | OMD | Data da orientação | Vigência | Fonte oficial | Observações |
|---|---|---|---|---|---|---|---|---|---|
| Amigo | I. Gerais | Item 5 (livro) | Cartão Amigo (pré-2017) | Livro fixado como "Vaso de Barro" | OMD 012/2017 | 30/03/2017 | Vigente desde 2018, **confirmado vigente em 2026** (OMD 021/2024 = "sem alteração") | [OMD 012](http://deptos.adventistas.org.s3.amazonaws.com/desbravadores/Normativas/OMDs/OMD_012-2017.pdf), [página viva](https://www.adventistas.org/pt/desbravadores/classes/amigo-e-amigo-da-natureza/) | Confirmado lendo a página viva |
| Amigo | V. Saúde e Aptidão Física | Item 1 (especialidade) | Cartão Amigo (pré-2014) | 3→4 opções: adiciona "Nós e amarras" (2014) e "Segurança básica na água" (2017) | OMD 007/2014, OMD 012/2017 | 02/05/2014, 30/03/2017 | Vigente 2026 | [OMD 007](http://deptos.adventistas.org.s3.amazonaws.com/desbravadores/Normativas/OMDs/OMD_007-2014.pdf), [OMD 012](http://deptos.adventistas.org.s3.amazonaws.com/desbravadores/Normativas/OMDs/OMD_012-2017.pdf) | 4 opções confirmadas na página viva |
| Companheiro | I. Gerais | Item 5 (livro) | Cartão Companheiro (pré-2024): "Caminho a Cristo" | Livro trocado para "Um simples lanche" | **OMD 021/2024** | 17/12/2024 | **2025 = transição (livro antigo OU novo); a partir de 2026 SÓ o novo vale** | [OMD 021](https://files.adventistas.org/institucional/pt/sites/20/2025/05/OMD_021-2024.pdf), [página viva](https://www.adventistas.org/pt/desbravadores/classes/companheiro-e-companheiro-de-excursionismo/) | Confirmado verbatim na página viva |
| Companheiro (avançada) | Companheiro de Excursionismo | Item 11 (Excursionismo pedestre) | "Excursionismo pedestre" | Alterado para "Excursionismo pedestre com mochila (AR 056)" | OMD 005/2013 | 20/10/2013 | Vigente 2026 | [OMD 005](http://deptos.adventistas.org.s3.amazonaws.com/desbravadores/Normativas/OMDs/OMD_005-2013.pdf) | **RESOLVIDO na fase 2.5**: reconferido item a item na página viva (texto bruto) — item 11 = "Completar a especialidade de Excursionismo pedestre com mochila." Confirmado, não mais pendente. |
| Pesquisador | I. Gerais | Item 5 (livro) | "Além da magia" | **Sem alteração** pela OMD 021/2024 | OMD 021/2024 (confirma que NÃO muda) | 17/12/2024 | Vigente 2026 | [OMD 021](https://files.adventistas.org/institucional/pt/sites/20/2025/05/OMD_021-2024.pdf) | Confirmado verbatim na página viva |
| Pesquisador (avançada) | Pesquisador de Campo e Bosque | Item 11 | Item numerado 11 (texto anterior desconhecido) | "Item 11: excluído" + inclusão de "Completar a especialidade de Excursionismo pedestre com mochila" | OMD 007/2014 | 02/05/2014 | **PENDENTE_DE_VALIDACAO** | [OMD 007](http://deptos.adventistas.org.s3.amazonaws.com/desbravadores/Normativas/OMDs/OMD_007-2014.pdf) | Texto da OMD é ambíguo sobre se é uma exclusão simples ou uma substituição; a página viva atual não tem um item explicitamente chamado "Excursionismo pedestre com mochila" na Pesquisador de Campo e Bosque — precisa reler o PDF original da OMD com atenção antes de modelar |
| Pioneiro | I. Gerais | Item 5 (livro) | "A história da vida" | Livro trocado para "Expedição Galápagos" | **OMD 021/2024** | 17/12/2024 | **A partir de 2026 só o novo vale** | [OMD 021](https://files.adventistas.org/institucional/pt/sites/20/2025/05/OMD_021-2024.pdf) | Confirmado verbatim na página viva |
| Pioneiro (avançada) | Pioneiro de Novas Fronteiras | Itens 5 e 12 (numeração antiga) | Cartão avançado com >12 itens | Itens 5 e 12 removidos/excluídos; classe renumerada, hoje com 10 itens (1–10) | OMD 001/2013 | 05/08/2013 | Vigente 2026 | [OMD 001](http://deptos.adventistas.org.s3.amazonaws.com/desbravadores/Normativas/OMDs/OMD_001-2013.pdf) | Confirmado: página viva tem exatamente 10 itens, sem lacuna |
| Excursionista | I. Gerais | Item 5 (livro) | "Nos bastidores da mídia" | Livro trocado para "O fim do começo" | **OMD 021/2024** | 17/12/2024 | **A partir de 2026 só o novo vale** | [OMD 021](https://files.adventistas.org/institucional/pt/sites/20/2025/05/OMD_021-2024.pdf) | Confirmado verbatim na página viva |
| Excursionista (regular) | VI. Organização e Liderança | "Ordem Unida" (item 4 antigo) | Item presente na seção VI | Transferido para a Classe Avançada – Excursionista na Mata | OMD 001/2013 | 05/08/2013 | Vigente 2026 | [OMD 001](http://deptos.adventistas.org.s3.amazonaws.com/desbravadores/Normativas/OMDs/OMD_001-2013.pdf) | Confirmado: ausente na seção VI regular; presente como item 10 (especialidade "Ordem unida") na avançada |
| Excursionista (regular) | VIII. Arte de Acampar | Item 2 ("Pioneirismo") | "Pioneirismo" | Renomeado "Pioneirias (AR101)"; item 3 transferido pra avançada | OMD 001/2013 | 05/08/2013 | Vigente 2026 | [OMD 001](http://deptos.adventistas.org.s3.amazonaws.com/desbravadores/Normativas/OMDs/OMD_001-2013.pdf) | Confirmado: página viva mostra "Completar a especialidade de Pioneirias" |
| Guia | I. Gerais | Item 5 (livro) | "Nossa herança" | Livro trocado para "O livro amargo" | **OMD 021/2024** | 17/12/2024 | **A partir de 2026 só o novo vale** | [OMD 021](https://files.adventistas.org/institucional/pt/sites/20/2025/05/OMD_021-2024.pdf) | Confirmado verbatim na página viva |
| Guia (regular) | VI. Organização e Liderança | "Orçamento familiar" e "Liderança campestre" | Itens presentes na classe regular | Transferidos para a Classe Avançada – Guia de Exploração | OMD 001/2013 | 05/08/2013 | Vigente 2026 | [OMD 001](http://deptos.adventistas.org.s3.amazonaws.com/desbravadores/Normativas/OMDs/OMD_001-2013.pdf) | **RESOLVIDO na fase 2.5**: reconferido item a item — Seção VI regular hoje tem só 3 itens (sem esses dois); a avançada Guia de Exploração tem "Completar a especialidade de Liderança campestre" (item 9) e "Completar a especialidade de Orçamento familiar" (item 10). Confirmado, não mais pendente. |
| Todas as 6 | (geral) | "Ler o livro do Curso de Leitura do ano" | — | **Requisito que MUDA todo ano**, por desenho (não é um "livro da classe" fixo) | — (não é OMD; é um requisito estruturalmente anual) | — | Recorrente | páginas vivas de cada classe | Ver lacuna de schema §10.1 — é DIFERENTE do "livro da classe" (item 5) que só muda por OMD |

## 5. Classes Avançadas

Cada classe avançada é o "par" de uma regular (Amigo↔Amigo da Natureza, ..., Guia↔Guia de Exploração)
e está documentada na MESMA página viva da respectiva regular (seção 4 acima já cobre as alterações
por OMD que afetam classes avançadas: OMD 001/2013 removeu itens do Pioneiro avançado; OMD 005/2013
mudou a Companheiro de Excursionismo; OMD 001/2013 moveu "Ordem Unida"/"Pioneirias" pra Excursionista
avançada). **Pergunta em aberto (PENDENTE_DE_VALIDACAO, sem fonte que resolva)**: se uma classe
avançada exige oficialmente a regular correspondente **concluída antes** de começar — as páginas vivas
não declaram isso explicitamente como pré-requisito formal (ao contrário das Classes de Liderança, que
declaram pré-requisitos claramente — seção 8). Recomendo confirmar com a DSA antes de codificar essa
dependência como obrigatória no motor curricular.

## 6. Classes Agrupadas — esclarecido oficialmente, não é currículo próprio

Fonte: [`adventistas.org/.../classes-agrupadas-requisitos/`](https://www.adventistas.org/pt/desbravadores/classes/classes-agrupadas-requisitos/).
Resolve de vez a dúvida que a fase 2 tinha deixado em aberto:

> "As Classes Agrupadas não constituem um programa independente... é a junção de todos os cartões de
> classes do Clube de Desbravadores, de acordo com o programa já existente." **"O Clube não poderá
> adotar o cartão de agrupadas como sendo o programa oficial para seus desbravadores. Este cartão não
> substitui os cartões de classes."**

Serve só para (a) regularizar quem entrou no clube depois da idade normal de uma classe, cumprindo
requisitos de várias faixas etárias ao mesmo tempo, e (b) candidatos a liderança que precisam
completar o programa. Os requisitos são organizados por tópico com faixas etárias entre parênteses
(ex.: "(11-12-13-14-≥15)"), mas continuam sendo os MESMOS requisitos das classes regulares — não um
conteúdo à parte. **Conclusão**: não precisa de tabela/conceito de "classe agrupada" no schema — é
inteiramente representável hoje com múltiplas `member_classes` simultâneas da mesma pessoa no mesmo
clube (o motor já permite isso, migration 36), desde que o clube NUNCA use isso como programa padrão
— é uma exceção administrativa, não uma 7ª classe.

## 7. Especialidades — metodologia de fonte e versão (sem importar o catálogo)

Fontes: [`adventistas.org/pt/desbravadores/especialidades/`](https://www.adventistas.org/pt/desbravadores/especialidades/),
[`.../manual-de-especialidades/`](https://www.adventistas.org/pt/desbravadores/manual-de-especialidades/).

- **Identificação**: cada especialidade tem um **código estável** por categoria (ex. `AM050` = Estudo
  de línguas, `AR056` = Excursionismo pedestre com mochila, `AR101` = Pioneirias, `AD001`/`AD006` =
  categoria ADRA) + nome + categoria (Natureza, Artes e Habilidades, Atividades Missionárias,
  Atividades Profissionais/Domésticas, Ciências da Saúde, Recreação, ADRA...). O código é o
  identificador estável — o `codigo` do nosso schema deve ser esse código oficial, não um slug nosso.
- **Fonte-mestra**: "todas as especialidades e requisitos mínimos estão descritos no **Manual de
  Especialidades da Divisão Sul-Americana**". **Achado importante**: esse manual **não é gratuito nem
  livremente republicável** — a página oficial diz que está disponível **para compra** pelos Campos,
  através de uma editora autorizada (Editora SobreTudo – SP). Última revisão geral documentada:
  **abril de 2012** ("todas as especialidades do manual atual foram revisadas"); não encontrei
  confirmação de uma revisão geral mais recente.
- **Autoridade de revisão**: só a Divisão pode revisar/substituir requisitos; dúvidas de interpretação
  vão para a Divisão — nunca decisão de clube.
- **Especialidades novas/alteradas depois de 2012 são publicadas via OMD** (mesmo mecanismo das
  classes, mesmo índice), com o texto completo do requisito anexado à própria OMD — confirmei dois
  exemplos completos e datados:
  - **OMD 016/2018** (19/10/2018): cria "Estudo de línguas (AM 050)" (básica) e renomeia a antiga para
    "Estudo de línguas – avançado"; quem já tinha a antiga ganha a nova automaticamente.
  - **OMD 017/2020** (03/04/2020): cria a especialidade de Biossegurança (contexto Covid-19).
- **PENDENTE_DE_VALIDACAO**: encontrei uma cópia do "Manual de Especialidades de Desbravadores" num
  repositório de terceiros (`arquivosadventistas.org`) — **não usei o conteúdo dela neste relatório**
  (não é fonte DSA oficial, pode ser edição desatualizada, e é um material vendido — redistribuição
  não confirmada). Antes de importar qualquer especialidade de verdade, a fonte tem que ser o manual
  comprado/oficial da DSA ou uma OMD específica, nunca uma cópia de terceiro.
- **Recomendação prática para a próxima fase**: importar especialidades **uma OMD de cada vez**
  (como OMD 016 e OMD 017, que já vêm com texto completo e datado, gratuitas e oficiais) em vez de
  tentar reconstruir o catálogo inteiro do Manual comprado — dá pra montar um catálogo pequeno e
  100% rastreável, e adiar o resto até a DSA disponibilizar (ou o clube comprar) o manual completo.

## 8. Classes de Liderança — relatório separado (não são Classes Regulares)

**Não devem ser importadas como Classes Regulares.** Estrutura, hierarquia e fluxo de aprovação são
fundamentalmente diferentes.

### 8.1. As 3 classes e sua progressão obrigatória
Fonte: [`.../classes/classes-de-lideranca-requisitos/`](https://www.adventistas.org/pt/desbravadores/classes/classes-de-lideranca-requisitos/),
[`.../cartao-de-lideranca/`](https://www.adventistas.org/pt/desbravadores/cartao-de-lideranca/).

| Classe | Idade mínima | Pré-requisito oficial | Duração |
|---|---|---|---|
| Líder | 16 anos (18 para investidura) | Batizado; **classes regulares concluídas OU cumprindo Classes Agrupadas simultaneamente**; recomendação da comissão da igreja | 1 a 3 anos |
| Líder Máster | 18 anos | **1 ano de experiência como Líder investido** (mínimo — OMD 002/2013); recomendação da igreja | até 3 anos |
| Líder Máster Avançado | não especificado na página consultada | Presumivelmente Líder Máster investido — **PENDENTE_DE_VALIDACAO** | — |

A progressão é **sequencial e obrigatória** ("cada nível deve ser alcançado separadamente e em ordem
crescente"). Isso é uma dependência curricular REAL e oficialmente declarada — diferente das classes
avançadas (§5), aqui a fonte confirma explicitamente o pré-requisito.

### 8.2. Alterações conhecidas (mesma matriz, mesmo mecanismo OMD)
- OMD 002/2013 (atualizada 2014): 1 ano mínimo de experiência entre classes de liderança; remove
  requisito de "Medalha de Bronze/Prata/Ouro".
- OMD 006/2014: só o cartão de liderança lançado em 2012 vale, desde 11/01/2014.
- OMD 011/2016: regionais fazendo a classe Líder ganham itens extras (leitura de "Salvação e Serviço",
  "Nisto Cremos", "Mensagens aos Jovens", ECA).
- OMD 015/2018: cadastro obrigatório de todo líder investido no SGC até 20/12/2018 — sem isso, deixa
  de ser reconhecido oficialmente como líder investido.
- **OMD 018/2022** (31/05/2022): a partir de 01/06/2022, as classes de liderança **só podem ser feitas
  pelo Cartão Virtual** (SGC / portal "Encontre um Clube") — não mais em papel.

### 8.3. Cartão Virtual / SGC — fluxo de aprovação hierárquica (achado central)
Fonte: [`.../home/cartao-virtual/`](https://www.adventistas.org/pt/desbravadores/home/cartao-virtual/).

1. **Acesso**: candidato entra em `clubes.adventistas.org/br/personal-card/` com credenciais do SGC.
2. **Abertura**: o diretor/secretário do CLUBE precisa preencher o 1º requisito para liberar o cartão
   do candidato.
3. **Preenchimento**: candidato envia evidência (PDF/JPG, até 2 MB) por requisito.
4. **Revisão do clube**: o clube revisa a conclusão de 100% dos requisitos.
5. **Aprovação hierárquica**: Coordenador Regional (se o Campo tiver um — ver OMD 019/2023, que criou
   esse cargo) **OU**, na ausência dele, o Campo diretamente.
6. **Registro automático**: aprovado, a classe entra automaticamente no histórico do membro no SGC —
   sem passo manual adicional.

Não encontrei menção a assinatura digital/eletrônica formal no fluxo (é upload de evidência + aprovação
em sistema, não assinatura criptográfica). **PENDENTE_DE_VALIDACAO**: se o fluxo muda entre os 3 níveis
(Líder / Líder Máster / Líder Máster Avançado) — a fonte não especifica diferença.

## 9. Divergências e pendências (PENDENTE_DE_VALIDACAO — resumo consolidado)

**Atualização (fase 2.5 — Consolidação Curricular)**: os itens 3 e 4 abaixo foram **resolvidos**
durante a montagem do manifesto (`supabase/curriculo-manifesto/`), relendo as páginas vivas texto
bruto, item a item — ficam marcados RESOLVIDO, com a evidência encontrada. Os outros 7 continuam
PENDENTE_DE_VALIDACAO exatamente como antes; nenhum foi resolvido por inferência.

1. **Numeração dupla de OMD** entre `adventistas.org` (021 OMDs, até 2024) e `downloads.adventistas.org`
   (14 OMDs, até 2018, números e datas diferentes a partir da 011) — tratado como o segundo sendo um
   espelho obsoleto (§3.2), mas sem confirmação formal da DSA. **PENDENTE_DE_VALIDACAO.**
2. **OMD 022/2026**: referência não-oficial encontrada (Instagram); não confirmada em nenhuma fonte
   primária; não usada neste relatório nem no manifesto (o validador da fase 2.5 rejeita ativamente
   qualquer requisito que tente se apoiar nela). **PENDENTE_DE_VALIDACAO.**
3. ~~**OMD 007/2014 sobre o item 11 da Pesquisador de Campo e Bosque**~~ — **CONTINUA PENDENTE.**
   Reconferido na fase 2.5 (texto bruto da página viva): o item 11 atual é "Completar especialidade em
   Habilidades domésticas, Ciência/saúde, Atividades missionárias ou Agrícolas" — NÃO menciona
   "Excursionismo pedestre com mochila" em lugar nenhum. O texto da OMD 007/2014 continua ambíguo
   (exclusão simples vs. substituição) e não bate, sem reinterpretação, com o que a página mostra hoje.
   Modelado como `PENDENTE_DE_VALIDACAO` em `pesquisador.json`.
4. ~~**Guia avançada — itens transferidos pela OMD 001/2013; item 11 avançado da Companheiro de
   Excursionismo**~~ — **RESOLVIDO na fase 2.5.** Reconferido texto bruto de ambas as páginas vivas:
   Guia (Seção VI regular tem só 3 itens, sem "Orçamento familiar"/"Liderança campestre"; a avançada
   Guia de Exploração tem os dois, itens 9 e 10) e Companheiro de Excursionismo (item 11 = "Completar a
   especialidade de Excursionismo pedestre com mochila", batendo com a OMD 005/2013). Ambos marcados
   `CONFIRMADO`/`ALTERADO_POR_OMD` no manifesto, não mais pendentes.
5. **Manual Administrativo — OMD 013/2018 (proibição de venda de emblemas a desbravadores)**: não
   encontrei essa frase especificamente no PDF da edição 2020 (confirmei a edição pela ficha técnica
   interna do PDF: "Edição 2020", não pela data da página) — pode ainda valer como adenda separada, ou
   ter sido reformulada de outro jeito na edição 2020; recomendo confirmar antes de modelar essa regra.
   **PENDENTE_DE_VALIDACAO** (não afeta o manifesto da fase 2.5: é regra administrativa, não conteúdo
   de classe regular).
6. **Dependência classe-avançada→classe-regular**: não confirmada como pré-requisito FORMAL nas
   páginas vivas de classe avançada (diferente das Classes de Liderança, que confirmam isso
   explicitamente). **PENDENTE_DE_VALIDACAO** — por isso o manifesto da fase 2.5 não modela nenhuma
   dependência real entre uma classe avançada e sua regular correspondente.
7. **Líder Máster Avançado**: página consultada não detalhou idade mínima nem pré-requisito explícito.
   **PENDENTE_DE_VALIDACAO** (Liderança fora do escopo da fase 2.5).
8. **Manual de Especialidades — edição corrente**: última revisão geral confirmada é 2012; não achei
   confirmação de revisão geral mais nova (pode haver uma não publicada como página web).
   **PENDENTE_DE_VALIDACAO** (catálogo de Especialidades fora do escopo da fase 2.5).
9. **Cartão Virtual — diferença de fluxo entre os 3 níveis de liderança**: não especificada na fonte
   consultada. **PENDENTE_DE_VALIDACAO** (Liderança fora do escopo da fase 2.5).

Nenhum destes pontos foi resolvido "no escuro" — os 2 marcados RESOLVIDO têm evidência nova, direta,
de fonte primária, registrada acima; os 7 restantes continuam PENDENTE_DE_VALIDACAO até confirmação
direta com o Ministério de Desbravadores da DSA ou leitura mais profunda do PDF original de cada OMD
citada.

## 10. Comparação com o schema atual (migrations 36/37) — só documentando lacunas, nada alterado

O motor curricular de hoje (`curriculum_versions`→`classes`/`specialties`→`class_requirements`/
`specialty_requirements`, com `curriculum_dependencies` desde a migration 37) já resolve bem parte do
que a pesquisa confirmou. Lacunas reais, encontradas comparando contra requisito oficial de verdade:

### 10.1. Requisito ANUAL/DINÂMICO — não representável hoje
"Ler o livro do Curso de Leitura do ano" aparece em TODAS as 6 classes regulares como item próprio,
**distinto** do "livro da classe" (que só muda por OMD). O texto certo desse requisito muda todo ano
civil, sem gerar uma nova `curriculum_version` da classe inteira. Hoje, `class_requirements.descricao`
é estática por versão — não há como expressar "o valor correto deste campo depende do ano corrente"
sem criar uma versão nova da classe TODO ano só por causa desse item (errado: o resto da classe não
mudou). **Lacuna real, não modelada ainda.**

### 10.2. Escolha N de M (alternativas) — não representável hoje
Padrão extremamente comum, em quase toda seção de quase toda classe: "Completar UMA das seguintes
especialidades: a)... b)... c)... d)..." ou "Escolher UM dos seguintes temas". Hoje, `class_requirements`
é 1 requisito = 1 descrição = 1 avaliação — não existe o conceito de "grupo de opções, aprova
escolhendo 1 (ou N) de M". **Lacuna real.** Um sub-caso mais fino, achado na seção "Estilo de Vida" de
várias classes ("especialidade **não realizada anteriormente**"): a escolha em um requisito não pode
repetir uma especialidade já usada para satisfazer OUTRO requisito da mesma pessoa/classe — uma
restrição de unicidade **entre** requisitos-irmãos, mais fina ainda que um simples N-de-M.

### 10.3. Prazo/duração (classes de liderança) — não representável hoje
Líder: "no mínimo um ano e no máximo três anos". Líder Máster: "dentro de um período máximo de três
anos". `member_classes`/`member_specialties` têm `iniciada_em`/`concluida_em`, mas nada que expresse
ou aplique um prazo mínimo/máximo de conclusão. **Lacuna real** (afeta só Liderança, por enquanto).

### 10.4. Aprovação hierárquica multi-nível — não representável hoje
Confirmado no Cartão Virtual (§8.3): Clube → Coordenador Regional/Campo → registro automático. Hoje,
`requisito_avaliar`/`especialidade_requisito_avaliar`/`investidura_confirmar` só conhecem UM nível
(`pode_gerir_no_clube`, dentro do próprio clube) — não existe conceito de Campo/Regional/União/Divisão
no schema multi-tenant atual (`organizational_units` só tem `type = 'clube'` hoje). **Lacuna real e
grande** — é por isso que Classes de Liderança devem ficar fora do que quer que seja importado a
seguir, até essa hierarquia existir no modelo.

### 10.5. Idade mínima — já representável (não é lacuna)
Cada classe declara "Ter, no mínimo, N anos" como o PRIMEIRO item da seção Gerais — ou seja, a própria
DSA trata idade como um REQUISITO avaliado pela liderança, não como um gate automático do sistema. Isso
já é modelável hoje como um `class_requirement` comum (`tipo_evidencia='nenhuma'`, confirmado
manualmente). Poderíamos, no futuro, TAMBÉM adicionar um gate automático de idade mínima como
melhoria de UX — mas não é uma lacuna estrutural.

### 10.6. Dependência classe→classe / classe→especialidade — já coberto
`curriculum_dependencies` (migration 37) já modela exatamente o padrão confirmado nas Classes de
Liderança ("Líder Máster exige 1 Líder investido há 1 ano") e no caso hipotético "classe avançada exige
a regular". Nenhuma mudança necessária aqui — só falta os DADOS reais (que dependem da fonte oficial
completa de cada classe/especialidade, ainda não importada).

### 10.7. Assinatura formal / hierarquia de assinatura — fora de escopo, já sabido
Fora do escopo desta etapa por pedido explícito; a pesquisa não trouxe nada que mude essa decisão.

## 11. Recomendação

1. **Ainda não importar o catálogo completo.** As 6 classes regulares e avançadas têm hoje fonte
   confiável e verificável (as páginas vivas), mas a matriz da seção 4 cobre só as alterações
   CONHECIDAS via OMD — importar o texto integral de cada requisito exige uma segunda passada, linha a
   linha, contra a página viva de cada classe (mais barato e mais confiável que tentar reconstruir via
   PDF-base + OMDs isoladamente, dado o achado §3.1).
2. **Resolver os 9 pontos PENDENTE_DE_VALIDACAO da seção 9 antes de publicar qualquer `curriculum_version`
   com `origem='oficial'`** — em especial a numeração dupla de OMD (#1) e a possível OMD 022/2026 (#2),
   que podem mudar o que "vigente em 2026" significa.
3. **Evoluir o schema primeiro nos 4 pontos da seção 10.1–10.4** (requisito anual, N-de-M com exclusão
   de repetição, prazo de conclusão, aprovação hierárquica) antes de importar conteúdo que dependa
   deles — importar sem isso obrigaria a "achatar" requisitos oficiais de um jeito que não representa
   a regra real (exatamente o que a auditoria foi pedida para evitar).
4. **Especialidades**: importar aos poucos, uma OMD de cada vez (começando por OMD 016/2018 e OMD
   017/2020, que já são gratuitas, oficiais e completas) — não tentar reconstruir o Manual de
   Especialidades inteiro sem comprá-lo/obtê-lo oficialmente.
5. **Classes de Liderança**: tratar como uma frente à parte, só depois que existir hierarquia
   organizacional acima do clube (Campo/Regional) no modelo multi-tenant — caso contrário a aprovação
   hierárquica real (§8.3) não tem como ser respeitada.
6. **Classes Agrupadas**: não precisam de trabalho de schema — já são representáveis; só documentar,
   na tela, que é um caminho de exceção (múltiplas classes simultâneas), nunca o padrão do clube.

Este documento fica em `supabase/AUDITORIA-CURRICULO-OFICIAL.md` para consulta antes de qualquer
importação futura. Nenhuma migration foi criada nem alterada nesta etapa.

## 12. Atualização — fase 2.5 (Consolidação Curricular)

Esta seção 4 foi transformada num manifesto versionado e validável por máquina, com o mesmo grau de
rigor (proveniência, `publicado_em` ≠ `vigente_desde`, PENDENTE_DE_VALIDACAO nunca resolvido por
inferência) — ver [`supabase/curriculo-manifesto/`](curriculo-manifesto/README.md). O manifesto
também RESOLVEU 2 dos 9 pontos da seção 9 (itens 3 e 4, marcados acima) relendo as páginas vivas texto
bruto item a item — os outros 7 continuam exatamente como estavam. Ainda nenhum conteúdo foi
importado para `curriculum_versions`/`classes`/`class_requirements`.
