// @vitest-environment node
// Fila de anexos: a MESMA suíte roda contra o adaptador em memória e contra o IndexedDB (fake-indexeddb).
import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { describe, it, expect, beforeEach } from 'vitest'
import {
  criarFila, criarArmazenamentoMemoria, criarArmazenamentoIdb, ErroFila, ESTADOS, TRANSICOES,
  caminhoDoItem, classificarErro, LIMITES_PADRAO,
} from './index.js'

const UID = '11111111-1111-4111-8111-111111111111'
const UID2 = '22222222-2222-4222-8222-222222222222'
const CL = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const CL2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const DEST = { tipo: 'rascunho', alvo: 'classe', ref: 'req-1', campo: 'fotos' }
const T0 = 1_800_000_000_000

const foto = (bytes = 1000, tipo = 'image/jpeg', semente = 1) => new Blob([new Uint8Array(bytes).fill(semente)], { type: tipo })
const rede = () => Object.assign(new TypeError('Failed to fetch'))
const http = (statusCode, message = 'x') => Object.assign(new Error(message), { statusCode })

let relogio
const avancar = (ms) => { relogio += ms }

const adaptadores = {
  memoria: () => criarArmazenamentoMemoria(),
  indexeddb: () => criarArmazenamentoIdb({ indexedDB: new IDBFactory(), nome: `t-${Math.random()}` }),
}

