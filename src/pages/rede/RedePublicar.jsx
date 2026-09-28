import { useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../../context/Auth.jsx'
import { useClube } from '../../context/Clube.jsx'
import { carregarDesafios, prepararFoto, publicarNaRede, CATEGORIAS_CONQUISTA, CONFIRMAR_POST } from '../../services/rede.js'
import { tamanhoLegivel } from '../../lib/imagem.js'
import { avisar } from '../../ui/avisos.jsx'
import { useRede } from './contexto.js'
import { Icone, PILL, PILL_PRIMARIA, TXT, TXT_SUAVE, textoDoErro } from './componentes.jsx'

// Nova publicação da Rede DBV: Foto · Desafio · Conquista. Texto até 300 com contador, descrição da
// imagem (alt) para quem não consegue ver, aviso fixo de que a localização sai da foto. A foto é
// redesenhada e comprimida AQUI (WebP/JPEG ≤ 1080 px, ~150 KB, sem EXIF) e o tamanho final aparece.
// O servidor faz a triagem de texto (legenda E descrição) e os limites. Desde 29/09/2026 (decisão do
// dono) a publicação é DIRETA: antes de enviar, a tela pergunta "Tem certeza? Fica visível para todos
// os clubes da Rede DBV." (Publicar · Voltar). A moderação passa a ser por denúncia.
const TIPOS = [['foto', 'Foto', 'camera'], ['desafio', 'Desafio', 'trofeu'], ['conquista', 'Conquista', 'escudo']]
const MAX = 300

export default function RedePublicar() {
  const { profile } = useAuth()
  const { clubeId } = useClube()
  const { status } = useRede()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const desafioDaUrl = params.get('desafio')
  const [tipo, setTipo] = useState(desafioDaUrl ? 'desafio' : 'foto')
  const [texto, setTexto] = useState('')
  const [foto, setFoto] = useState(null)          // { arquivo, antes, depois }
  const [previa, setPrevia] = useState(null)
  const [preparando, setPreparando] = useState(false)
  const [alt, setAlt] = useState('')
  const [desafios, setDesafios] = useState(null)
  const [desafioId, setDesafioId] = useState(desafioDaUrl || '')
  const [conquista, setConquista] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [recusa, setRecusa] = useState('')
  const input = useRef(null)

  useEffect(() => {
    let vivo = true
    carregarDesafios().then((r) => {
      if (!vivo) return
      const lista = [r?.semana, ...(r?.outros || [])].filter(Boolean).filter((d) => !d.participei)
      setDesafios(lista)
    }).catch(() => { if (vivo) setDesafios([]) })
    return () => { vivo = false }
  }, [])
  useEffect(() => () => { if (previa) URL.revokeObjectURL?.(previa) }, [previa])

  async function escolherFoto(e) {
    const f = e.target.files?.[0]
    if (!f) return
    setPreparando(true); setRecusa('')
    try {
      const r = await prepararFoto(f)
      setFoto(r)
      setPrevia(URL.createObjectURL?.(r.arquivo) || null)
    } catch (err) { setRecusa(textoDoErro(err, 'Não consegui preparar a foto.')); setFoto(null) }
    setPreparando(false)
  }
  function tirarFoto() {
    setFoto(null); setPrevia(null); setAlt('')
    if (input.current) input.current.value = ''
  }

  const tipoFinal = tipo === 'foto' ? (foto ? 'foto' : 'livre') : tipo
  const pronto = !enviando && !preparando && texto.length <= MAX && (
    tipo === 'foto' ? (!!foto || !!texto.trim())
      : tipo === 'desafio' ? !!desafioId && (!!foto || !!texto.trim())
        : !!conquista && !!texto.trim())

  async function publicar() {
    if (!pronto) return
    if (!(await avisar.confirmar(CONFIRMAR_POST))) return
    setEnviando(true); setRecusa('')
    try {
      const r = await publicarNaRede({ tipo: tipoFinal, legenda: texto.trim(), foto, alt: alt.trim(), desafioId, conquista, clubeId, userId: profile?.id })
      if (r?.ok) { avisar.sucesso(r.mensagem); navigate('/rede') } else setRecusa(r?.mensagem || 'Não foi possível publicar.')
    } catch (err) { setRecusa(textoDoErro(err, 'Não consegui publicar.')) }
    setEnviando(false)
  }

  if (status && !status.pode_publicar) {
    return (
      <div className="p-6 text-center">
        <p className={`font-bold ${TXT}`}>Você acompanha a rede, mas não publica</p>
        <p className={`text-sm ${TXT_SUAVE} mt-1`}>
          {status.papel === 'pais' ? 'Responsáveis acompanham a Rede DBV, mas não publicam nem comentam.' : 'Sua rede está pausada por alguns dias. Depois você pode publicar de novo 🙂'}
        </p>
      </div>
    )
  }

  return (
    <div>
      <div className="sticky top-14 z-20 px-2 py-1.5 bg-white border-b border-[#eef1f5] flex items-center justify-between gap-2">
        <button type="button" onClick={() => navigate(-1)} aria-label="Voltar" className={`min-h-[44px] min-w-[44px] rounded-full grid place-items-center ${TXT}`}>
          <Icone nome="voltar" />
        </button>
        <h1 className={`font-bold text-[17px] ${TXT}`}>Nova publicação</h1>
        <button type="button" onClick={publicar} disabled={!pronto} className={PILL_PRIMARIA}>{enviando ? 'Publicando…' : 'Publicar'}</button>
      </div>

      <div role="tablist" aria-label="Tipo de publicação" className="grid grid-cols-3 gap-2 m-3">
        {TIPOS.map(([chave, rotulo, icone]) => (
          // ícone EM CIMA e nome embaixo, centralizados (lado a lado não cabia em 375 px: "Conquista"
          // encostava na borda e os ícones saíam do centro)
          <button key={chave} type="button" role="tab" aria-selected={tipo === chave} onClick={() => setTipo(chave)}
            className={`flex min-h-[64px] flex-col items-center justify-center gap-1 rounded-2xl px-1 text-xs font-semibold ${tipo === chave ? 'bg-[#eef2ff] text-[#3b5bff] ring-2 ring-[#3b5bff]' : `bg-[#f1f5f9] ${TXT}`}`}>
            <Icone nome={icone} className="block h-6 w-6 shrink-0" />
            <span className="leading-none">{rotulo}</span>
          </button>
        ))}
      </div>

      <div className="px-3 pb-4 space-y-4">
        {tipo === 'desafio' && (
          <div>
            <label htmlFor="rede-desafio" className={`block text-sm font-bold ${TXT} mb-1`}>Qual desafio?</label>
            <select id="rede-desafio" value={desafioId} onChange={(e) => setDesafioId(e.target.value)}
              className={`w-full min-h-[44px] rounded-2xl bg-[#f1f5f9] px-3 text-sm ${TXT}`}>
              <option value="">Escolha um desafio ativo</option>
              {(desafios || []).map((d) => <option key={d.id} value={d.id}>{d.titulo} (+{d.pontos} pts)</option>)}
            </select>
            {desafios && desafios.length === 0 && <p className={`text-xs ${TXT_SUAVE} mt-1`}>Não há desafio aberto agora (ou você já participou de todos).</p>}
          </div>
        )}
        {tipo === 'conquista' && (
          <fieldset>
            <legend className={`text-sm font-bold ${TXT} mb-2`}>Que tipo de conquista?</legend>
            <div className="flex flex-wrap gap-2">
              {CATEGORIAS_CONQUISTA.map(([chave, rotulo, icone]) => (
                <button key={chave} type="button" aria-pressed={conquista === chave} onClick={() => setConquista(chave)}
                  className={`${PILL} ${conquista === chave ? 'bg-[#e7f6ea] text-[#1f5a2e] ring-2 ring-[#3aa35a]' : `bg-[#f5f6fb] ${TXT}`}`}>
                  <span aria-hidden="true">{icone}</span> {rotulo}
                </button>
              ))}
            </div>
          </fieldset>
        )}

        <div>
          <label htmlFor="rede-texto" className={`block text-sm font-bold ${TXT} mb-1`}>
            {tipo === 'conquista' ? 'Conte a conquista (ex.: "Concluí a classe Amigo")' : 'No que você está pensando?'}
          </label>
          <textarea id="rede-texto" value={texto} onChange={(e) => setTexto(e.target.value.slice(0, MAX))} maxLength={MAX} rows={4}
            placeholder="Conte como foi a reunião, o acampamento, a especialidade…"
            className={`w-full rounded-2xl bg-[#f1f5f9] px-3 py-2.5 text-sm ${TXT}`} />
          <p className={`text-xs text-right ${texto.length >= MAX ? 'text-amber-700 font-bold' : TXT_SUAVE}`} aria-live="polite">{texto.length}/{MAX}</p>
        </div>

        {tipo !== 'conquista' && (
          <div>
            {!foto ? (
              <label htmlFor="rede-foto" className={`flex flex-col items-center justify-center gap-1 min-h-[120px] rounded-3xl border-2 border-dashed border-[#cbd5e1] bg-[#f8fafc] text-sm font-bold ${TXT_SUAVE} cursor-pointer`}>
                <Icone nome="camera" className="w-9 h-9" />
                {preparando ? 'Otimizando a foto…' : `Adicionar foto${tipo === 'foto' ? ' (opcional)' : ''}`}
              </label>
            ) : (
              <div className="relative rounded-2xl overflow-hidden bg-[#f1f5f9]">
                {previa && <img src={previa} alt="Prévia da foto" className="block w-full h-auto" />}
                <button type="button" onClick={tirarFoto} className={`${PILL} absolute top-2 right-2 bg-white/90 ${TXT}`}>Trocar</button>
              </div>
            )}
            <input ref={input} id="rede-foto" type="file" accept="image/*" className="sr-only" onChange={escolherFoto} />
            {foto && (
              <>
                <p className={`text-xs ${TXT_SUAVE} mt-2`} data-testid="tamanho-foto">Foto otimizada: {tamanhoLegivel(foto.antes)} → {tamanhoLegivel(foto.depois)}</p>
                <label htmlFor="rede-alt" className={`block text-sm font-bold ${TXT} mt-3 mb-1`}>Descrição da imagem (para quem não consegue ver)</label>
                <input id="rede-alt" value={alt} onChange={(e) => setAlt(e.target.value.slice(0, 200))} maxLength={200}
                  placeholder="Ex.: minha unidade montando a barraca"
                  className={`w-full min-h-[44px] rounded-2xl bg-[#f1f5f9] px-3 text-sm ${TXT}`} />
              </>
            )}
          </div>
        )}

        <p className="text-sm font-bold text-[#047857] bg-[#ecfdf5] rounded-xl px-3 py-2">✅ Localização removida da foto automaticamente</p>
        <p className={`text-xs ${TXT_SUAVE}`}>Não mostre documento, endereço, escola ou nome completo. Nada de telefone, @ ou links.</p>
        {recusa && <p role="alert" className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-2xl p-3">{recusa}</p>}
      </div>
    </div>
  )
}
