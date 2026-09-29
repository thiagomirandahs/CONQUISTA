import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { buscarNaRede } from '../../services/rede.js'
import { Carregando } from '../../ui/index.jsx'
import { AvatarRede, Icone, SeloCoordenacao, TXT, TXT_SUAVE, textoDoErro } from './componentes.jsx'

// Buscar na Rede DBV (migration 481): clubes e pessoas (nome + sobrenome, clube). O servidor só devolve
// quem participa da rede em clube com o recurso ligado; a foto de rosto só vem com a autorização de imagem.
export const ESPERA_BUSCA_MS = 300

function Pessoa({ p }) {
  return (
    <li>
      <Link to={`/rede/perfil/${p.id}`} className="flex items-center gap-3 min-h-[60px] px-3 no-underline">
        <AvatarRede nome={p.nome} foto={p.foto} tamanho="w-11 h-11" texto="text-sm" />
        <span className="min-w-0">
          <span className={`block font-semibold text-[14px] ${TXT} truncate`}>{p.nome}{p.coordenacao && <SeloCoordenacao />}</span>
          <span className={`block text-[13px] ${TXT_SUAVE} truncate`}>{p.clube}</span>
        </span>
      </Link>
    </li>
  )
}

export default function RedeBuscar() {
  const [termo, setTermo] = useState('')
  const [clube, setClube] = useState(null)       // { id, nome } — lista as pessoas do clube
  const [res, setRes] = useState(null)
  const [carregando, setCarregando] = useState(false)
  const [erro, setErro] = useState('')
  const t = termo.trim()

  useEffect(() => {
    if (!clube && t.length < 2) { setRes(null); setErro(''); return undefined }
    let vivo = true
    const id = setTimeout(async () => {
      setCarregando(true); setErro('')
      try { const r = await buscarNaRede(clube ? null : t, clube?.id || null); if (vivo) setRes(r) }
      catch (e) { if (vivo) { setRes(null); setErro(textoDoErro(e, 'Não consegui buscar.')) } }
      if (vivo) setCarregando(false)
    }, clube ? 0 : ESPERA_BUSCA_MS)
    return () => { vivo = false; clearTimeout(id) }
  }, [t, clube])

  const pessoas = res?.pessoas || []
  const clubes = res?.clubes || []

  return (
    <div>
      <div className="px-3 pt-3 pb-2 sticky top-[calc(3.5rem+var(--seguro-topo))] z-20 bg-white">
        <label htmlFor="rede-busca" className="sr-only">Buscar clubes e pessoas</label>
        <div className="flex items-center gap-2 rounded-xl bg-[#f1f5f9] px-3 min-h-[44px]">
          <Icone nome="busca" className={`w-5 h-5 ${TXT_SUAVE}`} />
          <input id="rede-busca" type="search" value={termo} autoComplete="off" enterKeyHint="search"
            onChange={(e) => { setTermo(e.target.value); setClube(null) }} placeholder="Buscar clubes e pessoas"
            className={`flex-1 min-w-0 bg-transparent text-[15px] ${TXT} placeholder:text-[#94a3b8] outline-none min-h-[44px]`} />
        </div>
      </div>

      {clube && (
        <div className="flex items-center gap-1 px-1">
          <button type="button" onClick={() => setClube(null)} aria-label="Voltar à busca" className={`w-11 h-11 grid place-items-center ${TXT}`}><Icone nome="voltar" /></button>
          <h1 className={`font-bold ${TXT} truncate`}>{clube.nome}</h1>
        </div>
      )}

      {carregando && <div className="p-4"><Carregando linhas={2} /></div>}
      {erro && <p role="alert" className={`px-4 py-6 text-center text-sm ${TXT_SUAVE}`}>{erro}</p>}
      {!carregando && !erro && !res && (
        <p className={`px-6 py-10 text-center text-sm ${TXT_SUAVE}`}>Digite pelo menos 2 letras do nome de um clube ou de uma pessoa.</p>
      )}
      {!carregando && res && !clube && clubes.length === 0 && pessoas.length === 0 && (
        <p className={`px-6 py-10 text-center text-sm ${TXT_SUAVE}`}>Ninguém encontrado com “{t}”.</p>
      )}

      {!carregando && clubes.length > 0 && (
        <section aria-label="Clubes">
          <h2 className={`px-3 pt-2 pb-1 text-[13px] font-semibold ${TXT_SUAVE}`}>Clubes</h2>
          <ul>
            {clubes.map((c) => (
              <li key={c.id}>
                <button type="button" onClick={() => setClube(c)} className="w-full flex items-center gap-3 min-h-[60px] px-3 text-left">
                  <span aria-hidden="true" className="w-11 h-11 rounded-full bg-[#f1f5f9] grid place-items-center text-[#3b5bff]"><Icone nome="escudo" className="w-6 h-6" /></span>
                  <span className="min-w-0">
                    <span className={`block font-semibold text-[14px] ${TXT} truncate`}>{c.nome}</span>
                    <span className={`block text-[13px] ${TXT_SUAVE}`}>{c.membros} {c.membros === 1 ? 'pessoa' : 'pessoas'} na rede</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      {!carregando && pessoas.length > 0 && (
        <section aria-label="Pessoas">
          <h2 className={`px-3 pt-2 pb-1 text-[13px] font-semibold ${TXT_SUAVE}`}>Pessoas</h2>
          <ul>{pessoas.map((p) => <Pessoa key={p.id} p={p} />)}</ul>
        </section>
      )}
    </div>
  )
}
