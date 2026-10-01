// SANEAMENTO DE METADADOS DE VÍDEO MP4/MOV **SEM RECODIFICAR E SEM MOVER NENHUM BYTE** (prova de conceito).
//
// Estratégia: NEUTRALIZAR NO LUGAR, preservando tamanhos e offsets.
//  - Caixa sensível inteira (©xyz, loci, ©mak, ©mod, ©swr, ©cmt/textos livres, ©too com SO/aparelho, uuid XMP, XMP_)
//    => o tipo vira 'free' e o payload é zerado; o campo `size` (e o largesize) NÃO muda.
//  - `meta` QuickTime (mdta): cada item de `ilst` sensível vira caixa 'free' do mesmo tamanho e o texto da chave
//    correspondente em `keys` é zerado (a estrutura da `meta`, a contagem de chaves e os índices dos itens restantes
//    ficam intactos). Escolhido no lugar de "meta inteira -> free" porque preserva itens benignos (ex.: creationdate)
//    e mantém a `meta` válida mesmo quando só parte dos itens é sensível.
//  - (OPCIONAL, decisão do dono) `zerarDatas`: zera creation/modification time de mvhd/tkhd/mdhd e neutraliza ©day/creationdate.
//  Como nenhum tamanho/posição muda, stco/co64, mdat e todo o `stbl` seguem exatamente válidos; nenhum stream é tocado.
//
// O QUE ESTA PoC NÃO FAZ (marcado 'exige_reescrita'; nada é aplicado nesses casos):
//  - metadados de localização em TRILHA (mebx/camm/gpmd): os valores estão dentro do `mdat` (stream) => exigiria reescrever
//    amostras e offsets (ou remover a trilha e reescrever stco/stsc/stsz e todos os offsets).
//  - REMOVER caixas em vez de torná-las `free`, mover o `moov` (faststart) ou compactar o arquivo.
//  - transcodificar.
import { createHash } from 'node:crypto'
import { analisarMp4, analisarMoov, classificar, leitorDeBuffer } from './analisarMp4.mjs'

const aplicaveis = (regioes, zerarDatas) => regioes.filter((r) => zerarDatas || !r.opcional)

// Aplica regiões numa CÓPIA de `bytes` (que começa em `base` no arquivo). Regiões fora do intervalo são ignoradas.
export function aplicarRegioes(bytes, base, regioes) {
  const out = Buffer.from(bytes)
  for (const r of regioes) {
    const ini = r.ini - base
    const fim = r.fim - base
    if (ini < 0 || fim > out.length) continue
    if (r.acao === 'free') {
      out.write('free', ini + 4, 'latin1')
      out.fill(0, ini + r.hdr, fim)
    } else out.fill(0, ini, fim)
  }
  return out
}

const sha = (b) => createHash('sha256').update(b).digest('hex')

function decidir(analise, zerarDatas) {
  if (analise.estado === 'nao_suportado') return { estado: 'nao_suportada', motivo: analise.formato }
  if (analise.estado !== 'ok') return { estado: 'invalida', motivo: analise.motivo }
  if (analise.temLocalizacaoEmTrilha || analise.temTelemetriaEmTrilha) {
    return { estado: 'exige_reescrita', motivo: 'localizacao_em_trilha_de_metadados', pendencias: ['trilha_metadados_no_mdat'] }
  }
  const regs = aplicaveis(analise.regioes, zerarDatas)
  return { estado: regs.length ? 'saneada' : 'limpa', regioes: regs }
}

// Saneia SÓ a caixa `moov` em memória (usado nos arquivos reais: nunca carrega o mdat).
export function sanearMoov(moovBuf, { base = 0, zerarDatas = false } = {}) {
  const a = analisarMoov(moovBuf, { base })
  const d = decidir(a, zerarDatas)
  if (d.estado === 'invalida') return { estado: 'invalida', motivo: d.motivo, bytes: Buffer.from(moovBuf) }
  if (d.estado === 'exige_reescrita') return { estado: d.estado, motivo: d.motivo, pendencias: d.pendencias, bytes: Buffer.from(moovBuf), regioes: [] }
  const bytes = aplicarRegioes(moovBuf, base, d.regioes)
  return { estado: d.estado, bytes, regioes: d.regioes.filter((r) => r.escopo !== 'topo') }
}

