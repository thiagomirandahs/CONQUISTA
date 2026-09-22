#!/usr/bin/env node
// Autoteste do validador (supabase/curriculo-manifesto/validar.mjs).
// Prova que cada regra de rejeição pedida na fase 2.5 realmente rejeita — com
// fixtures SINTÉTICAS ("Classe de Teste", "Requisito de teste"), nunca conteúdo
// oficial real (não há necessidade de copiar material protegido pra provar que
// o validador funciona). Roda isolado do manifesto de verdade (validarDados é
// pura — não lê supabase/curriculo-manifesto/classes/*.json aqui).
//
// Uso: node supabase/curriculo-manifesto/validar.autoteste.mjs
import { validarDados } from './validar.mjs'

let falhas = 0
function esperar(nome, cond, detalhe) {
  if (cond) { console.log(`  ok   ${nome}`) } else { falhas++; console.log(`  FAIL ${nome}  ${detalhe || ''}`) }
}

// ---------- fixtures base sintéticas (reaproveitadas/clonadas por caso) ----------
const omdConfirmada = { id: 'OMD-999-2020', numero: '999', ano: 2020, status: 'CONFIRMADO', titulo: 'OMD de teste', data: '2020-01-01' }
const omdPendente = { id: 'OMD-888-2026', numero: '888', ano: 2026, status: 'PENDENTE_DE_VALIDACAO', titulo: 'OMD de teste não confirmada', data: null }

function classeValidaBase() {
  return {
    classe_regular: {
      id: 'teste', nome: 'Classe de Teste', idade_minima: 10,
      fonte_base: { url: 'https://exemplo.test/classe-teste/', publicado_em: '2017-01-01' },
      vigente_desde: '2020-01-01',
      secoes: [
        { id: 'teste.I', codigo: 'I', nome: 'Seção de Teste', ordem: 10, requisitos: [
          { id: 'teste.I.1', codigo: '1', ordem: 10, descricao_resumida: 'Requisito de teste 1.' },
        ] },
      ],
    },
  }
}

function rodar(omdsArr, arquivosClasses) {
  const omds = new Map(omdsArr.map((o) => [o.id, o]))
  return validarDados({ omds, arquivosClasses })
}

console.log('=== Autoteste do validador (fixtures sintéticas) ===\n')

// 1) manifesto válido não deve gerar erro
{
  const r = rodar([], [{ arquivo: 'teste.json', dados: classeValidaBase() }])
  esperar('manifesto sintético válido passa sem erros', r.erros.length === 0, JSON.stringify(r.erros))
}

// 2) requisito sem proveniência (fonte_base da classe ausente)
{
  const dados = classeValidaBase()
  delete dados.classe_regular.fonte_base
  const r = rodar([], [{ arquivo: 'teste.json', dados }])
  esperar('rejeita classe sem fonte_base (requisito sem proveniência)', r.erros.some((e) => e.includes('sem fonte_base.url')))
}

// 3) IDs duplicados
{
  const dados = classeValidaBase()
  dados.classe_regular.secoes[0].requisitos.push({ id: 'teste.I.1', codigo: '2', ordem: 20, descricao_resumida: 'Duplicata proposital.' })
  const r = rodar([], [{ arquivo: 'teste.json', dados }])
  esperar('rejeita ID de requisito duplicado', r.erros.some((e) => e.includes('ID duplicado')))
}

// 3b) código duplicado dentro da mesma seção (mesmo com IDs diferentes)
{
  const dados = classeValidaBase()
  dados.classe_regular.secoes[0].requisitos.push({ id: 'teste.I.1b', codigo: '1', ordem: 20, descricao_resumida: 'Código repetido de propósito.' })
  const r = rodar([], [{ arquivo: 'teste.json', dados }])
  esperar('rejeita código de requisito duplicado na mesma seção', r.erros.some((e) => e.includes('duplicado dentro da seção')))
}

// 4) dependência inexistente: requisito referencia OMD que não está no registro
{
  const dados = classeValidaBase()
  dados.classe_regular.secoes[0].requisitos[0].status = 'ALTERADO_POR_OMD'
  dados.classe_regular.secoes[0].requisitos[0].alterado_por_omd = 'OMD-000-0000'
  const r = rodar([omdConfirmada], [{ arquivo: 'teste.json', dados }])
  esperar('rejeita referência a OMD inexistente no registro', r.erros.some((e) => e.includes('não existe em omds.json')))
}

// 5) OMD PENDENTE_DE_VALIDACAO citada como se fosse confirmada (o caso "OMD 022/2026")
{
  const dados = classeValidaBase()
  dados.classe_regular.secoes[0].requisitos[0].status = 'ALTERADO_POR_OMD'
  dados.classe_regular.secoes[0].requisitos[0].alterado_por_omd = omdPendente.id
  const r = rodar([omdConfirmada, omdPendente], [{ arquivo: 'teste.json', dados }])
  esperar('rejeita requisito ALTERADO_POR_OMD apoiado numa OMD ainda PENDENTE_DE_VALIDACAO', r.erros.some((e) => e.includes('nunca pode ser citada como fonte')))
}

// 5b) o PRÓPRIO registro tentando "promover" a OMD-022-2026 pra CONFIRMADO é rejeitado
{
  const omd022Promovida = { id: 'OMD-022-2026', numero: '022', ano: 2026, status: 'CONFIRMADO', titulo: 'tentativa de promover sem fonte', data: null }
  const r = rodar([omd022Promovida], [{ arquivo: 'teste.json', dados: classeValidaBase() }])
  esperar('rejeita OMD-022-2026 marcada como CONFIRMADO no registro (deve ficar sempre PENDENTE_DE_VALIDACAO)', r.erros.some((e) => e.includes('OMD-022-2026')))
}

