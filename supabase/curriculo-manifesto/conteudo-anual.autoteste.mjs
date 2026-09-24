#!/usr/bin/env node
// Autoteste do validador e do gerador do CONTEÚDO ANUAL (validar-conteudo-anual.mjs,
// gerar-conteudo-anual.mjs). Prova, com dados SINTÉTICOS (nunca conteúdo oficial), que cada regra
// recusa o que deve: vigência aberta, lacuna, sobreposição, fonte ausente, slot desconhecido, ano
// trocado, exemplo misturado com conteúdo real — e que o gerador não gera nada de manifesto inválido.
//
// Uso: node supabase/curriculo-manifesto/conteudo-anual.autoteste.mjs
//      npm run curriculo:conteudo-anual:autoteste
import { validarConteudoAnual, slotsDoManifestoDeClasses, slotsEsperados, carregarManifestosDeConteudo } from './validar-conteudo-anual.mjs'
import { montarPacote, gerarSql } from './gerar-conteudo-anual.mjs'

let falhas = 0
function esperar(nome, cond, detalhe) {
  if (cond) console.log(`  ok   ${nome}`)
  else { falhas++; console.log(`  FAIL ${nome}  ${detalhe || ''}`) }
}

const SLOTS = ['curso_leitura_teste_a', 'curso_leitura_teste_b']
const item = (chave, desde, ate, over = {}) => ({
  chave, valor: 'Livro sintético do autoteste', vigente_desde: desde, vigente_ate: ate,
  fonte_url: 'https://www.adventistas.org/pt/desbravadores/', fonte_descricao: 'fonte sintética do autoteste', ...over,
})
const valido = (over = {}) => ({
  formato: 'conquista.conteudo_anual/1', ano: 2030,
  itens: [item('curso_leitura_teste_a', '2030-01-01', '2030-12-31'), item('curso_leitura_teste_b', '2030-01-01', '2030-12-31')],
  ...over,
})
const rodar = (dados, arquivo = '2030.json') => validarConteudoAnual({ arquivo, dados, slotsEsperados: SLOTS })
const tem = (r, trecho) => r.erros.some((e) => e.includes(trecho))

console.log('=== Autoteste do conteúdo anual (dados sintéticos) ===\n')

{ const r = rodar(valido()); esperar('manifesto sintético válido passa sem erros', r.erros.length === 0, JSON.stringify(r.erros)) }
{
  const d = valido(); d.itens[0] = item('curso_leitura_teste_a', '2030-01-01', '2030-06-30'); d.itens.push(item('curso_leitura_teste_a', '2030-07-01', '2030-12-31'))
  const r = rodar(d); esperar('um slot em dois períodos que se completam é aceito', r.erros.length === 0, JSON.stringify(r.erros))
}
{ const d = valido(); d.itens[0].vigente_ate = null; esperar('recusa vigência ABERTA (vigente_ate null)', tem(rodar(d), 'vigência ABERTA')) }
{ const d = valido(); delete d.itens[0].vigente_ate; esperar('recusa vigência ABERTA (vigente_ate ausente)', tem(rodar(d), 'vigência ABERTA')) }
{ const d = valido(); d.itens[0].vigente_ate = '2031-06-30'; esperar('recusa vigência que atravessa o ano', tem(rodar(d), 'fora do ano 2030')) }
{ const d = valido(); d.itens[0].vigente_ate = '2030-11-30'; esperar('recusa LACUNA no fim do ano (dezembro sem conteúdo)', tem(rodar(d), 'LACUNA')) }
{ const d = valido(); d.itens[0].vigente_desde = '2030-02-01'; esperar('recusa LACUNA no começo do ano (janeiro sem conteúdo)', tem(rodar(d), 'LACUNA')) }
{ const d = valido(); d.itens.pop(); esperar('recusa slot faltando (ano sem conteúdo para uma classe)', tem(rodar(d), 'curso_leitura_teste_b sem conteúdo')) }
{ const d = valido(); d.itens.push(item('curso_leitura_teste_a', '2030-06-01', '2030-06-30')); esperar('recusa períodos que se sobrepõem', tem(rodar(d), 'sobrepõe')) }
{ const d = valido(); d.itens[0].fonte_url = ''; esperar('recusa item sem fonte_url', tem(rodar(d), 'fonte_url')) }
{ const d = valido(); d.itens[0].fonte_url = 'http://www.adventistas.org/x'; esperar('recusa fonte sem https', tem(rodar(d), 'fonte_url')) }
{ const d = valido(); d.itens[0].fonte_descricao = ' '; esperar('recusa item sem fonte_descricao', tem(rodar(d), 'fonte_descricao')) }
{ const d = valido(); d.itens[0].valor = ''; esperar('recusa item sem valor', tem(rodar(d), 'sem "valor"')) }
{ const d = valido(); d.itens[0].chave = 'curso_leitura_inventado'; esperar('recusa chave que não é slot das Classes Regulares', tem(rodar(d), 'não é slot')) }
{ const d = valido(); d.itens[0].extra = 1; esperar('recusa campo desconhecido no item (não aproxima)', tem(rodar(d), 'desconhecida')) }
{ const d = valido({ versao: 2 }); esperar('recusa campo desconhecido no arquivo', tem(rodar(d), 'não conhece')) }
{ const d = valido({ formato: 'outro' }); esperar('recusa formato errado', tem(rodar(d), '"formato"')) }
{ const d = valido({ ano: '2030' }); esperar('recusa ano que não é inteiro', tem(rodar(d), '"ano"')) }
{ esperar('recusa nome de arquivo que não bate com o ano', tem(rodar(valido(), '2031.json'), 'nome do arquivo diz 2031')) }
{ esperar('recusa nome de arquivo fora do padrão', tem(rodar(valido(), 'livros.json'), 'nome inválido')) }
{ const d = valido({ exemplo: true }); esperar('recusa "exemplo": true num arquivo de ano real', tem(rodar(d), 'não pode ser "exemplo"')) }
{ const d = valido(); d.itens[0].valor = 'Livro [TESTE]'; esperar('recusa marca de teste/exemplo em conteúdo real', tem(rodar(d), 'marcado como exemplo/teste')) }
{ esperar('exemplo.json sem "exemplo": true é recusado', tem(rodar(valido(), 'exemplo.json'), 'precisa declarar "exemplo": true')) }
{
  const d = valido({ exemplo: true }); d.itens.forEach((i) => { i.valor = '[EXEMPLO] ' + i.valor })
  esperar('exemplo.json marcado e com "[EXEMPLO]" em cada valor passa', rodar(d, 'exemplo.json').erros.length === 0, JSON.stringify(rodar(d, 'exemplo.json').erros))
}
{
  const d = valido(); d.itens[0].fonte_url = 'https://blog-qualquer.invalid/livro'
  const r = rodar(d); esperar('fonte fora dos domínios reconhecidos gera AVISO (não bloqueia)', r.erros.length === 0 && r.avisos.some((a) => a.includes('blog-qualquer.invalid')))
}