describe.each(Object.keys(adaptadores))('fila de anexos — adaptador %s', (nomeAdaptador) => {
  let arm
  let ids
  const nova = (extra = {}) => criarFila({
    armazenamento: arm, agora: () => relogio, uuid: () => `item-${String(++ids).padStart(4, '0')}-aaaa`, estimar: async () => null,
    online: () => true, ...extra,
  })
  const base = { uid: UID, clube: CL }

  beforeEach(() => { arm = adaptadores[nomeAdaptador](); relogio = T0; ids = 0 })

  describe('adicionar', () => {
    it('guarda o anexo com id estável, caminho determinístico e sem dado pessoal', async () => {
      const f = nova()
      const r = await f.adicionar({ ...base, destino: DEST, blob: foto(1500) })
      expect(r.duplicado).toBe(false)
      const [m] = await f.listar(base)
      expect(m).toMatchObject({ id: r.id, uid: UID, clube: CL, estado: 'enfileirado', tentativas: 0, bytes: 1500, mime: 'image/jpeg', destino: DEST })
      expect(m.caminho).toBe(`${UID}/requisitos/${r.id}.jpg`)
      expect(m.sha256).toMatch(/^[0-9a-f]{64}$/)
      expect(Object.keys(m)).not.toContain('nome')
      const blob = await f.obterBlob({ ...base, id: r.id })
      expect(blob.size).toBe(1500)
      expect(blob.type).toBe('image/jpeg')
    })

    it('idempotência: o mesmo id devolve o mesmo item, sem duplicar', async () => {
      const f = nova()
      const a = await f.adicionar({ ...base, destino: DEST, blob: foto(), id: 'meu-id-fixo-01' })
      const b = await f.adicionar({ ...base, destino: DEST, blob: foto(), id: 'meu-id-fixo-01' })
      expect(a.duplicado).toBe(false)
      expect(b.duplicado).toBe(true)
      expect(await f.listar(base)).toHaveLength(1)
    })

    it('id já usado por OUTRA conta é recusado e nunca revela o item alheio', async () => {
      const f = nova()
      await f.adicionar({ ...base, destino: DEST, blob: foto(), id: 'id-compartilhado-1' })
      await expect(f.adicionar({ uid: UID2, clube: CL, destino: DEST, blob: foto(), id: 'id-compartilhado-1' }))
        .rejects.toMatchObject({ codigo: 'ID_EM_USO' })
    })

    it('duas adições simultâneas com o mesmo id gravam só uma', async () => {
      const f = nova()
      const [a, b] = await Promise.all([
        f.adicionar({ ...base, destino: DEST, blob: foto(), id: 'corrida-0001' }),
        f.adicionar({ ...base, destino: DEST, blob: foto(), id: 'corrida-0001' }),
      ])
      expect([a.duplicado, b.duplicado].sort()).toEqual([false, true])
      expect(await f.listar(base)).toHaveLength(1)
    })

    it.each([
      ['uid ausente', { uid: '', clube: CL, destino: DEST, blob: foto() }, 'ENTRADA'],
      ['clube ausente', { uid: UID, clube: '', destino: DEST, blob: foto() }, 'ENTRADA'],
      ['destino inválido', { ...base, destino: { tipo: 'outro', alvo: 'classe', ref: 'r' }, blob: foto() }, 'ENTRADA'],
      ['destino com caminho perigoso', { ...base, destino: { tipo: 'rascunho', alvo: '../x', ref: 'r' }, blob: foto() }, 'ENTRADA'],
      ['sem arquivo', { ...base, destino: DEST, blob: null }, 'ENTRADA'],
      ['id inseguro', { ...base, destino: DEST, blob: foto(), id: '../../x' }, 'ENTRADA'],
      ['SVG', { ...base, destino: DEST, blob: foto(10, 'image/svg+xml') }, 'TIPO'],
      ['vídeo', { ...base, destino: DEST, blob: foto(10, 'video/mp4') }, 'TIPO'],
      ['vazio', { ...base, destino: DEST, blob: new Blob([], { type: 'image/jpeg' }) }, 'TAMANHO'],
      ['grande demais', { ...base, destino: DEST, blob: foto(LIMITES_PADRAO.maxBytesPorAnexo + 1) }, 'TAMANHO'],
    ])('recusa %s', async (_n, args, codigo) => {
      await expect(nova().adicionar(args)).rejects.toMatchObject({ codigo })
      expect(await arm.listar()).toHaveLength(0)
    })

    it('limite de itens por destino e por conta; só conta o que está ativo', async () => {
      const f = nova({ limites: { maxItensPorDestino: 2, maxItensPorConta: 3 } })
      const a = await f.adicionar({ ...base, destino: DEST, blob: foto() })
      await f.adicionar({ ...base, destino: DEST, blob: foto() })
      await expect(f.adicionar({ ...base, destino: DEST, blob: foto() })).rejects.toMatchObject({ codigo: 'LIMITE_ITENS' })
      await f.cancelar({ ...base, id: a.id }) // libera uma vaga
      await f.adicionar({ ...base, destino: DEST, blob: foto() })
      await f.adicionar({ ...base, destino: { ...DEST, ref: 'req-2' }, blob: foto() })
      await expect(f.adicionar({ ...base, destino: { ...DEST, ref: 'req-3' }, blob: foto() })).rejects.toMatchObject({ codigo: 'LIMITE_ITENS' })
    })

    it('limite de bytes por conta e por aparelho', async () => {
      const f = nova({ limites: { maxBytesPorConta: 2500, maxBytesTotal: 3500 } })
      await f.adicionar({ ...base, destino: DEST, blob: foto(1200) })
      await f.adicionar({ ...base, destino: DEST, blob: foto(1200) })
      await expect(f.adicionar({ ...base, destino: DEST, blob: foto(200) })).rejects.toMatchObject({ codigo: 'LIMITE_BYTES' })
      await f.adicionar({ uid: UID2, clube: CL, destino: DEST, blob: foto(1000) }) // outra conta cabe no total
      await expect(f.adicionar({ uid: UID2, clube: CL, destino: DEST, blob: foto(300) })).rejects.toMatchObject({ codigo: 'LIMITE_BYTES' })
    })

    it('cota baixa do aparelho (storage.estimate): recusa com COTA_BAIXA e não grava', async () => {
      const f = nova({ estimar: async () => ({ usage: 900 * 1024 * 1024, quota: 940 * 1024 * 1024 }) })
      await expect(f.adicionar({ ...base, destino: DEST, blob: foto() })).rejects.toMatchObject({ codigo: 'COTA_BAIXA' })
      expect(await arm.listar()).toHaveLength(0)
    })

    it('sem estimate (navegador antigo) a fila funciona normalmente', async () => {
      const f = nova({ estimar: async () => { throw new Error('sem suporte') } })
      await expect(f.adicionar({ ...base, destino: DEST, blob: foto() })).resolves.toMatchObject({ duplicado: false })
    })

    it('documento sensível: só JPEG, 1 por destino, pasta documentos', async () => {
      const f = nova()
      await expect(f.adicionar({ ...base, destino: DEST, blob: foto(10, 'image/png'), sensivel: true })).rejects.toMatchObject({ codigo: 'TIPO' })
      const r = await f.adicionar({ ...base, destino: DEST, blob: foto(), sensivel: true })
      expect((await f.listar(base))[0].caminho).toBe(`${UID}/documentos/${r.id}.jpg`)
      await expect(f.adicionar({ ...base, destino: DEST, blob: foto(), sensivel: true })).rejects.toMatchObject({ codigo: 'LIMITE_ITENS' })
    })
  })

  describe('isolamento por usuário + clube', () => {
    it('cada conta/clube só enxerga e mexe no que é seu', async () => {
      const f = nova()
      const a = await f.adicionar({ uid: UID, clube: CL, destino: DEST, blob: foto() })
      const b = await f.adicionar({ uid: UID2, clube: CL, destino: DEST, blob: foto() })
      const c = await f.adicionar({ uid: UID, clube: CL2, destino: DEST, blob: foto() })
      expect((await f.listar({ uid: UID, clube: CL })).map((m) => m.id)).toEqual([a.id])
      expect((await f.listar({ uid: UID2, clube: CL })).map((m) => m.id)).toEqual([b.id])
      expect((await f.listar({ uid: UID, clube: CL2 })).map((m) => m.id)).toEqual([c.id])
      expect(await f.obterBlob({ uid: UID2, clube: CL, id: a.id })).toBeNull()
      expect(await f.cancelar({ uid: UID2, clube: CL, id: a.id })).toBe(false)
      expect(await f.tentarDeNovo({ uid: UID, clube: CL2, id: a.id })).toBe(false)
      expect((await f.listar({ uid: UID, clube: CL }))[0].estado).toBe('enfileirado')
    })

    it('processar nunca envia item de outra conta nem de outro clube', async () => {
      const f = nova()
      await f.adicionar({ uid: UID2, clube: CL, destino: DEST, blob: foto() })
      await f.adicionar({ uid: UID, clube: CL2, destino: DEST, blob: foto() })
      const mina = await f.adicionar({ uid: UID, clube: CL, destino: DEST, blob: foto() })
      const enviados = []
      await f.processar({ ...base, enviar: async (x) => { enviados.push(x.id) } })
      expect(enviados).toEqual([mina.id])
    })

    it('sair da conta: descartarDaConta apaga só a conta que saiu', async () => {
      const f = nova()
      await f.adicionar({ uid: UID, clube: CL, destino: DEST, blob: foto() })
      await f.adicionar({ uid: UID, clube: CL2, destino: DEST, blob: foto() })
      const outro = await f.adicionar({ uid: UID2, clube: CL, destino: DEST, blob: foto() })
      expect(await f.descartarDaConta({ uid: UID })).toBe(2)
      expect((await arm.listar()).map((m) => m.id)).toEqual([outro.id])
    })

    it('descartarDaConta({soSensiveis}) apaga o documento e mantém as fotos comuns', async () => {
      const f = nova()
      const comum = await f.adicionar({ ...base, destino: DEST, blob: foto() })
      await f.adicionar({ ...base, destino: { ...DEST, ref: 'doc' }, blob: foto(), sensivel: true })
      expect(await f.descartarDaConta({ uid: UID, soSensiveis: true })).toBe(1)
      expect((await arm.listar()).map((m) => m.id)).toEqual([comum.id])
    })

    it('descartarTudo zera o aparelho', async () => {
      const f = nova()
      await f.adicionar({ ...base, destino: DEST, blob: foto() })
      await f.descartarTudo()
      expect(await arm.listar()).toHaveLength(0)
    })
  })

  describe('envio, idempotência e retomada', () => {
    it('envia com o caminho do item, marca enviado e LIBERA o arquivo do aparelho', async () => {
      const f = nova()
      const { id } = await f.adicionar({ ...base, destino: DEST, blob: foto(800) })
      const chamadas = []
      const r = await f.processar({ ...base, enviar: async (x) => { chamadas.push(x) } })
      expect(r).toMatchObject({ enviados: 1, falhas: 0, pendentes: 0 })
      expect(chamadas[0]).toMatchObject({ id, caminho: `${UID}/requisitos/${id}.jpg`, mime: 'image/jpeg', uid: UID, clube: CL })
      expect(chamadas[0].blob.size).toBe(800)
      const [m] = await f.listar(base)
      expect(m).toMatchObject({ estado: 'enviado', enviadoEm: T0, tentativas: 1 })
      expect(await arm.lerBlob(id)).toBeNull()
      expect(await f.processar({ ...base, enviar: async () => { throw new Error('não deveria enviar de novo') } })).toMatchObject({ enviados: 0 })
    })

    it('Storage respondeu "já existe" (409): conta como enviado — não duplica nem fica preso', async () => {
      const f = nova()
      await f.adicionar({ ...base, destino: DEST, blob: foto() })
      const r = await f.processar({ ...base, enviar: async () => { throw http(409, 'The resource already exists') } })
      expect(r.enviados).toBe(1)
      expect((await f.listar(base))[0].estado).toBe('enviado')
    })

    it('rede caiu: volta a enfileirado com espera crescente e para a rodada', async () => {
      const f = nova()
      await f.adicionar({ ...base, destino: DEST, blob: foto() })
      await f.adicionar({ ...base, destino: DEST, blob: foto() })
      let n = 0
      const r = await f.processar({ ...base, enviar: async () => { n++; throw rede() } })
      expect(n).toBe(1) // não insiste nos outros
      expect(r).toMatchObject({ parou: 'rede', enviados: 0 })
      const [a, b] = await f.listar(base)
      expect(a).toMatchObject({ estado: 'enfileirado', tentativas: 1, proximaTentativaEm: T0 + 5000, erro: { codigo: 'REDE' } })
      expect(b).toMatchObject({ estado: 'enfileirado', tentativas: 0 })
      // antes da espera nada é enviado
      n = 0
      await f.processar({ ...base, enviar: async () => { n++; throw rede() } })
      expect(n).toBe(1) // só o b (o a ainda espera)
      avancar(6000)
      const enviados = []
      await f.processar({ ...base, enviar: async (x) => { enviados.push(x.id) } })
      expect(enviados).toHaveLength(2)
      expect((await f.listar(base)).every((m) => m.estado === 'enviado')).toBe(true)
    })

    it('espera dobra a cada tentativa até o teto e, esgotadas as tentativas, vira "falhou" (com arquivo guardado)', async () => {
      const f = nova({ limites: { maxTentativas: 3, esperaBaseMs: 1000, esperaMaxMs: 1500 } })
      const { id } = await f.adicionar({ ...base, destino: DEST, blob: foto() })
      const esperas = []
      for (let i = 0; i < 3; i++) {
        await f.processar({ ...base, enviar: async () => { throw rede() } })
        const [m] = await f.listar(base)
        esperas.push(m.proximaTentativaEm - relogio)
        avancar(2000)
      }
      expect(esperas.slice(0, 2)).toEqual([1000, 1500])
      const [m] = await f.listar(base)
      expect(m).toMatchObject({ estado: 'falhou', tentativas: 3, erro: { codigo: 'REDE_ESGOTOU' } })
      expect(await arm.lerBlob(id)).not.toBeNull() // o arquivo continua guardado para "Tentar de novo"
      expect(await f.tentarDeNovo({ ...base, id })).toBe(true)
      expect((await f.listar(base))[0]).toMatchObject({ estado: 'enfileirado', tentativas: 0, proximaTentativaEm: 0 })
      expect((await f.processar({ ...base, enviar: async () => {} })).enviados).toBe(1)
    })

    it('erro de REGRA (ex.: permissão/tamanho) vai a "falhou" sem repetir e a rodada segue nos outros', async () => {
      const f = nova()
      await f.adicionar({ ...base, destino: DEST, blob: foto(), id: 'primeiro-item-1' })
      const b = await f.adicionar({ ...base, destino: DEST, blob: foto(), id: 'segundo-item-02' })
      const enviados = []
      const r = await f.processar({ ...base, enviar: async (x) => {
        if (x.id === 'primeiro-item-1') throw http(403, 'new row violates row-level security policy')
        enviados.push(x.id)
      } })
      expect(r).toMatchObject({ enviados: 1, falhas: 1 })
      expect(enviados).toEqual([b.id])
      const [a] = await f.listar({ ...base, estados: ['falhou'] })
      expect(a.erro.codigo).toBe('REGRA')
      expect(a.erro.mensagem).toMatch(/row-level/)
    })

    it('sessão expirada (401) não gasta tentativa e para a rodada', async () => {
      const f = nova()
      await f.adicionar({ ...base, destino: DEST, blob: foto() })
      const r = await f.processar({ ...base, enviar: async () => { throw http(401, 'JWT expired') } })
      expect(r.parou).toBe('sessao')
      expect((await f.listar(base))[0]).toMatchObject({ estado: 'enfileirado', tentativas: 0 })
    })

    it('retomada: "enviando" de um app que morreu volta a enfileirado só depois do lease', async () => {
      const f = nova()
      const { id } = await f.adicionar({ ...base, destino: DEST, blob: foto() })
      // simula o app morrendo no meio do envio
      await arm.atualizar(id, (m) => ({ meta: { ...m, estado: 'enviando', iniciadoEm: relogio, tentativas: 1 } }))
      let n = 0
      await f.processar({ ...base, enviar: async () => { n++ } })
      expect(n).toBe(0) // lease ainda valendo: outra execução pode estar enviando
      avancar(LIMITES_PADRAO.leaseMs + 1)
      await f.processar({ ...base, enviar: async () => { n++ } })
      expect(n).toBe(1)
      expect((await f.listar(base))[0].estado).toBe('enviado')
    })

    it('retomada após reabrir o app (nova instância, mesmo armazenamento)', async () => {
      const antes = nova()
      const { id } = await antes.adicionar({ ...base, destino: DEST, blob: foto(700) })
      const depois = nova() // "app reaberto"
      const r = await depois.processar({ ...base, enviar: async (x) => { expect(x.blob.size).toBe(700) } })
      expect(r.enviados).toBe(1)
      expect((await depois.listar(base))[0]).toMatchObject({ id, estado: 'enviado' })
    })

    it('duas execuções simultâneas não enviam o mesmo item duas vezes (trava local + CAS no armazenamento)', async () => {
      const fa = nova()
      const fb = nova() // "outra aba": instância própria, mesmo armazenamento
      await fa.adicionar({ ...base, destino: DEST, blob: foto() })
      let n = 0
      const lento = async () => { n++; await new Promise((r) => setTimeout(r, 15)) }
      const [r1, r2] = await Promise.all([fa.processar({ ...base, enviar: lento }), fb.processar({ ...base, enviar: lento })])
      expect(n).toBe(1)
      expect(r1.enviados + r2.enviados).toBe(1)
      const [again] = await Promise.all([fa.processar({ ...base, enviar: lento }), fa.processar({ ...base, enviar: lento })])
      expect(again).toBeTruthy()
      expect(n).toBe(1)
    })

    it('offline: não tenta enviar e informa quantos esperam', async () => {
      const f = nova({ online: () => false })
      await f.adicionar({ ...base, destino: DEST, blob: foto() })
      const r = await f.processar({ ...base, enviar: async () => { throw new Error('não deve chamar') } })
      expect(r).toMatchObject({ pulado: 'offline', pendentes: 1 })
    })

    it('arquivo sumiu do aparelho (despejado pelo sistema): falhou com ARQUIVO_PERDIDO, sem travar', async () => {
      const f = nova()
      const { id } = await f.adicionar({ ...base, destino: DEST, blob: foto() })
      await arm.atualizar(id, (m) => ({ meta: m, apagarBlob: true }))
      const r = await f.processar({ ...base, enviar: async () => {} })
      expect(r.falhas).toBe(1)
      expect((await f.listar(base))[0]).toMatchObject({ estado: 'falhou', erro: { codigo: 'ARQUIVO_PERDIDO' } })
    })

    it('arquivo corrompido (sha256 diferente) nunca sobe', async () => {
      const f = nova({ hash: async (b) => (b.size === 1000 ? 'a'.repeat(64) : 'b'.repeat(64)) })
      await f.adicionar({ ...base, destino: DEST, blob: foto(1000) })
      await arm.atualizar((await arm.listar())[0].id, (m) => ({ meta: { ...m, sha256: 'c'.repeat(64) } }))
      const r = await f.processar({ ...base, enviar: async () => { throw new Error('não deve subir') } })
      expect(r.falhas).toBe(1)
      expect((await f.listar(base))[0].erro.codigo).toBe('CORROMPIDO')
    })

    it('item adulterado com outro uid no armazenamento nunca é enviado para esta conta', async () => {
      const f = nova()
      const { id } = await f.adicionar({ uid: UID2, clube: CL, destino: DEST, blob: foto() })
      const r = await f.processar({ ...base, enviar: async () => { throw new Error('não deve enviar') } })
      expect(r.enviados).toBe(0)
      expect((await arm.obter(id)).estado).toBe('enfileirado')
    })
  })

  describe('máquina de estados', () => {
    it('estados finais não voltam; cancelar apaga o arquivo; cancelar de novo é ignorado', async () => {
      const f = nova()
      const { id } = await f.adicionar({ ...base, destino: DEST, blob: foto() })
      expect(await f.cancelar({ ...base, id })).toBe(true)
      expect(await arm.lerBlob(id)).toBeNull()
      expect(await f.cancelar({ ...base, id })).toBe(false)
      expect(await f.tentarDeNovo({ ...base, id })).toBe(false)
      expect((await f.processar({ ...base, enviar: async () => { throw new Error('não deve enviar') } })).enviados).toBe(0)
    })

    it('tentarDeNovo só vale para "falhou"', async () => {
      const f = nova()
      const { id } = await f.adicionar({ ...base, destino: DEST, blob: foto() })
      expect(await f.tentarDeNovo({ ...base, id })).toBe(false)
    })

    it('a tabela de transições não deixa sair de estado final', () => {
      expect(TRANSICOES[ESTADOS.ENVIADO]).toEqual([])
      expect(TRANSICOES[ESTADOS.CANCELADO]).toEqual([])
    })

    it('confirmar remove a lápide do enviado e não mexe em item ainda ativo', async () => {
      const f = nova()
      const a = await f.adicionar({ ...base, destino: DEST, blob: foto() })
      expect(await f.confirmar({ ...base, id: a.id })).toBe(false)
      await f.processar({ ...base, enviar: async () => {} })
      expect(await f.confirmar({ ...base, id: a.id })).toBe(true)
      expect(await f.listar(base)).toHaveLength(0)
    })
  })

  describe('limpeza e resumo', () => {
    it('expira item antigo (7 dias; documento 24 h), libera o arquivo e remove a lápide depois', async () => {
      const f = nova()
      const comum = await f.adicionar({ ...base, destino: DEST, blob: foto() })
      const doc = await f.adicionar({ ...base, destino: { ...DEST, ref: 'doc' }, blob: foto(), sensivel: true })
      avancar(25 * 3600 * 1000)
      let r = await f.limpar()
      expect(r.expirados).toBe(1)
      expect(await arm.lerBlob(doc.id)).toBeNull()
      expect((await arm.obter(doc.id)).erro.codigo).toBe('EXPIRADO')
      expect((await arm.obter(comum.id)).estado).toBe('enfileirado')
      avancar(7 * 24 * 3600 * 1000)
      r = await f.limpar()
      expect(r).toMatchObject({ expirados: 1, removidos: 1 }) // a lápide do documento (já passou 1 h) sai junto
      avancar(LIMITES_PADRAO.tumuloMs + 1)
      r = await f.limpar()
      expect(r.removidos).toBe(1)
      expect(await arm.listar()).toHaveLength(0)
    })

    it('resumo conta pendentes/falhas/bytes só da conta', async () => {
      const f = nova()
      await f.adicionar({ ...base, destino: DEST, blob: foto(500) })
      await f.adicionar({ ...base, destino: DEST, blob: foto(300) })
      await f.adicionar({ uid: UID2, clube: CL, destino: DEST, blob: foto(900) })
      expect(await f.resumo(base)).toEqual({ pendentes: 2, falhas: 0, enviados: 0, bytes: 800 })
    })

    it('observar avisa a tela a cada mudança e desinscreve', async () => {
      const f = nova()
      let n = 0
      const sair = f.observar(() => { n++ })
      await f.adicionar({ ...base, destino: DEST, blob: foto() })
      expect(n).toBeGreaterThan(0)
      sair()
      const antes = n
      await f.adicionar({ ...base, destino: DEST, blob: foto() })
      expect(n).toBe(antes)
    })
  })
})

