// Rascunho do relatório: local (aparelho) → servidor, com retentativa e detecção de conflito.
// REGRA: isto só sincroniza RASCUNHO. Nada aqui envia o requisito para avaliação.
//
//   digitou → grava no aparelho (~300 ms) → tenta o servidor (autosaveMs) → se caiu a rede, MANTÉM o local e
//   tenta de novo quando voltar (evento `online`, aba visível) e por backoff 5→15→30→60 s.
//   Antes de empurrar um local que ficou pendente, confere o servidor (`carregarServidor`): se ele mudou
//   desde a base da edição local, vira CONFLITO — nunca sobrescreve em silêncio.
import { useEffect, useRef, useState } from 'react'
import { limparConteudo } from '../../lib/relatorio/conteudo.js'
import {
  hashRascunho, gravarLocal, lerLocal, apagarSoLocal, lerBackup, gravarBackup, limparLocal, descartarLocalComBackup, decidirCarga,
} from '../../lib/relatorio/rascunhoLocal.js'
import { ehErroDeRede } from '../../lib/prazo.js'
import { textoDoErro } from './mensagens.js'

const ESCALA_S = [5, 15, 30, 60]
export const LOCAL_MS = 300
const semRede = () => typeof navigator !== 'undefined' && navigator.onLine === false
const assinar = (c, a) => JSON.stringify([c, a])

// Roda UMA vez, na montagem: decide entre servidor, local e conflito (sem escrever nada no storage).
export function decidirInicio({ chaveLocal, valorInicial }) {
  const servidor = { conteudo: valorInicial?.conteudo || {}, anexos: valorInicial?.anexos || [], editavel: true }
  const emServidor = valorInicial?.rascunhoEm ?? null // horário do rascunho na nuvem (null = rascunho antigo, sem horário)
  const base = {
    conteudo: servidor.conteudo, anexos: servidor.anexos, baseHash: hashRascunho(servidor.conteudo, servidor.anexos),
    sigServidor: assinar(servidor.conteudo, servidor.anexos), pendente: false, conflito: null, limpar: false,
  }
  if (!chaveLocal) return base
  const local = lerLocal(chaveLocal)
  const d = decidirCarga({ local, servidor })
  if (d.acao === 'local') return { ...base, conteudo: local.conteudo, anexos: local.anexos, pendente: true }
  if (d.acao === 'conflito') {
    return {
      ...base, conteudo: local.conteudo, anexos: local.anexos, pendente: true,
      conflito: {
        local: { conteudo: local.conteudo, anexos: local.anexos, em: local.editadoEm ?? null },
        servidor: { conteudo: servidor.conteudo, anexos: servidor.anexos, em: emServidor },
      },
    }
  }
  return { ...base, limpar: d.limpar === true }
}

