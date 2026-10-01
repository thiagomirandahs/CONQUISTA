# Especialidade piloto — fontes, direitos e proveniência (Fase 9)

**Só investigação. Nada foi importado, nenhuma migration/manifesto/código foi alterado, produção não foi tocada.**
Consulta feita em **2026-10-01**, só nas páginas públicas. Nenhum texto de requisito foi copiado (só estrutura e, no máximo, uma citação curta por fonte).
Limite da investigação: as páginas foram lidas por ferramenta de extração automática (resumo), não por um humano no navegador. Contagens e tipos abaixo precisam de **conferência humana** antes de qualquer importação.

## 1. Tabela de fontes

| # | Fonte | URL | Entidade responsável | Consultada | Versão / revisão / ano | Tipo | Direitos (o que o site declara) | Confiança |
|---|---|---|---|---|---|---|---|---|
| F1 | adventistas.org — lista de Especialidades | https://www.adventistas.org/pt/desbravadores/especialidades/ | Igreja Adventista do Sétimo Dia (Divisão Sul-Americana) | 2026-10-01 | página de 7/11/2017; sem revisão visível | oficial online | Rodapé: "Copyright © 2013-2026". Sem autorização de reprodução e sem termos de uso: **não declarado** | Alta como oficial; **baixa como fonte de requisitos** (os cartões de Artes e Habilidades Manuais não mostraram links funcionando na extração) |
| F2 | adventistas.org — página individual (modelo de template) | ex.: https://www.adventistas.org/pt/desbravadores/especialidades/alfabetizacao-ad006/ (padrão `…/especialidades/<nome>-<codigo>/`) | idem | 2026-10-01 | publicada em 7/11/2017, sem histórico de revisão | oficial online | © Igreja; **não declarado** | Alta. **Mas a página de HM-049 NÃO foi localizada**: `arte-com-barbante-hm049`, `arte-com-barbantes-hm049` e `arte-com-barbante-hm-049` deram 404 |
| F3 | adventistas.org — Manual de Especialidades (post) | https://www.adventistas.org/pt/desbravadores/manual-de-especialidades/ (espelhos: ucb.adventistas.org/…/2013/05/16/manual-de-especialidades/, ap.adventistas.org/desbravadores/manual-de-especialidades/) | Divisão Sul-Americana; revisão pelo GEED, concluída em abril/2012; distribuição Editora SobreTudo | 2026-10-01 | post de 16/05/2013; revisão 2012 | oficial (anúncio do impresso) | © Igreja; texto fala em ver "o manual em capítulos", mas **nenhum link de capítulo/PDF veio na extração**. Uso/reprodução: **não declarado** | Alta como proveniência; não entrega o texto |
| F4 | Manual de Especialidades impresso (DSA, rev. 2012, Editora SobreTudo) | http://www.editorasobretudo.com.br/ (venda) | Divisão Sul-Americana / Editora SobreTudo | 2026-10-01 | revisão 2012 | oficial impresso | direitos da editora/Igreja; **não declarado** em página pública | Alta, mas só o dono pode obter (compra/autorização) |
| F5 | adventistas.org — História das especialidades | https://www.adventistas.org/pt/desbravadores/classes/historia-das-especialidades/ | DSA | 2026-10-01 | post de 23/04/2013 | oficial online | © Igreja; não declarado | Alta para ano de criação: lista "Arte com Barbantes" em 1975 (sem código) |
| F6 | mda.wiki.br — página da especialidade | https://mda.wiki.br/Especialidade_de_Arte_com_Barbante | não declarado (wiki comunitária; mantenedor não aparece) | 2026-10-01 | Código HM 049, nível 1, ano 1975, origem "Associação Geral"; sem data de edição nem histórico visível | wiki comunitária | Rodapé só diz "Conteúdo retirado do site mda.wiki.br"; páginas "Termos" e "Licença" existem mas **não mostraram texto de termos na consulta**; licença **não declarada**. Não cita adventistas.org nem o Manual como origem | Média (estrutura limpa e numerada), sem prova de fidelidade ao oficial. **Aviso na home: o site "será encerrado em breve"** |
| F7 | PDF do Manual em arquivosadventistas.org | https://arquivosadventistas.org/arquivos/DESBRAVADORES/manuais/Manual%20de%20especialidades%20de%20desbravadores.pdf | terceiro (não oficial) | 2026-10-01 (não aberto) | origem/versão não verificáveis | cópia de terceiros | não declarado | Baixa. **Não usar** (e não foi baixado) |
| F8 | desbravadores.fandom.com | https://desbravadores.fandom.com/wiki/Arte_de_tran%C3%A7ar | comunidade (Fandom) | 2026-10-01 | — | wiki comunitária | resposta HTTP 402 na extração; não lido | Não avaliada |

