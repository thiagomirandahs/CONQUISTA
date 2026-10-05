import { describe, it, expect, vi, beforeEach } from 'vitest'
import { registrarFechador, fecharCamadaDoTopo, temCamadaAberta, limparCamadas } from './camadas.js'
import { decidirVoltarFisico, RAIZES } from './voltarFisico.js'

beforeEach(() => limparCamadas())

describe('camadas (botão físico de voltar fecha a de cima)', () => {
  it('fecha SÓ a do topo, na ordem inversa da abertura', () => {
    const a = vi.fn(); const b = vi.fn()
    registrarFechador(a); registrarFechador(b)
    expect(temCamadaAberta()).toBe(true)
    expect(fecharCamadaDoTopo()).toBe(true)
    expect(b).toHaveBeenCalledTimes(1); expect(a).not.toHaveBeenCalled()
  })
  it('quem se desregistra sai da pilha; sem camada devolve false', () => {
    const a = vi.fn()
    const desfaz = registrarFechador(a)
    desfaz(); desfaz()
    expect(temCamadaAberta()).toBe(false)
    expect(fecharCamadaDoTopo()).toBe(false)
    expect(a).not.toHaveBeenCalled()
  })
  it('um fechador que lança não derruba o voltar', () => {
    registrarFechador(() => { throw new Error('x') })
    expect(() => fecharCamadaDoTopo()).not.toThrow()
  })
})

describe('decidirVoltarFisico', () => {
  it('camada aberta: fecha a camada, em qualquer tela', () => {
    expect(decidirVoltarFisico({ caminho: '/inicio', temCamada: true, canGoBack: true })).toBe('fechar-camada')
    expect(decidirVoltarFisico({ caminho: '/mural', temCamada: true })).toBe('fechar-camada')
  })
  it('raiz de aba: minimiza o app, mesmo com histórico (não anda pela pilha de abas)', () => {
    for (const c of RAIZES) expect(decidirVoltarFisico({ caminho: c, canGoBack: true }), c).toBe('minimizar')
    expect(decidirVoltarFisico({ caminho: '/inicio/?x=1#a', canGoBack: true })).toBe('minimizar')
  })
  it('subtela com histórico: volta; sem histórico (entrou por notificação): minimiza', () => {
    expect(decidirVoltarFisico({ caminho: '/minha-classe', canGoBack: true })).toBe('voltar')
    expect(decidirVoltarFisico({ caminho: '/rede/publicar', canGoBack: true })).toBe('voltar')
    expect(decidirVoltarFisico({ caminho: '/minha-classe', canGoBack: false })).toBe('minimizar')
  })
})
