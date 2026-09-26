import React from 'react'
import ReactDOM from 'react-dom/client'
// Handlers globais de erro (fase 8.1): precisam estar de pe ANTES de qualquer render, senao um
// erro no primeiro paint — justamente o pior — passa sem registro.
import { ligarObservabilidade } from './lib/observabilidade.js'
import { recuperarVersao } from './lib/recuperarVersao.js'
import { BrowserRouter } from 'react-router-dom'
import App from './App.jsx'
import { AuthProvider } from './context/Auth.jsx'
import { ClubeProvider } from './context/Clube.jsx'
import { EscopoProvider } from './context/Escopo.jsx'
import { AvisosProvider } from './ui/avisos.jsx'
import { ehNativo, iniciarNativo } from './lib/nativo.js'
import './index.css'

ligarObservabilidade()

// Vite avisa quando um pedaço do app (chunk) não carrega — quase sempre versão velha depois de um
// deploy. Recupera sozinho (troca de versão) em vez de deixar a tela quebrar.
window.addEventListener('vite:preloadError', (e) => {
  e.preventDefault()
  recuperarVersao()
})

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      {/* toast + confirmação: o que substituiu os alert()/confirm() nativos (fase 7.1) */}
      <AvisosProvider>
      <AuthProvider>
        <ClubeProvider>
          {/* jornada institucional (distrito/região/campo): contexto próprio, ao lado do clube — nunca dentro dele */}
          <EscopoProvider>
            <App />
          </EscopoProvider>
        </ClubeProvider>
      </AuthProvider>
      </AvisosProvider>
    </BrowserRouter>
  </React.StrictMode>
)

// Ajustes do app nativo (Android): barra de status, botão voltar, splash.
// No web/iPhone isso não faz nada.
iniciarNativo()

// Atualização automática do PWA: checa por uma versão nova sempre que o app
// abre/volta ao foco e recarrega sozinho quando ela assume — assim ninguém
// fica preso numa versão antiga (sem precisar fechar e reabrir).
if (!ehNativo() && 'serviceWorker' in navigator) {
  if (navigator.serviceWorker.controller) {
    let recarregando = false
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (recarregando) return
      recarregando = true
      window.location.reload()
    })
  }
  navigator.serviceWorker.ready.then((reg) => {
    const checar = () => { if (document.visibilityState === 'visible') reg.update().catch(() => {}) }
    document.addEventListener('visibilitychange', checar)
    window.addEventListener('focus', checar)
    checar()
  }).catch(() => {})
}