Observação: o catálogo do app (migration 460) já usa F6 como origem de **nomes/código/nível/ano** (`supabase/especialidades-catalogo/catalogo-mda.json`, HM-049 → fonte_url F6). Isso é só catálogo; não há requisito.

## 2. Comparação entre fontes (HM-049 Arte com Barbante)

| Ponto | F5 (oficial, histórico) | F6 (wiki) | Observação |
|---|---|---|---|
| Ano de criação | 1975 | 1975 | **Coincidem** |
| Código / nível | sem código | HM 049 / nível 1 | Código só confirmado pela wiki e pelo catálogo da 460 |
| Requisitos | não mostra | **6 numerados** | Não existe versão oficial acessível para comparar |
| Nº de requisitos vs. doc anterior | — | 6 | **`ESPECIALIDADE-PILOTO-PROPOSTA.md` §4 dizia 8 requisitos, com "reflexão final". A releitura (duas extrações independentes) deu 6, sem reflexão final.** Corrigir a proposta; a contagem de 8 estava errada ou vinha de outra edição |

Estrutura observada em F6 (só tipos, sem texto): (1) descrever conceitos [resposta]; (2) desenhar/tecer 3 ângulos em papelão [prática, 3 subitens]; (3) citar 3 formas de preparar a madeira [resposta]; (4) confeccionar trabalhos em madeira, **escolher 4 de 8** técnicas; (5) expor um trabalho original [validação presencial/foto]; (6) listar ao menos 5 materiais alternativos [lista com mínimo]. Nenhuma menção a martelo, prego, serra ou faca nos requisitos (porém "trabalho em madeira" na prática costuma envolver ferramentas: ver §3).
**Divergência entre fontes: não foi possível verificar** (não há texto oficial acessível). Esta é a principal lacuna: sem oficial, "conferido" é impossível pelas regras do validador.

## 3. Candidatas a piloto

Estruturas lidas em F6 (extração automática; conferir):

| Candidata | Req. | Tipos | N de M | Risco / adulto | Observação |
|---|---|---|---|---|---|
| **HM-049 Arte com Barbante** | 6 | resposta, prática com 3 subitens, resposta, escolha, exposição, lista com mínimo | 4 de 8 | sem risco declarado; "madeira" pode envolver ferramenta (não escrito); sem adulto específico | recomendada |
| HM-060 Origami | 10 | respostas, demonstrações, dobrar 12 modelos de diagrama, 2 de memória | "modelos semelhantes" (alternativa, não N de M claro) | mínimo (papel) | muitos requisitos repetitivos de foto; menos variedade de tipos |
| HM-080 Fuxico | 7 | respostas, demonstrar 3 bases, escolher 2 de 7 objetos | 2 de 7 | agulha (risco menor) | boa alternativa; mesmos recursos do HM-049, nada novo |
| HM-022 Trabalhos em Feltro | 9 | respostas, práticas, projetos | 2 de 5 e 2 de 4 (dois grupos) | costura/ferramentas, calor | cobriria **dois grupos N de M**; mais pesada |
| AA-002 Jardinagem e Horticultura | 6 | prática, respostas, 1 de 3 alternativas, "pelo menos seis plantas" | 1 de 3 | **inseticidas/fungicidas e regras de segurança no requisito 2** | cobriria meta numérica; risco químico, não é baixo |

**Recomendação: HM-049 Arte com Barbante.** Exercita ponta a ponta:
- resposta (req. 1, 3) · lista com mínimo (req. 6) · foto/atividade com vários anexos (req. 2 e 4) · **N de M** via `grupo` (4 de 8, req. 4) · validação presencial pelo instrutor (req. 5, exposição) · devolução, correção, reenvio, histórico de tentativas, privacidade de foto de menor.