describe('adaptador em memória com cota', () => {
  it('QuotaExceeded vira ErroFila COTA e nada fica gravado', async () => {
    const arm = criarArmazenamentoMemoria({ limiteBytes: 500 })
    const f = criarFila({ armazenamento: arm, agora: () => T0, estimar: async () => null })
    await expect(f.adicionar({ ...{ uid: UID, clube: CL }, destino: DEST, blob: foto(1000) })).rejects.toMatchObject({ codigo: 'COTA' })
    expect(await arm.listar()).toHaveLength(0)
  })
})

describe('adaptador IndexedDB — persistência real', () => {
  it('sobrevive a fechar e reabrir o banco (app reiniciado)', async () => {
    const idb = new IDBFactory()
    const a1 = criarArmazenamentoIdb({ indexedDB: idb, nome: 'persistencia' })
    const f1 = criarFila({ armazenamento: a1, agora: () => T0, estimar: async () => null })
    const { id } = await f1.adicionar({ uid: UID, clube: CL, destino: DEST, blob: foto(1234, 'image/webp', 7) })
    await a1.fechar()
    const a2 = criarArmazenamentoIdb({ indexedDB: idb, nome: 'persistencia' })
    const f2 = criarFila({ armazenamento: a2, agora: () => T0, estimar: async () => null })
    const [m] = await f2.listar({ uid: UID, clube: CL })
    expect(m).toMatchObject({ id, mime: 'image/webp', bytes: 1234 })
    const blob = await f2.obterBlob({ uid: UID, clube: CL, id })
    expect(new Uint8Array(await blob.arrayBuffer()).every((x) => x === 7)).toBe(true)
    expect(blob.type).toBe('image/webp')
  })

  it('sem IndexedDB no ambiente: erro claro (quem chama cai no adaptador em memória)', () => {
    expect(() => criarArmazenamentoIdb({ indexedDB: null })).toThrow(ErroFila)
  })
})

