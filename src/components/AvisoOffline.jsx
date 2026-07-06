import { useState, useEffect } from 'react'

// Faixa que aparece quando o aparelho está SEM internet. Evita que a criança
// pense que os pontos/fotos "sumiram" (antes as telas mostravam "vazio").
export default function AvisoOffline() {
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine)

  useEffect(() => {
    const on = () => setOnline(true)
    const off = () => setOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => {
      window.removeEventListener('online', on)
      window.removeEventListener('offline', off)
    }
  }, [])

  if (online) return null
  return (
    <div className="bg-amber-50 border border-amber-200 text-amber-800 text-sm rounded-xl p-3 mb-4 flex items-center gap-2">
      <span className="text-lg">📡</span>
      <span>Sem internet no momento — o que aparece pode estar desatualizado. Reconecte e atualize.</span>
    </div>
  )
}
