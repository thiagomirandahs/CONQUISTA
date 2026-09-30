# Fase 7 — Especialidades: proposta de piloto, fontes, manifesto, evidências e avaliação

**Só proposta. Nada foi importado, nenhuma migration criada, nada alterado em produção.**
Nenhum texto de requisito foi copiado: as páginas oficiais/wiki foram consultadas só para ver a **estrutura** (quantidade e tipos de exigência).

## 1. Como está o catálogo hoje
- 552 nomes em **9 códigos de área** (não 8): AR 119 · EN 105 · HM 90 · AP 68 · AM 58 · CS 43 · AA 16 · HD 13 · AD 9 (contagem pela migration 460, fonte mda.wiki.br). 152 são de nível 1.
- Catálogo = só nome/área/nível/ano/origem. **Zero requisitos** (só 1 especialidade de teste no motor).

## 2. O que o motor (migrations 37/83) já cobre do fluxo desejado

| Etapa do fluxo | Situação | Como |
|---|---|---|
| Catálogo → abrir especialidade → ver requisitos | ✅ | `catalogo_especialidades`, `minha_especialidade` |
| Iniciar | ✅ | `especialidade_iniciar` / `_atribuir` / ofertas por turma |
| Salvar rascunho | ✅ parcial | `especialidade_requisito_salvar` (1 texto + 1 arquivo) |
| Enviar evidência | ✅ | `especialidade_requisito_enviar` (respeita `evidencia_obrigatoria`) |
| Avaliar / devolver / aprovar | ✅ | `especialidade_requisito_avaliar` (`aprovado` \| `correcao_solicitada`) — só diretoria/instrutor (ou responsável da turma) |
| Corrigir e reenviar | ✅ | salvar volta a `em_andamento`; enviar de novo |
| Progresso / concluir | ✅ | `especialidade_percentual` + gatilho `avaliar_conclusao_especialidade` |
| Histórico | ✅ parcial | `requirement_approvals` guarda decisão + comentário + quem/papel; **não guarda o conteúdo de cada tentativa** |

### Lacunas do motor (o que o piloto precisa provar/criar)
1. **Uma evidência só** por requisito (1 texto + 1 arquivo). Faltam campos estruturados (relatório) e vários anexos.
2. **Sem "escolha N de M"** nas especialidades (as Classes têm grupos de opções; as especialidades não).
3. **Sem meta/quantidade** (ex.: "cuidar por 1 mês", "fazer 4 de 8").
4. **Sem prazo** por requisito (só o período da oferta/turma).
5. **Dependência** só parcial (tipo `especialidade` = "ter concluído outra").
6. **Histórico de tentativas** sem o conteúdo enviado antes (só as decisões).
7. Nenhum requisito real e nenhum pipeline de importação (manifesto/validador criado neste ciclo, sem migration ainda).

## 3. Fontes possíveis para os requisitos

| Fonte | Origem | O que oferece | Limitações |
|---|---|---|---|
| **mda.wiki.br** (Manual de Desbravadores Adventistas) | wiki comunitária; já é a fonte do catálogo | 1 página por especialidade: requisitos numerados com subitens/alternativas, código, nível, ano, origem; link de apoio; rodapé "Conteúdo retirado do site mda.wiki.br" | Não é oficial da Igreja; sem data/versão por página; sem licença explícita visível; precisa de conferência humana com a fonte oficial |
| **adventistas.org/pt/desbravadores/especialidades** | site oficial (© Igreja Adventista do Sétimo Dia 2013–2026) | lista por categoria, página por especialidade com requisitos | © da Igreja: sem autorização expressa de reprodução visível → usar **paráfrase própria + link da fonte**, como nas Classes; a lista da página tem itens repetidos por erro de exibição (não confiar na contagem) |
| **Manual de Especialidades** (Divisão Sul-Americana; revisão 2012, Editora SobreTudo) | oficial, impresso | texto de referência; só a Divisão pode revisar/trocar requisitos | À venda em papel (não achei PDF oficial na página); revisão de 2012 pode estar desatualizada; direitos autorais da editora |
| Cópias em PDF em sites de arquivo (ex.: arquivosadventistas.org) | terceiros | PDF completo | Origem/versão não verificável; **não recomendo como fonte** |
| Cartões/materiais da DSA-SGC | oficial | resumos | Não cobre as 552 |

**Recomendação de fonte:** texto de trabalho = **adventistas.org (oficial)** conferido contra **mda.wiki.br**; o requisito entra **parafraseado**, com `fonte_url` oficial e `status_fonte: conferido` (regra do validador). Em caso de divergência entre as duas, vale a oficial e o caso vai para você decidir. Dependo de você: confirmar se a Igreja/DSA autoriza esse uso e se prefere pedir o Manual em papel/PDF oficial.

## 4. Especialidade piloto — critérios e proposta

**Critérios:** nível 1 · poucos requisitos (≤ 8) · mistura de tipos (resposta, prática com foto, escolha N de M, validação pelo instrutor) · sem dependência de outra especialidade · sem material perigoso/animais vivos · dá para cumprir em um clube comum.