describe('utilitários', () => {
  it('caminho determinístico: mesmo item, mesmo caminho; entrada insegura recusada', () => {
    const a = caminhoDoItem({ uid: UID, id: 'abcdefgh-1', mime: 'image/png' })
    expect(a).toBe(caminhoDoItem({ uid: UID, id: 'abcdefgh-1', mime: 'image/png' }))
    expect(a).toBe(`${UID}/requisitos/abcdefgh-1.png`)
    expect(a).toMatch(/^[A-Za-z0-9_./-]+$/) // mesmo regex do servidor (_anexos_do_dono_erros)
    expect(() => caminhoDoItem({ uid: UID, id: '../../x', mime: 'image/png' })).toThrow(ErroFila)
    expect(() => caminhoDoItem({ uid: UID, id: 'abcdefgh-1', mime: 'image/gif' })).toThrow(ErroFila)
  })

  it('classifica os erros do Storage', () => {
    expect(classificarErro(http(409, 'The resource already exists'))).toBe('duplicado')
    expect(classificarErro(http(401, 'JWT expired'))).toBe('sessao')
    expect(classificarErro(rede())).toBe('rede')
    expect(classificarErro(http(503))).toBe('rede')
    expect(classificarErro(http(413, 'Payload too large'))).toBe('regra')
    expect(classificarErro(http(403, 'new row violates row-level security policy'))).toBe('regra')
  })
})
