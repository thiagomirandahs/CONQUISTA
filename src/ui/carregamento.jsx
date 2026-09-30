import { useEffect, useState } from 'react'
import { MARCA_PRODUTO } from '../lib/marca.js'
import { encerrarAbertura } from '../lib/abertura.js'
import { PRAZOS } from '../lib/prazo.js'

// Carregamentos do app, num lugar só.
//
// <TelaDeAbertura/> — tela cheia enquanto a sessão/clube ainda não se resolveram. É o MESMO visual
//   da abertura sem JS do index.html (as classes `ab-*` moram em public/abertura.css), então o React
//   assume por cima sem piscar. A identidade é SEMPRE a do produto (MARCA_PRODUTO): neste instante
//   ninguém sabe ainda de que clube a pessoa é — e mostrar um clube aqui seria mostrar o errado.
// <EsqueletoTela/> — dentro do app (rota abrindo, dado chegando): a silhueta da tela, sem texto
//   solto de "Carregando…" e sem spinner. Pulsa só com movimento permitido (motion-safe).
//
// O leitor de tela ouve "Carregando…" pelo role="status"; os olhos veem forma, não texto.

// Fases da abertura (fase 7 — travamento na abertura). Antes só existia "carregando": uma espera que
// nunca terminava parecia o app quebrado e a única saída era fechar e abrir. Agora, quando a rede é o
// problema, a tela DIZ isso e oferece "Tentar de novo" — o app continua sozinho quando a conexão volta.
const PROBLEMAS = {
  sem_conexao: { titulo: 'Sem conexão', texto: 'Seu login está guardado neste aparelho. Assim que a internet voltar, o app continua sozinho.' },
  lento: { titulo: 'A conexão está lenta', texto: 'Ainda estamos tentando abrir. Se quiser, toque em "Tentar de novo".' },
  erro: { titulo: 'Não deu para abrir agora', texto: 'Confira a internet e tente de novo. Nada foi perdido.' },
}

// `fase`: 'normal' (carregando) | 'sem_conexao' | 'lento' | 'erro'. `aoTentar`/`aoSair` só aparecem nas
// fases de problema. `codigo` = id de correlação para citar ao suporte (sem dado pessoal).
export function TelaDeAbertura({ texto = 'Carregando', fase = 'normal', aoTentar, aoSair, codigo }) {
  const [demora, setDemora] = useState(false)
  // depois de alguns segundos o texto "Conectando…" avisa que ainda está trabalhando (só informativo)
  useEffect(() => {
    if (fase !== 'normal') return undefined
    const t = setTimeout(() => setDemora(true), PRAZOS.avisoMs)
    return () => clearTimeout(t)
  }, [fase])
  const problema = PROBLEMAS[fase]
  return (
    <div className="ab-tela" role="status" aria-live="polite" data-testid="tela-de-abertura" data-fase={fase}>
      <span className="sr-only">{problema ? `${problema.titulo}. ${problema.texto}` : `${texto}…`}</span>
      <div className="ab-emblema"><img src={MARCA_PRODUTO.logoUrl} alt="" width="96" height="96" decoding="async" /></div>
      <p className="ab-nome">{MARCA_PRODUTO.nome}</p>
      <p className="ab-lema">{MARCA_PRODUTO.lema}</p>
      {!problema && <div className="ab-barra" aria-hidden="true"><i /></div>}
      {!problema && demora && <p className="ab-aviso" data-testid="abertura-conectando">Conectando…</p>}
      {problema && (
        <div className="ab-problema" data-testid="abertura-problema">
          <p className="ab-problema-titulo">{problema.titulo}</p>
          <p className="ab-problema-texto">{problema.texto}</p>
          {aoTentar && <button type="button" className="ab-botao" onClick={aoTentar} data-testid="abertura-tentar" autoFocus>Tentar de novo</button>}
          {aoSair && <button type="button" className="ab-link" onClick={aoSair} data-testid="abertura-sair">Sair da conta neste aparelho</button>}
          {codigo && <p className="ab-codigo">Se continuar, informe o código {codigo} ao suporte.</p>}
        </div>
      )}
    </div>
  )
}

const pulso = 'bg-surface2 motion-safe:animate-pulse'

export function EsqueletoTela({ cartoes = 3, cabecalho = true, texto = 'Carregando' }) {
  return (
    <div role="status" aria-live="polite" className="space-y-3 w-full" data-testid="esqueleto-tela">
      <span className="sr-only">{texto}…</span>
      {cabecalho && (
        <div className="flex items-center gap-3 pb-1" aria-hidden="true">
          <div className={`w-12 h-12 rounded-2xl ${pulso}`} />
          <div className="flex-1 space-y-2">
            <div className={`h-4 w-1/2 rounded-full ${pulso}`} />
            <div className={`h-3 w-3/4 rounded-full ${pulso}`} />
          </div>
        </div>
      )}
      {Array.from({ length: cartoes }).map((_, i) => (
        <div key={i} className="bg-surface rounded-2xl shadow-soft p-4" aria-hidden="true">
          <div className={`h-4 w-2/5 rounded-full ${pulso}`} />
          <div className={`h-3 w-4/5 rounded-full mt-2.5 ${pulso}`} />
          {i === 0 && <div className={`h-3 w-3/5 rounded-full mt-2 ${pulso}`} />}
        </div>
      ))}
    </div>
  )
}

// Tira a abertura do HTML (com fade) quando o React já pintou algo — a primeira tela ou a própria
// <TelaDeAbertura/>, que é idêntica. Montado uma vez, na raiz do App.
export function FimDaAbertura() {
  useEffect(() => { encerrarAbertura() }, [])
  return null
}
