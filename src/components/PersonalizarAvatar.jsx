import { useState } from 'react'
import { motion } from 'framer-motion'
import AvatarPersonagem from './AvatarPersonagem.jsx'
import { PELES, CORES_CABELO, CORES_ROUPA, CABELOS, ROUPAS, ACESSORIOS, AVATAR_PADRAO } from '../lib/avatarPecas.js'
import { salvarAvatar } from '../lib/dados.js'
import { vitoria as festa, acerto } from '../lib/juice.js'

function Swatch({ cor, selecionado, onClick }) {
  return (
    <button type="button" onClick={onClick}
      className={`w-8 h-8 rounded-full shrink-0 transition ${selecionado ? 'ring-2 ring-offset-2 ring-azul' : ''}`}
      style={{ background: cor }} aria-label={cor} />
  )
}

function Peca({ item, nivel, selecionado, onClick }) {
  const bloqueado = item.nivel > nivel
  return (
    <button type="button" disabled={bloqueado} onClick={onClick}
      className={`relative rounded-xl px-3 py-2 text-xs font-bold border shrink-0 ${
        bloqueado ? 'bg-slate-50 text-slate-300 border-slate-100' :
        selecionado ? 'bg-azul text-white border-azul' : 'bg-white text-slate-600 border-slate-200'
      }`}>
      {item.nome}
      {bloqueado && <span className="block text-[9px] font-semibold mt-0.5">🔒 Nível {item.nivel}</span>}
    </button>
  )
}

export default function PersonalizarAvatar({ avatarAtual, nivel, onFechar, onSalvo }) {
  const [av, setAv] = useState({ ...AVATAR_PADRAO, ...(avatarAtual || {}) })
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')

  function mudar(campo, valor) { setAv((a) => ({ ...a, [campo]: valor })) }

  async function salvar() {
    setErro(''); setSalvando(true)
    try {
      await salvarAvatar(av, 'personagem')
      festa(2)
      onSalvo?.(av)
    } catch (e) { setErro(e?.message || String(e)) }
    setSalvando(false)
  }

  async function usarFoto() {
    setSalvando(true)
    try { await salvarAvatar(null, 'foto'); onSalvo?.(null, 'foto') } catch (e) { setErro(e?.message || String(e)) }
    setSalvando(false)
  }

  return (
    <motion.div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onFechar}>
      <motion.div onClick={(e) => e.stopPropagation()}
        initial={{ y: 30, opacity: 0, scale: 0.97 }} animate={{ y: 0, opacity: 1, scale: 1 }} exit={{ y: 30, opacity: 0 }}
        transition={{ type: 'spring', stiffness: 320, damping: 28 }}
        className="bg-white w-full max-w-sm rounded-3xl shadow-2xl max-h-[90vh] overflow-y-auto">
        <div className="p-5">
          <h3 className="font-extrabold text-slate-800 text-lg mb-1">🧑‍🎨 Monte seu personagem</h3>
          <p className="text-xs text-slate-400 mb-3">Peças novas desbloqueiam conforme você sobe de nível.</p>

          <div className="flex justify-center mb-4">
            <AvatarPersonagem avatar={av} size="w-28 h-28" />
          </div>

          <p className="text-xs font-bold text-slate-700 mb-1.5">Pele</p>
          <div className="flex gap-2 mb-4">
            {PELES.map((c) => <Swatch key={c} cor={c} selecionado={av.pele === c} onClick={() => mudar('pele', c)} />)}
          </div>

          <p className="text-xs font-bold text-slate-700 mb-1.5">Cabelo</p>
          <div className="flex gap-2 flex-wrap mb-2">
            {CABELOS.map((c) => (
              <Peca key={c.id} item={c} nivel={nivel} selecionado={av.cabelo === c.id}
                onClick={() => { acerto(1); mudar('cabelo', c.id) }} />
            ))}
          </div>
          <div className="flex gap-2 mb-4">
            {CORES_CABELO.map((c) => <Swatch key={c} cor={c} selecionado={av.corCabelo === c} onClick={() => mudar('corCabelo', c)} />)}
          </div>

          <p className="text-xs font-bold text-slate-700 mb-1.5">Roupa</p>
          <div className="flex gap-2 flex-wrap mb-2">
            {ROUPAS.map((r) => (
              <Peca key={r.id} item={r} nivel={nivel} selecionado={av.roupa === r.id}
                onClick={() => { acerto(1); mudar('roupa', r.id) }} />
            ))}
          </div>
          <div className="flex gap-2 mb-4">
            {CORES_ROUPA.map((c) => <Swatch key={c} cor={c} selecionado={av.corRoupa === c} onClick={() => mudar('corRoupa', c)} />)}
          </div>

          <p className="text-xs font-bold text-slate-700 mb-1.5">Acessório</p>
          <div className="flex gap-2 flex-wrap mb-4">
            {ACESSORIOS.map((a) => (
              <Peca key={a.id} item={a} nivel={nivel} selecionado={av.acessorio === a.id}
                onClick={() => { acerto(2); mudar('acessorio', a.id) }} />
            ))}
          </div>

          {erro && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3 mb-3">{erro}</div>}

          <div className="flex gap-2">
            <button onClick={onFechar} className="flex-1 rounded-xl bg-slate-100 text-slate-700 font-semibold py-2.5">Cancelar</button>
            <motion.button onClick={salvar} disabled={salvando} whileTap={{ scale: 0.97 }}
              className="flex-1 rounded-xl bg-azul text-white font-extrabold py-2.5 disabled:opacity-60">
              {salvando ? '...' : '✅ Salvar'}
            </motion.button>
          </div>
          <button onClick={usarFoto} disabled={salvando} className="w-full text-xs text-slate-400 font-semibold mt-3">
            Prefiro usar minha foto
          </button>
        </div>
      </motion.div>
    </motion.div>
  )
}