export function useRascunhoRelatorio({
  campos, conteudo, anexos, setConteudo, setAnexos, desativado, onSalvarRascunho, autosaveMs,
  chaveLocal, carregarServidor, inicio,
}) {
  const [estado, setEstado] = useState(inicio.pendente ? 'local' : 'ocioso') // ocioso | salvando | salvo | local | erro
  const [motivo, setMotivo] = useState('')
  const [conflito, setConflito] = useState(inicio.conflito)
  const [encerrado, setEncerrado] = useState(false)
  const [temBackup, setTemBackup] = useState(() => !!lerBackup(chaveLocal))
  const m = useRef({
    ultimo: inicio.sigServidor, ultimoLocal: assinar(inicio.conteudo, inicio.anexos), sig: assinar(inicio.conteudo, inicio.anexos),
    conteudo: inicio.conteudo, anexos: inicio.anexos, base: inicio.baseHash, conflito: !!inicio.conflito, conferir: inicio.pendente,
    emVoo: false, parou: false, bloqueado: false, tentativa: 0, retry: null, sincronizar: null,
  })

  // servidor e local iguais na abertura: o local já não serve para nada
  useEffect(() => { if (inicio.limpar && chaveLocal) apagarSoLocal(chaveLocal) }, [inicio.limpar, chaveLocal])

  async function sincronizar() {
    const s = m.current
    if (s.emVoo || desativado || s.parou || s.conflito || s.sig === s.ultimo) return
    const assinatura = s.sig
    s.emVoo = true
    clearTimeout(s.retry); s.retry = null
    setEstado('salvando'); setMotivo('')
    const limpo = limparConteudo(campos, s.conteudo)
    const ax = s.anexos
    try {
      if (semRede()) throw Object.assign(new Error('Sem internet'), { name: 'TimeoutError' })
      if (s.conferir && carregarServidor) {
        const srv = await carregarServidor()
        if (srv && srv.editavel === false) { // já foi enviado/aprovado por outro caminho: cópia de segurança, sem sobrescrever
          if (chaveLocal) descartarLocalComBackup(chaveLocal)
          s.parou = true
          setEncerrado(true); setTemBackup(!!lerBackup(chaveLocal)); setEstado('local')
          return
        }
        if (srv) {
          const hs = hashRascunho(srv.conteudo, srv.anexos)
          if (hs !== s.base && hs !== hashRascunho(limpo, ax)) {
            s.conflito = true
            setConflito({
              local: { conteudo: limpo, anexos: ax, em: (chaveLocal && lerLocal(chaveLocal)?.editadoEm) || Date.now() },
              servidor: { conteudo: srv.conteudo || {}, anexos: srv.anexos || [], em: srv.rascunhoEm ?? null },
            })
            setEstado('local')
            return
          }
        }
      }
      await onSalvarRascunho(limpo, ax)
      s.ultimo = assinatura; s.base = hashRascunho(limpo, ax); s.conferir = false; s.tentativa = 0
      const igual = s.sig === assinatura
      if (chaveLocal) gravarLocal(chaveLocal, { conteudo: limpo, anexos: ax, base: s.base, sincronizado: igual })
      setEstado(igual ? 'salvo' : 'local')
    } catch (e) {
      if (ehErroDeRede(e) || semRede()) {
        s.conferir = true
        const noAparelho = !!chaveLocal && s.ultimoLocal === s.sig
        setEstado(noAparelho ? 'local' : 'erro')
        if (!noAparelho) setMotivo('Sem internet.')
        const d = ESCALA_S[Math.min(s.tentativa, ESCALA_S.length - 1)]
        s.tentativa++
        s.retry = setTimeout(() => m.current.sincronizar?.(), d * 1000)
      } else {
        s.bloqueado = true // recusa de validação: não insiste sozinho; o local fica
        setEstado('erro'); setMotivo(String(textoDoErro(e)).slice(0, 160))
      }
    } finally {
      s.emVoo = false
      if (s.sig !== s.ultimo && !s.bloqueado && !s.parou && !s.conflito && !s.retry) s.retry = setTimeout(() => m.current.sincronizar?.(), autosaveMs)
    }
  }
  useEffect(() => { m.current.sincronizar = sincronizar })

  // mudou algo: grava no aparelho (rápido) e agenda o servidor (mais devagar)
  useEffect(() => {
    const s = m.current
    s.conteudo = conteudo; s.anexos = anexos
    const sig = assinar(conteudo, anexos)
    s.sig = sig
    if (desativado) return undefined
    const timers = []
    if (chaveLocal && sig !== s.ultimoLocal) {
      timers.push(setTimeout(() => {
        if (gravarLocal(chaveLocal, { conteudo: limparConteudo(campos, conteudo), anexos, base: s.base, sincronizado: false })) {
          s.ultimoLocal = sig
          setEstado((e) => (e === 'salvando' ? e : 'local'))
        }
      }, LOCAL_MS))
    }
    if (sig !== s.ultimo && !s.parou) {
      s.bloqueado = false
      clearTimeout(s.retry); s.retry = null
      timers.push(setTimeout(() => s.sincronizar?.(), autosaveMs))
    }
    return () => timers.forEach(clearTimeout)
  }, [conteudo, anexos, desativado, chaveLocal, campos, autosaveMs])

  // a conexão voltou / a aba voltou a ficar visível: tenta agora (só faz algo se houver rascunho pendente)
  useEffect(() => {
    if (desativado) return undefined
    const s0 = m.current
    const tentar = () => { const s = m.current; if (!s.bloqueado && !s.parou) s.sincronizar?.() }
    const visivel = () => { if (document.visibilityState === 'visible') tentar() }
    window.addEventListener('online', tentar)
    document.addEventListener('visibilitychange', visivel)
    return () => {
      window.removeEventListener('online', tentar)
      document.removeEventListener('visibilitychange', visivel)
      clearTimeout(s0.retry)
    }
  }, [desativado])

  function tentarDeNovo() {
    const s = m.current
    s.bloqueado = false; s.conferir = true
    s.sincronizar?.()
  }

  // conflito: as DUAS escolhas são explícitas; a versão que não vale vira backup local recuperável
  function resolverConflito(qual) {
    const s = m.current
    const c = conflito
    if (!c) return
    if (qual === 'servidor') {
      gravarBackup(chaveLocal, c.local)
      setConteudo(c.servidor.conteudo); setAnexos(c.servidor.anexos)
      s.base = hashRascunho(c.servidor.conteudo, c.servidor.anexos)
      s.ultimo = assinar(c.servidor.conteudo, c.servidor.anexos)
      s.ultimoLocal = s.ultimo
      if (chaveLocal) gravarLocal(chaveLocal, { ...c.servidor, base: s.base, sincronizado: true })
      setEstado('salvo')
    } else {
      gravarBackup(chaveLocal, c.servidor)
      s.base = hashRascunho(c.servidor.conteudo, c.servidor.anexos)
      s.ultimo = assinar(c.servidor.conteudo, c.servidor.anexos) // difere do local → volta a sincronizar
      s.conferir = false
      if (chaveLocal) gravarLocal(chaveLocal, { ...c.local, base: s.base, sincronizado: false })
      setEstado('local')
      s.retry = setTimeout(() => m.current.sincronizar?.(), 0)
    }
    s.conflito = false
    setConflito(null)
    setTemBackup(!!lerBackup(chaveLocal))
  }

  // "Recuperar a outra versão": troca; a versão de agora vira o backup (dá para voltar)
  function recuperarBackup() {
    const b = lerBackup(chaveLocal)
    if (!b) return
    gravarBackup(chaveLocal, { conteudo: limparConteudo(campos, m.current.conteudo), anexos: m.current.anexos })
    setConteudo(b.conteudo); setAnexos(b.anexos)
  }

  return {
    estado, motivo, conflito, encerrado, temBackup, tentarDeNovo, resolverConflito, recuperarBackup,
    parar: () => { m.current.parou = true; clearTimeout(m.current.retry) },
    retomar: () => { m.current.parou = false },
    aoEnviado: () => { m.current.parou = true; clearTimeout(m.current.retry); limparLocal(chaveLocal) },
  }
}
