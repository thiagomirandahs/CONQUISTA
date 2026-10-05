import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Folha, Botao } from '../ui/index.jsx'
import { carregarNotificacoes } from '../lib/dados.js'
import { consumirAvisoPendente, escutarAvisoTocado, ligarMensagensDoServiceWorker } from '../lib/avisoTocado.js'

// Popup aberto ao TOCAR numa notificação do celular: mostra o aviso inteiro (a bandeja do sistema
// corta o texto). O push leva no máximo 500 caracteres; se o aviso completo estiver no sino, mostra ele.
export default function AvisoTocado() {
  const navigate = useNavigate()
  const [aviso, setAviso] = useState(null)

  useEffect(() => {
    let vivo = true
    async function abrir(a) {
      if (!a || !vivo) return
      setAviso(a)
      try {
        const lista = await carregarNotificacoes()
        const cheio = (lista || []).find((n) => n.titulo === a.titulo && (n.corpo || '').length > (a.corpo || '').length)
        if (vivo && cheio) setAviso((atual) => (atual && atual.titulo === a.titulo ? { ...atual, corpo: cheio.corpo } : atual))
      } catch { /* fica com o texto do push */ }
    }
    abrir(consumirAvisoPendente())
    const parar = escutarAvisoTocado(abrir)
    const pararSw = ligarMensagensDoServiceWorker()
    return () => { vivo = false; parar(); pararSw() }
  }, [])

  const fechar = () => setAviso(null)
  return (
    <Folha aberta={!!aviso} aoFechar={fechar} titulo="Aviso do clube">
      {aviso && (
        <div data-testid="aviso-tocado">
          <h3 className="font-extrabold text-ink break-words">{aviso.titulo}</h3>
          {aviso.corpo && <p className="mt-3 text-sm text-ink whitespace-pre-line break-words">{aviso.corpo}</p>}
          <div className="mt-4 flex flex-col gap-2">
            {aviso.link && <Botao className="w-full" aoTocar={() => { const l = aviso.link; fechar(); navigate(l) }}>Abrir</Botao>}
            <Botao variacao="secundario" className="w-full" aoTocar={fechar}>Entendi</Botao>
          </div>
        </div>
      )}
    </Folha>
  )
}