Sem cobertura no piloto real (já provados só pela fictícia TE-001 / teste 119): leitura, relatório estruturado/diário, arquivo, meta numérica, prazo, dependência entre requisitos. (Observação: `depende_de` não pode apontar para requisito de grupo N de M; HM-049 não tem dependência natural e **não se deve inventar uma**; o prazo também não vem da fonte.)
**Segundo piloto:** vale só se o dono quiser provar na prática **meta** e **relatório**; candidata seria AA-002 Jardinagem ("seis plantas"), que exige antes a decisão de segurança (inseticidas, pergunta 6 da proposta). Para o piloto inicial: um só (HM-049).
Ponto de segurança para o dono: confirmar que a prática de HM-049 não pressupõe ferramenta perigosa para 10–15 anos; se pressupor, é aviso/autorização dos pais (decisão dele, não minha).

## 4. Direitos: o texto pode ir para o app?

Resposta: **não está claro. Não há permissão visível.**
- adventistas.org e o Manual: "Copyright © Igreja Adventista do Sétimo Dia" sem autorização de reprodução nem termos de uso (F1–F3). O Manual impresso tem ainda a Editora SobreTudo (F4).
- mda.wiki.br: licença **não declarada**, entidade **não declarada**, não cita a origem oficial, e anuncia encerramento. Em tese a wiki replica texto que é da Igreja; ela não pode conceder uma licença que talvez não seja dela.
- Regra já vigente no repositório: o requisito entra em paráfrase própria, com `fonte_url` oficial e `status_fonte: conferido`. Isso **reduz** mas **não elimina** o risco (paráfrase de lista curta de requisitos é próxima do original), e exige que exista texto oficial para conferir.

### Decisões que o dono precisa tomar (não decidi por ele)
1. **Direitos:** (a) pedir autorização por escrito à Divisão Sul-Americana/IASD (Departamento de Desbravadores) para usar os requisitos no app; ou (b) paráfrase própria revisada por pessoa do clube/diretoria, assumindo o risco; ou (c) o app mostra só o título e **o link para a fonte oficial** (sem texto) e registra a comprovação; ou (d) adiar Especialidades até ter (a).
2. **Fonte oficial utilizável:** o dono (ou a diretoria) pode fornecer o Manual impresso/PDF oficial, ou a URL oficial da página de HM-049 em adventistas.org (não achei)? Sem isso o validador impede `conferido` (a wiki só vale como conferência).
3. **Piloto:** aprova HM-049 (ou prefere outra)? Aceita que um único piloto não prova meta/relatório?
4. **Segurança:** HM-049 pede aviso/autorização dos pais por uso de ferramentas?
5. **Revisor:** quem é a pessoa que confere a paráfrase contra a fonte (nome entra na proveniência)?
6. **Wiki fechando:** autoriza guardar (fora do app, em pasta privada do projeto) um registro da consulta (data, hash, captura) como prova de proveniência, sem publicar?

## 5. Esquema de proveniência recomendado × o que já existe

Já existe (lido nos arquivos):
- Manifesto `fonte`: `{nome, url, consultada_em, revisao?, status: conferido|pendente}`; validador recusa chave extra, exige https, data AAAA-MM-DD, `conferido` só em domínio oficial (`adventistas.org`, `cpb.com.br`), wiki só como conferência.
- Por especialidade/requisito: `fonte_url`, `status_fonte`.
- Banco (511): `specialties.fonte_url / fonte_consultada_em / fonte_revisao / status_fonte / manifesto_hash`; `specialty_requirements.fonte_url / status_fonte / manifesto_id`; `curriculum_versions.fonte_url / fonte_descricao / fonte_hash (sha256 do pacote) / fonte_arquivo / importado_em / fonte_detalhes (jsonb com a fonte inteira)`. O SQL gerado recusa reimportar a mesma versão com conteúdo diferente.

| Campo pedido | Manifesto hoje | Banco hoje | Falta |
|---|---|---|---|
| fonte (nome) | `fonte.nome` | `fonte_detalhes.fonte.nome` | nada |
| URL | `fonte.url`, `fonte_url` por item | sim | nada |
| data da consulta | `consultada_em` | `fonte_consultada_em` | nada |
| revisão | `revisao?` | `fonte_revisao` | tornar obrigatório quando houver (para HM-049: "não identificada") |
| **entidade responsável** | só dentro de `nome` (texto livre) | só em jsonb se o validador deixar | **campo `entidade`** |
| **tipo da fonte** (oficial impresso/online/wiki) | deduzido do domínio | não | campo `tipo_fonte` |
| **situação de direitos** | não existe | não existe | **campo `direitos`** `{situacao: nao_declarado\|autorizado\|parafrase_com_link\|..., evidencia, autorizado_por, autorizado_em}`, e **bloquear `publicavel` real se `situacao` não for aceita pelo dono** |
| **hash do conteúdo importado** | gerador calcula sha256 do pacote | `fonte_hash`, `manifesto_hash` | já cobre o *importado*. **Falta o hash do conteúdo da FONTE consultado** (`fonte.hash_consulta`, de captura guardada fora do app) para provar de onde saiu |
| **revisor** | não existe | não existe | **`revisao_humana` `{revisor, revisado_em}`** obrigatório para `publicavel` real |
| método (paráfrase) | implícito | não | `metodo: parafrase` |

