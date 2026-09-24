# Conteúdo anual das Classes (Curso de Leitura do ano)

Cada Classe Regular tem um requisito cujo conteúdo muda **todo ano civil**: "ler o livro do Curso de
Leitura do ano". O catálogo das classes (`../classes/*.json`, importado pelas migrations 40/43) diz
**que** esse requisito existe. Esta pasta diz **qual** é o conteúdo de um ano, com a fonte.

O banco guarda esse conteúdo em `dynamic_content_values`. Desde a migration 84:

- todo valor tem **ano explícito**, e a vigência é **fechada e dentro desse ano**. Nenhum valor vale
  em outro ano: sem o conteúdo do ano, o requisito fica **bloqueado**, com o motivo na tela;
- o "hoje" é o dia **no Brasil** (America/Sao_Paulo), não o do servidor (UTC);
- o conteúdo que a criança usou fica **fixado no requisito** no envio (ou na aprovação direta). A
  virada do ano não reabre nem troca o que já foi enviado ou aprovado;
- o único caminho de publicação é `public.conteudo_anual_publicar(pacote, hash)`, e o pacote sai
  **daqui**, validado. Não se escreve INSERT à mão.

O passo a passo de publicação está em [`../PUBLICACAO-CONTEUDO-ANUAL.md`](../PUBLICACAO-CONTEUDO-ANUAL.md).

## Arquivos

```
conteudo-anual/
  README.md          este arquivo
  esquema.json       o formato (JSON Schema). O validador cobra também o que o esquema não expressa.
  exemplo.json       EXEMPLO do formato, ano 2099. NÃO é conteúdo oficial e nunca é publicado.
  <ano>.json         o manifesto de um ano real (ex.: 2027.json). Ainda não existe nenhum.
  publicar-<ano>.sql GERADO a partir de <ano>.json. Não se edita à mão.
```

## O formato de `<ano>.json`

```jsonc
{
  "formato": "conquista.conteudo_anual/1",
  "ano": 2027,
  "preparado_em": "2026-11-20",             // opcional: quando foi preparado
  "observacao": "…",                          // opcional: nota para quem revisa (não vai ao banco)
  "itens": [
    {
      "chave": "curso_leitura_amigo",         // o slot da classe: curso_leitura_<id da classe>
      "valor": "Título do livro de 2027",     // o conteúdo (o título, nunca o texto da obra)
      "vigente_desde": "2027-01-01",
      "vigente_ate": "2027-12-31",            // OBRIGATÓRIO: vigência aberta é recusada
      "fonte_url": "https://…",               // de onde veio (https obrigatório)
      "fonte_descricao": "Qual página ou documento, publicado por quem, conferido em que data."
    }
    // … um item por slot. Um slot pode ter mais de um período no ano, desde que eles cubram o ano
    // inteiro sem se sobrepor.
  ]
}
```

Os slots são os `curso_leitura_<classe>` de toda Classe Regular com requisito `anual_dinamico` no
manifesto das classes. Hoje são seis: amigo, companheiro, pesquisador, pioneiro, excursionista e guia.

## O que o validador recusa

`npm run curriculo:conteudo-anual:validar` recusa, entre outras coisas:

- vigência aberta, vigência fora do ano ou `vigente_ate` antes de `vigente_desde`;
- **lacuna**: slot faltando, dia do ano sem conteúdo, ou períodos que se sobrepõem;
- item sem valor, sem `fonte_url` https ou sem `fonte_descricao`;
- chave que não é slot das Classes Regulares, e campo que o formato não conhece;
- arquivo cujo nome não bate com o `ano`;
- exemplo misturado com conteúdo real. `"exemplo": true` só vale em `exemplo.json`, e todo valor dele
  começa com `[EXEMPLO]`. Um arquivo de ano real não pode ter `[EXEMPLO]` ou `[TESTE]` no valor.

Fonte fora de `adventistas.org` ou `cpb.com.br` gera **aviso**, não erro: confira se é fonte oficial.
O autoteste (`npm run curriculo:conteudo-anual:autoteste`) prova cada recusa com dados sintéticos.

## Por que não há conteúdo real aqui

O Curso de Leitura de cada ano é publicado pela DSA/CPB. A auditoria curricular não encontrou fonte
primária oficial nem para 2026 (ver `supabase/AUDITORIA-MULTITENANT.md` e `supabase/AUDITORIA-CURRICULO-OFICIAL.md`). Nada aqui foi inventado: o único
arquivo é o exemplo, marcado como exemplo. Quem publica o primeiro ano real segue o procedimento, com
a fonte oficial em mãos.