// Planeja o saneamento do ARQUIVO por leitor (sem gravar nada): devolve o moov novo + regiões fora do moov.
export function planejarSaneamento(entrada, { zerarDatas = false } = {}) {
  const leitor = entrada && typeof entrada.ler === 'function' ? entrada : leitorDeBuffer(entrada)
  const a = analisarMp4(leitor)
  const d = decidir(a, zerarDatas)
  if (d.estado === 'invalida' || d.estado === 'nao_suportada') return { estado: d.estado, motivo: d.motivo, regioes: [], tamanho: leitor.tamanho ?? 0 }
  if (d.estado === 'exige_reescrita') return { estado: d.estado, motivo: d.motivo, pendencias: d.pendencias, regioes: [], tamanho: a.tamanho }
  const moovIni = a.moov.ini
  const moovFim = moovIni + a.moov.tam
  const regioes = d.regioes
  const dentro = regioes.filter((r) => r.ini >= moovIni && r.fim <= moovFim)
  const fora = regioes.filter((r) => !(r.ini >= moovIni && r.fim <= moovFim))
  const moovOrig = leitor.ler(moovIni, a.moov.tam)
  return { estado: d.estado, tamanho: a.tamanho, regioes, regioesNoMoov: dentro, regioesForaDoMoov: fora, moov: { ini: moovIni, tam: a.moov.tam, original: moovOrig, novo: aplicarRegioes(moovOrig, moovIni, dentro) }, analise: a }
}

// Saneia um arquivo inteiro que já está em memória. Tamanho de saída === tamanho de entrada. Nunca lança.
export function sanearMp4(entrada, opcoes = {}) {
  try {
    const orig = Buffer.isBuffer(entrada) ? entrada : Buffer.from(entrada)
    const plano = planejarSaneamento(orig, opcoes)
    if (plano.estado === 'invalida' || plano.estado === 'nao_suportada' || plano.estado === 'exige_reescrita') return { ...plano, bytes: Buffer.from(orig) }
    if (plano.estado === 'limpa') return { estado: 'limpa', bytes: Buffer.from(orig), regioes: [] }
    return { estado: 'saneada', bytes: aplicarRegioes(orig, 0, plano.regioes), regioes: plano.regioes }
  } catch {
    return { estado: 'invalida', motivo: 'erro_inesperado', bytes: Buffer.from(entrada ?? []), regioes: [] }
  }
}

// ---------- provas ----------
export function intervalosDiferentes(a, b) {
  const out = []
  const n = Math.min(a.length, b.length)
  let ini = -1
  for (let i = 0; i < n; i++) {
    if (a[i] !== b[i]) { if (ini < 0) ini = i } else if (ini >= 0) { out.push([ini, i]); ini = -1 }
  }
  if (ini >= 0) out.push([ini, n])
  return out
}

// Prova por diff de intervalos: só bytes dentro das regiões neutralizadas mudaram; protegidos (mdat, stbl) idênticos.
export function provarImutabilidade(orig, novo, regioes, protegidos = [], base = 0) {
  const difs = intervalosDiferentes(orig, novo)
  const foraDasRegioes = difs.filter(([i, f]) => !regioes.some((r) => i + base >= r.ini && f + base <= r.fim))
  const tocaProtegido = difs.filter(([i, f]) => protegidos.some((p) => i + base < p.fim && f + base > p.ini))
  const hashes = protegidos
    .filter((p) => p.ini >= base && p.fim <= base + orig.length)
    .map((p) => sha(orig.subarray(p.ini - base, p.fim - base)) === sha(novo.subarray(p.ini - base, p.fim - base)))
  return {
    tamanhoIgual: orig.length === novo.length,
    bytesAlterados: difs.reduce((s, [i, f]) => s + (f - i), 0),
    intervalosAlterados: difs.length,
    foraDasRegioes: foraDasRegioes.length,
    tocaProtegido: tocaProtegido.length,
    protegidosIdenticos: hashes.every(Boolean),
  }
}

export { classificar }