Onde implementar (só quando aprovado): `CHAVES_FONTE` e `validarEspecialidades` em `supabase/especialidades-manifesto/validar.mjs` (chaves novas + regras); `montarPacote` em `gerar-importacao.mjs` já leva `dados.fonte` inteira ao hash e ao `fonte_detalhes`, então campos novos **entram no jsonb sem alterar colunas** (por isso não precisa de migration de esquema para começar). Acrescentar teste em `src/lib/especialidadesManifesto.test.js`.
Observação: as regras atuais deixariam `conferido` quando há URL oficial **genérica** (a listagem) — o validador não distingue página específica. Sugestão: exigir `fonte_url` por requisito diferente da raiz `/especialidades/`.

## 6. Passo a passo para importar o piloto (só após aprovação do dono)

Pré-condições: decisões 1, 2, 3, 5 acima resolvidas; texto oficial em mãos; Node 22.
1. Branch própria; Docker/Supabase local.
2. Ajustar validador para os campos do §5 (se aprovados) + teste; `npm run especialidades:autoteste`.
3. `node supabase/especialidades-manifesto/nova-especialidade.mjs HM-049 "Arte com Barbante" --nivel 1 --fonte-url <URL OFICIAL> ` → cria `supabase/especialidades-manifesto/areas/HM.json` com `estado: catalogo`.
4. Editar `HM.json`: `fonte` (nome, url, `consultada_em` real, revisão, `status: conferido`, campos novos); `grupos: [{chave:"tecnicas", rotulo, minimo:4}]`; copiar os 6 modelos de `modelos-de-requisito.json` (resposta, resposta_lista, foto/atividade com anexos, escolha N de M, validacao) e preencher com a **paráfrase revisada**; `estado: publicavel`.
5. `npm run especialidades:validar`.
6. **O teste `ENQUANTO o dono não aprovar…` (src/lib/especialidadesManifesto.test.js, ~linha 153) vai falhar de propósito**: só trocá-lo (para permitir exatamente HM-049) com aprovação escrita do dono, no mesmo commit.
7. `npm run especialidades:importacao:gerar` e `npm run especialidades:importacao:check`.
8. `node supabase/especialidades-manifesto/gerar-importacao.mjs --migration 528 HM` (usar o próximo número livre; hoje a última é 527) → cria `supabase/migrations/20260930000528_especialidades-hm.sql`.
9. Testes: `npm run especialidades:autoteste`; `npm run especialidades:fixture:check`; `npm run test:db` (replay completo, incl. 33/34/62/105/119/120); acrescentar teste SQL do piloto real (fluxo foto + N de M + devolução) e o teste equivalente ao 125 sobre a regra de dependência entre clubes (`PENDENCIAS-DE-CONTEUDO-OFICIAL.md` item 4); `npm run check`.
10. Produção só com autorização do dono, em janela, com Tenant 001 conferido antes/depois (regras do CLAUDE.md); migration aplicada à parte, em transação com `lock_timeout`, e ledger.
11. Ligar o recurso **só num clube de teste**: o recurso `especialidades` é `somente_plataforma` (migration 83): só o admin da plataforma liga, no /admin, clube a clube (a liderança não liga). Ligar no clube de teste (Tenant 002), nunca no Tenant 001, e validar com 1 desbravador de teste + 1 instrutor: iniciar → foto → enviar → devolver → corrigir → aprovar → conclusão.
12. Registrar a proveniência (data, hash da consulta, revisor, autorização) em arquivo privado do projeto, sem segredos.

## 7. Estado

**PARADO — depende do dono.** Não existe fonte oficial acessível com o texto de HM-049 nem permissão de uso declarada; por isso não foi criado o rascunho de estrutura com texto, só o de estrutura em `ESPECIALIDADE-PILOTO-ESTRUTURA-RASCUNHO.md` (sem texto).
