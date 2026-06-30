import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App.jsx'
import { AuthProvider } from './context/Auth.jsx'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <App />
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>
)

// Atualização automática do PWA: checa por uma versão nova sempre que o app
// abre/volta ao foco e recarrega sozinho quando ela assume — assim ninguém
// fica preso numa versão antiga (sem precisar fechar e reabrir).
if ('serviceWorker' in navigator) {
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
