# Manifesto de Especialidades (fase 7)

**O manifesto é a fonte de verdade do catálogo.** Nada de especialidade é editado à mão no banco: o SQL sai do manifesto,
por um gerador determinístico, e entra por migration. **Nenhum conteúdo real foi importado ou inventado.**

## Estado
| Peça | Situação |
|---|---|
| Motor no banco (migrations 37/83 + **511**) | pronto: modelo por requisito, N de M, dependência, prazo, meta, vários anexos, tentativas imutáveis |
| Validador (`validar.mjs`) | pronto, formato `conquista.especialidades/2`, com proveniência obrigatória |
| Gerador (`gerar-importacao.mjs`) | pronto: SQL determinístico + hash; modo `fixture` (só teste) e modo `migration` (só área real) |
| Testes | `src/lib/especialidadesManifesto.test.js` (vitest) + `supabase/tests/119_*.sql` (fluxo completo com a especialidade **fictícia**) |
| Conteúdo real | **nenhum** — aguarda aprovação de fonte, piloto, estrutura, tipos e fluxo pelo dono |

## Pastas
- `areas/<AREA>.json` — uma área real por arquivo (`HM.json`, `AA.json`…). Hoje só `exemplo.json` (fictício, `estado: catalogo`).
- `teste/especialidade-teste.json` — a especialidade **fictícia** `TE-001` que cobre todos os tipos. Marcada `"teste": true`.
  Vira `supabase/tests/_fixture_especialidade_teste.sql` (`npm run especialidades:fixture`) e **nunca** vira migration
  (o gerador recusa e um teste garante que nenhuma migration a contém).
- `gerado/<AREA>.sql` — SQL de revisão gerado das áreas reais (vazio enquanto não houver conteúdo aprovado).

## Formato (`conquista.especialidades/2`)
```
{ formato, versao, area, area_nome, preparado_em,
  fonte: { nome, url, consultada_em (AAAA-MM-DD), revisao?, status: "conferido"|"pendente" },     ← PROVENIÊNCIA
  especialidades: [ { codigo, nome, nivel?, fonte_url, estado: "catalogo"|"publicavel",
      grupos?: [ { chave, rotulo, minimo } ],                                                    ← escolha N de M entre requisitos
      requisitos?: [ { ordem, descricao, tipo_evidencia, evidencia_obrigatoria?, modelo, grupo?,
                       depende_de?: [ordem…], prazo_dias?, fonte_url, status_fonte } ] } ] }
```
- **tipo_evidencia:** `leitura` · `resposta` · `relatorio` · `foto` · `arquivo` · `atividade` · `validacao`.
- **modelo** (campos do formulário; mesmo motor das Classes — `src/lib/relatorio/modelo.js`): texto, número, data, seleção,
  checklist, lista, entradas repetíveis (diário), **escolha** (o membro escolhe uma forma; cada forma tem seus campos),
  confirmação e anexos (vários).
- **meta/quantidade** = campo `numero` com `min` (o servidor recusa o envio abaixo da meta).
- **dependência** = `depende_de` (ordens menores; o requisito só libera quando os anteriores estão aprovados).
- **prazo** = `prazo_dias` contado da matrícula; vale para a 1ª entrega (corrigir e reenviar o que foi devolvido não é penalizado).
- **N de M** = `grupo` + `grupos[].minimo` (o progresso conta o grupo pelo mínimo).

## Regras do validador (recusa)
Requisito sem fonte https de domínio reconhecido ou sem `status_fonte: conferido` · `publicavel` sem requisitos ·
`catalogo` com requisitos · **fonte "conferido" que não seja de domínio OFICIAL** (a wiki comunitária só serve para conferência) ·
proveniência ausente (nome, url, data da consulta, status) · tipo sem modelo · modelo inválido · grupo inexistente/vazio/mínimo maior que o total ·
dependência para ordem maior ou para requisito de grupo · código repetido/fora do padrão/de outra área · marca `[TESTE]` em arquivo real.

## Versionamento e imutabilidade
`versao` do manifesto → linha em `curriculum_versions` (`especialidades-<área>` / versão). O SQL gerado grava o **sha256** do
pacote e **recusa reimportar a mesma versão com conteúdo diferente**. Mudou algo → suba `versao`. Quem já começou continua na
versão em que começou; tentativas antigas nunca mudam.

## Fontes (decisão do dono — nada importado)
Prioridade aprovada: **1) fonte oficial verificável · 2) material oficial que o dono fornecer · 3) fonte comunitária só para conferência.**
Não copiar automaticamente texto integral de fonte protegida: o requisito entra em **paráfrase própria**, com `fonte_url`,
data da consulta e revisão/versão quando conhecida.
| Fonte | Papel | Limitações |
|---|---|---|
| adventistas.org (Desbravadores › Especialidades) | oficial | © Igreja Adventista do Sétimo Dia; sem autorização expressa de reprodução visível; a página tem itens repetidos por erro de exibição |
| Manual de Especialidades (Divisão Sul-Americana, rev. 2012, Editora SobreTudo) | oficial, impresso | sem PDF oficial encontrado; revisão antiga; direitos da editora |
| Material que o dono fornecer | oficial | depende do dono |
| mda.wiki.br | **só conferência** | comunitária; sem data/versão por página |
**Se o texto oficial não puder ser reproduzido com segurança, a importação real PARA e o dono é avisado.**

## Como usar (quando houver aprovação)
```
npm run especialidades:validar
npm run especialidades:importacao:gerar       # gerado/<AREA>.sql (revisão)
npm run especialidades:importacao:check       # CI
node supabase/especialidades-manifesto/gerar-importacao.mjs --migration NNN <AREA>   # cria a migration numerada
```
