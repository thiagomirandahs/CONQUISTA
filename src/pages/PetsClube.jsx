import { useState, useEffect, useMemo } from 'react'
import { Link } from 'react-router-dom'
import Avatar from '../components/Avatar.jsx'
import { petsDoClube } from '../lib/dados.js'
import { montarBichinhoSvg } from '../lib/bichinhoPecas.js'

function PetImg({ especie, item, estagio, vivo }) {
  const svg = useMemo(() => montarBichinhoSvg({ especie, humor: vivo ? 'feliz' : 'morto', estagio, item }), [especie, item, estagio, vivo])
  return <svg viewBox="0 0 100 100" width={84} height={84} dangerouslySetInnerHTML={{ __html: svg }} />
}

export default function PetsClube() {
  const [pets, setPets] = useState([])
  const [carregando, setCarregando] = useState(true)

  useEffect(() => { petsDoClube().then(setPets).catch(() => {}).finally(() => setCarregando(false)) }, [])

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-extrabold text-brand">🐾 Pets do clube</h1>
          <p className="text-sm text-muted">Os bichinhos de todo mundo — capriche no seu!</p>
        </div>
        <Link to="/bichinho" className="text-sm font-semibold text-brand">Meu bichinho →</Link>
      </div>

      {carregando ? (
        <p className="text-faint text-sm text-center mt-8">Carregando…</p>
      ) : pets.length === 0 ? (
        <div className="bg-surface rounded-2xl p-8 text-center shadow-soft">
          <div className="text-4xl mb-2">🐾</div>
          <p className="font-semibold text-ink">Ninguém adotou um bichinho ainda</p>
          <p className="text-sm text-faint">Seja o primeiro! Vá em <Link to="/bichinho" className="text-brand font-semibold">🐾 Bichinho</Link>.</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {pets.map((p) => (
            <div key={p.dono_id} className={`bg-surface rounded-2xl shadow-soft p-3 text-center ${p.vivo ? '' : 'opacity-60'}`}>
              <div className="bg-surface2 rounded-xl relative">
                <PetImg especie={p.especie} item={p.item} estagio={p.estagio} vivo={p.vivo} />
                {p.ofensiva > 0 && p.vivo && (
                  <span className="absolute top-1 right-1 text-[10px] font-extrabold bg-orange-100 text-orange-600 rounded-full px-1.5">🔥{p.ofensiva}</span>
                )}
              </div>
              <p className="font-bold text-ink text-sm mt-1 truncate">{p.pet_nome}</p>
              <div className="flex items-center justify-center gap-1 mt-0.5">
                <Avatar foto={p.dono_foto} nome={p.dono_nome} size="w-5 h-5" textSize="text-[9px]"
                  avatarPersonagem={p.dono_avatar_tipo === 'personagem' ? p.dono_avatar : undefined} />
                <span className="text-[11px] text-muted truncate">{p.dono_nome?.split(' ')[0]}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
