# Publicação do conteúdo anual: procedimento operacional do piloto

Este documento cobre o **Curso de Leitura do ano** de cada Classe Regular. Ele diz quem publica,
quando, como conferir e o que acontece se faltar. Vale para o piloto multi-clube (fase 9). A regra
técnica está na migration `20260930000084_conteudo-anual-com-vigencia-explicita.sql`. O formato do
manifesto está em [`conteudo-anual/README.md`](conteudo-anual/README.md).

> **Não há interface administrativa para isso no piloto.** A publicação é feita pela plataforma, com
> manifesto versionado no repositório e o SQL gerado a partir dele. Uma tela de administração para
> publicar e conferir o conteúdo anual fica para **depois do piloto**.

## Quem publica

A **plataforma**, nunca a liderança de um clube. O conteúdo é o mesmo para todos os clubes.

- **Prepara o manifesto:** quem cuida do currículo na plataforma. Obtém a fonte oficial e escreve
  `conteudo-anual/<ano>.json`.
- **Revisa:** uma segunda pessoa, antes do merge. Confere o valor e a fonte item por item.
- **Aplica:** quem tem acesso ao SQL Editor do projeto de produção (papel `postgres`). A função
  `conteudo_anual_publicar` não pode ser executada por `authenticated` nem por `anon`.

## Quando

- **Prazo: antes de 1º de janeiro** do ano do conteúdo. O "hoje" do servidor é o dia no Brasil.
  A partir de 0h de 01/01, horário de Brasília, o ano novo sem conteúdo publicado já bloqueia.
- **Meta: até 15 de dezembro.** Isso deixa margem para revisão e para corrigir um erro antes que
  alguém dependa do valor.
- O conteúdo de um ano **pode** ser publicado com antecedência. Ele só passa a valer em 1º de janeiro
  (ou na data de `vigente_desde`).

## Passo a passo

1. **Obter a fonte oficial** do Curso de Leitura do ano para as seis classes. Anote a URL (https) e
   uma descrição: qual página ou documento, publicado por quem, conferido em que data.
2. **Escrever o manifesto** `supabase/curriculo-manifesto/conteudo-anual/<ano>.json`, no formato de
   `conteudo-anual/README.md`: um item por classe, cobrindo de 01/01 a 31/12. Use `exemplo.json`
   como modelo de formato, nunca de conteúdo.
3. **Validar:** `npm run curriculo:conteudo-anual:validar`. Tem de terminar em `OK`. Se houver
   **aviso** de domínio, confirme a fonte antes de seguir.
4. **Gerar o SQL:** `npm run curriculo:conteudo-anual:gerar -- <ano>`. O comando escreve
   `conteudo-anual/publicar-<ano>.sql` e imprime o **sha256** do pacote. Anote o hash.
5. **Revisar e versionar:** abra o PR com o `<ano>.json` e o `publicar-<ano>.sql` juntos. O revisor
   roda `npm run curriculo:conteudo-anual:check`, que falha se o SQL não bater com o manifesto, e
   confere valor e fonte de cada classe.
6. **Aplicar em produção:** abra o SQL Editor, cole o conteúdo de `publicar-<ano>.sql` e rode. É uma
   chamada só, numa transação só. A resposta esperada é:
   `{"ok": true, "ano": <ano>, "publicados": 6, "ja_estavam": 0, "fonte_hash": "<o hash do passo 4>", …}`.
   Rodar de novo o **mesmo** arquivo é inofensivo: responde `publicados: 0`, `ja_estavam: 6`.
7. **Conferir no banco** (SQL Editor):

   ```sql
   -- o que foi publicado para o ano: 6 linhas, todas com o hash do passo 4
   select d.chave, v.ano, v.valor, v.vigente_desde, v.vigente_ate, v.fonte_url, v.fonte_hash
     from public.dynamic_content_values v join public.dynamic_content_definitions d on d.id = v.definicao_id
    where v.ano = <ano> order by d.chave, v.vigente_desde;

   -- o que o app vai resolver no primeiro e no último dia do ano (valor não pode vir nulo)
   select d.chave,
          public.conteudo_dinamico_resolver(d.chave, make_date(<ano>, 1, 1)) ->> 'valor'   as em_1_jan,
          public.conteudo_dinamico_resolver(d.chave, make_date(<ano>, 12, 31)) ->> 'valor' as em_31_dez
     from public.dynamic_content_definitions d where d.chave like 'curso_leitura_%' order by 1;
   ```

8. **Conferir na tela, a partir de 1º de janeiro:** em Minha Classe, o requisito do Curso de Leitura
   mostra "Conteúdo de <ano>: <valor>". Em Avaliar classes, o avaliador vê o mesmo texto.

## O que acontece se faltar

A partir de 0h de 1º de janeiro, horário de Brasília, **sem o conteúdo do ano publicado**:

- o requisito do Curso de Leitura de quem ainda **não enviou** fica **bloqueado**. A tela mostra
  "O conteúdo oficial de <ano> (…) ainda não está disponível". A criança não envia, e a liderança
  não aprova direto. Nenhum valor de outro ano é usado no lugar;
- o que **já foi enviado ou aprovado** continua valendo com o conteúdo fixado no envio ou na
  aprovação. Nada é reaberto: a revisão final, o selo, o snapshot, a investidura e o documento
  usam o valor fixado;
- **o que fazer:** publicar o manifesto do ano assim que possível, pelos passos acima. Não há dado a
  corrigir depois: assim que o valor existe, os bloqueios somem.

## Corrigir um conteúdo já publicado

A função **recusa** outro manifesto para um ano que já tem conteúdo publicado. Conteúdo publicado não
se edita por essa porta. Se houver erro:

1. **Antes de alguém usar o valor**, verifique se nenhum requisito já o fixou:

   ```sql
   select count(*) from public.member_requirements
    where conteudo_fixado ->> 'valor_id' in (select id::text from public.dynamic_content_values where ano = <ano>);
   ```

   Com resultado `0`, apague as linhas do ano com `delete from public.dynamic_content_values where ano = <ano>`,
   no SQL Editor e numa transação, e registre o motivo no PR da correção. Depois publique o manifesto
   corrigido pelos passos 3 a 7.
2. **Se algum requisito já fixou o valor**, não troque nada por SQL. O valor fixado é o que a criança
   fez. A decisão sobre como corrigir fica com o dono do produto, e o que for decidido é registrado.

## Staging e testes

`supabase/e2e/popular-staging.mjs` publica um "Livro do ano [STAGING]" por SQL direto, com ano e
vigência fechada. É dado de ambiente de teste e **não** segue este procedimento. Em produção, o único
caminho é o manifesto.