// os slots vêm do manifesto das CLASSES (mesma regra do importador): classe com requisito anual_dinamico
{
  const classes = [
    { arquivo: 'x.json', dados: { classe_regular: { id: 'xis', secoes: [{ requisitos: [{ tipo: 'anual_dinamico' }] }] } } },
    { arquivo: 'y.json', dados: { classe_regular: { id: 'ipsilon', secoes: [{ requisitos: [{ tipo: 'simples' }] }] } } },
  ]
  esperar('slots = curso_leitura_<classe> só das classes com requisito anual', JSON.stringify(slotsDoManifestoDeClasses(classes)) === '["curso_leitura_xis"]')
}
{
  const reais = slotsEsperados()
  esperar('o manifesto real das classes declara os 6 slots do Curso de Leitura', reais.length === 6 && reais.every((s) => s.startsWith('curso_leitura_')), reais.join(','))
}

// gerador
{
  let recusou = false
  try { const d = valido(); d.itens[0].vigente_ate = null; montarPacote({ arquivo: '2030.json', dados: d }, SLOTS) } catch { recusou = true }
  esperar('o gerador NÃO gera nada de manifesto inválido', recusou)
}
{
  const a = gerarSql({ arquivo: '2030.json', dados: valido() }, SLOTS)
  const d2 = valido(); d2.itens.reverse()
  const b = gerarSql({ arquivo: '2030.json', dados: d2 }, SLOTS)
  esperar('o SQL gerado é determinístico (a ordem dos itens no arquivo não muda o hash)', a.hash === b.hash && a.sql === b.sql)
  esperar('o SQL chama conteudo_anual_publicar com o hash sha256 do pacote', /select public\.conteudo_anual_publicar\(/.test(a.sql) && a.sql.includes(`'${a.hash}'`) && /^[0-9a-f]{64}$/.test(a.hash))
  esperar('o pacote carrega o ano e o arquivo de origem', a.pacote.ano === 2030 && a.pacote.arquivo === 'supabase/curriculo-manifesto/conteudo-anual/2030.json')
  esperar('SQL de ano real NÃO vem embrulhado em rollback', !/rollback;/.test(a.sql))
  const d3 = valido(); d3.itens[0].valor = 'Outro livro'
  esperar('mudar o conteúdo muda o hash (a função do banco recusa outro manifesto para ano publicado)', gerarSql({ arquivo: '2030.json', dados: d3 }, SLOTS).hash !== a.hash)
}
{
  const ex = carregarManifestosDeConteudo().find((m) => m.arquivo === 'exemplo.json')
  const sql = ex ? gerarSql(ex, slotsEsperados()).sql : ''
  esperar('o EXEMPLO do repositório é válido e o SQL dele vem embrulhado em begin/rollback (nunca publica)', ex && /^begin;$/m.test(sql) && /^rollback;$/m.test(sql))
}

console.log(falhas === 0 ? '\nOK — todas as regras recusam o que devem.' : `\nFALHOU — ${falhas} caso(s).`)
process.exit(falhas === 0 ? 0 : 1)