// 6) vigência inconsistente: vigente_desde copiado do carimbo de publicação
{
  const dados = classeValidaBase()
  dados.classe_regular.vigente_desde = dados.classe_regular.fonte_base.publicado_em
  const r = rodar([], [{ arquivo: 'teste.json', dados }])
  esperar('rejeita vigente_desde idêntico a publicado_em (cópia do carimbo da página)', r.erros.some((e) => e.includes('IDÊNTICA a fonte_base.publicado_em')))
}

// 6b) classe_regular sem vigente_desde algum
{
  const dados = classeValidaBase()
  delete dados.classe_regular.vigente_desde
  const r = rodar([], [{ arquivo: 'teste.json', dados }])
  esperar('rejeita classe_regular sem vigente_desde', r.erros.some((e) => e.includes('sem vigente_desde')))
}

// 7) item PENDENTE_DE_VALIDACAO apresentado como confirmado (sem motivo, ou com confirmado_por_omd preenchido)
{
  const dados = classeValidaBase()
  dados.classe_regular.secoes[0].requisitos[0].status = 'PENDENTE_DE_VALIDACAO'
  // sem proveniencia_pendente.motivo_pendencia
  const r = rodar([], [{ arquivo: 'teste.json', dados }])
  esperar('rejeita PENDENTE_DE_VALIDACAO sem motivo_pendencia', r.erros.some((e) => e.includes('sem proveniencia_pendente.motivo_pendencia')))
}
{
  const dados = classeValidaBase()
  dados.classe_regular.secoes[0].requisitos[0].status = 'PENDENTE_DE_VALIDACAO'
  dados.classe_regular.secoes[0].requisitos[0].proveniencia_pendente = { motivo_pendencia: 'dúvida de teste' }
  dados.classe_regular.secoes[0].requisitos[0].confirmado_por_omd = omdConfirmada.id
  const r = rodar([omdConfirmada], [{ arquivo: 'teste.json', dados }])
  esperar('rejeita item pendente que também traz confirmado_por_omd (pendente apresentado como confirmado)', r.erros.some((e) => e.includes('tem confirmado_por_omd preenchido')))
}
{
  // o inverso: status CONFIRMADO mas ainda carregando um bloco de pendência (contraditório)
  const dados = classeValidaBase()
  dados.classe_regular.secoes[0].requisitos[0].proveniencia_pendente = { motivo_pendencia: 'não deveria estar aqui' }
  const r = rodar([], [{ arquivo: 'teste.json', dados }])
  esperar('rejeita item CONFIRMADO que ainda carrega proveniencia_pendente', r.erros.some((e) => e.includes('confirmado/alterado E pendente ao mesmo tempo')))
}

// 8) escolha N de M inválida (n maior que o número de opções)
{
  const dados = classeValidaBase()
  dados.classe_regular.secoes[0].requisitos[0].tipo = 'escolha_n_de_m'
  dados.classe_regular.secoes[0].requisitos[0].escolha = { n: 3, opcoes: ['a', 'b'] }
  const r = rodar([], [{ arquivo: 'teste.json', dados }])
  esperar('rejeita escolha.n maior que o número de opções', r.erros.some((e) => e.includes('maior que o número de opções')))
}

// 9) classe_avancada.classe_regular_ref apontando pra classe regular inexistente
{
  const dados = classeValidaBase()
  dados.classe_avancada = {
    id: 'teste_avancada', nome: 'Classe de Teste Avançada', classe_regular_ref: 'nao_existe',
    fonte_base: { url: 'https://exemplo.test/classe-teste-avancada/', publicado_em: '2017-01-01' },
    secao_unica: { id: 'teste_avancada.geral', nome: 'Geral', requisitos: [
      { id: 'teste_avancada.1', codigo: '1', ordem: 10, descricao_resumida: 'Requisito avançado de teste.' },
    ] },
  }
  const r = rodar([], [{ arquivo: 'teste.json', dados }])
  esperar('rejeita classe_regular_ref apontando pra classe inexistente', r.erros.some((e) => e.includes('não corresponde a nenhuma classe_regular')))
}

// 10) (fase 2.6) lacuna_schema sem representação suportada no banco
{
  const dados = classeValidaBase()
  dados.classe_regular.secoes[0].requisitos[0].lacuna_schema = 'lacuna_que_o_schema_nao_representa'
  const r = rodar([], [{ arquivo: 'teste.json', dados }])
  esperar('rejeita lacuna_schema desconhecida (sem representação no schema)', r.erros.some((e) => e.includes('sem representação suportada no schema')))
}
{
  // ...e cada uma das 4 lacunas da fase 2 é aceita (todas têm mecanismo desde a migration 38)
  const dados = classeValidaBase()
  const reqs = dados.classe_regular.secoes[0].requisitos
  reqs.length = 0
  let i = 0
  for (const tag of ['requisito_anual_dinamico', 'escolha_n_de_m', 'escolha_sem_repeticao', 'prazo_conclusao']) {
    i++
    reqs.push({ id: `teste.I.${i}`, codigo: String(i), ordem: i * 10, descricao_resumida: `Requisito de teste ${i}.`, lacuna_schema: tag })
  }
  const r = rodar([], [{ arquivo: 'teste.json', dados }])
  esperar('aceita as 4 lacunas conhecidas (todas representadas: conteúdo dinâmico, N-de-M, sem repetição, prazo)', r.erros.length === 0, JSON.stringify(r.erros))
}

console.log('')
if (falhas === 0) {
  console.log(`Todos os casos do autoteste passaram (o validador rejeita corretamente cada violação pedida).`)
} else {
  console.log(`${falhas} caso(s) do autoteste FALHARAM — o validador não está rejeitando o que deveria.`)
}
process.exit(falhas === 0 ? 0 : 1)