| Candidata | Estrutura observada (só contagem/tipos) | Cobre | Não cobre |
|---|---|---|---|
| **Arte com Barbante (HM-049, nível 1)** ⭐ recomendada | 8 requisitos: respostas escritas, práticas de confecção, **1 requisito "4 de 8"**, exposição do trabalho, reflexão final; subitens | resposta · foto do trabalho · N de M · validação do instrutor (exposição) · reflexão | prazo, meta contínua, dependência |
| Jardinagem e Horticultura (AA-002, nível 1) | 6 requisitos; o 6º com 3 alternativas | resposta · prática · escolha 1 de 3 | prazo, dependência |
| Aves de Estimação (EN-020, nível 1) | 5 requisitos; um com **prazo de 1 mês**, alternativas | prazo · meta · registro escrito · escolha | envolve animais vivos (barreira para muitos clubes) |

**Proposta em duas camadas (mais seguro):**
1. **Motor:** validar o fluxo inteiro com uma especialidade **fictícia de teste** (`[TESTE]`, só em banco local/CI, nunca em produção), com um requisito de cada tipo (leitura, resposta, relatório, foto, arquivo, atividade, validação, meta, dependente, N de M, prazo). Assim os tipos que o piloto real não tem (prazo, meta, dependência) também são provados.
2. **Conteúdo real:** **Arte com Barbante** como piloto (ou Jardinagem, se você preferir área agrícola). Você aprova; só então eu leio os requisitos oficiais, parafraseio e monto o manifesto.

## 5. Tipos de requisito (proposta)

| Tipo | Evidência do membro | Quem valida | Exemplo de uso |
|---|---|---|---|
| `leitura` | marca "li" | automático ou instrutor | ler um texto indicado |
| `resposta` | texto (ou lista com mínimo) | instrutor | listar, descrever, explicar |
| `relatorio` | campos definidos pelo requisito | instrutor | relato de visita/atividade |
| `foto` | 1..N fotos (regra de imagem existente) | instrutor | foto do trabalho pronto |
| `arquivo` | 1 arquivo (PDF/imagem) | instrutor | trabalho escrito |
| `atividade` | "fiz" + observação (+ foto opcional) | instrutor/líder | prática, confecção |
| `validacao` | nenhuma (presencial) | instrutor | demonstrar/apresentar ao instrutor |
| `meta` | quantidade ou período (ex.: 4 de 8, 30 dias) | instrutor | "por pelo menos um mês" |
| `escolha` | escolhe N de M e comprova cada uma | instrutor | "faça 4 dos seguintes" |
| dependente | herdado (exige outra especialidade/requisito concluído) | sistema | pré-requisito |
| prazo | data limite opcional por requisito | sistema | turma/oferta com período |

## 6. Estrutura do manifesto (extensão proposta do que já existe)
Hoje (`supabase/especialidades-manifesto`): por requisito `ordem, descricao, tipo_evidencia, fonte_url, status_fonte`. Acréscimos propostos:
- `tipo_evidencia` passa a aceitar os tipos da seção 5;
- `campos` (só `relatorio`): lista de `{chave, rotulo, tipo: texto|data|numero|lista, obrigatorio}` — definida por requisito, sem modelo único;
- `grupo_escolha` `{id, minimo, total}` + `subitens` (para N de M);
- `meta` `{quantidade|dias}`; `prazo_dias` opcional; `depende_de` (código de especialidade ou ordem);
- `avaliador`: `instrutor` \| `diretoria` (padrão instrutor);
- sempre `fonte_url` oficial + `status_fonte: conferido`; texto em paráfrase própria.
O validador continua recusando requisito sem fonte/conferência.

## 7. Fluxo de avaliação (proposta)
`nao_iniciado → em_andamento (rascunho) → aguardando_avaliacao → aprovado | correcao_solicitada → (corrige) → aguardando_avaliacao …` — igual ao motor atual. Acréscimos propostos:
- guardar **cada tentativa enviada** (conteúdo + data) para o histórico e para o avaliador comparar antes/depois;
- comentário do avaliador **obrigatório** ao devolver;
- avaliador: instrutor ou diretoria do clube (conselheiro só acompanha a própria unidade — regra atual);
- conclusão automática quando todos os requisitos (e os N de M) estão aprovados; percentual mostra "X de Y" contando o grupo N de M como 1 item;
- membro edita rascunho livremente; depois de enviar, só volta a editar se devolvido.

## 8. O que preciso que você decida
1. **Fonte:** oficial (adventistas.org) conferida contra mda.wiki.br, em paráfrase — ok? Quer tentar obter o Manual oficial/PDF?
2. **Piloto real:** Arte com Barbante, Jardinagem ou outra?
3. **Fixture fictícia de teste** para provar os tipos que o piloto não tem (prazo, meta, dependência) — ok?
4. **Tipos de evidência** da seção 5 e **estrutura do manifesto** da seção 6.
5. **Fluxo de avaliação** da seção 7 (histórico de tentativas, comentário obrigatório ao devolver).
6. Especialidades que envolvem **animais, água, fogo, ferramentas**: tratar com aviso de segurança/autorização dos pais? (fora do piloto, mas muda o modelo)
