import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../../context/Auth.jsx'
import { carregarDesafios, prepararFoto, publicarNaRede, publicarConquista, listarConquistasPublicaveis, confirmacaoDePublicar } from '../../services/rede.js'
import { podeGerirAtividades } from '../../lib/permissoes.js'
import { tamanhoLegivel } from '../../lib/imagem.js'
import { avisar } from '../../ui/avisos.jsx'
import { useRede, useUnidadeDaRede } from './contexto.js'
import { CARD, Icone, PILL, PILL_CLARA, PILL_PRIMARIA, TXT, TXT_SUAVE, textoDoErro } from './componentes.jsx'

// Nova publicação da Rede DBV: Foto · Desafio · Atividade · Evento · Aviso · Foto do clube (+ "Compartilhar
// conquista", só liderança, montada pelo servidor a partir do registro real — nunca texto livre; sem vídeo).
// Alcance (515): "Só meu clube" (padrão) ou "Comunidade (todos os clubes)" — a segunda só aparece para
// diretoria/instrutor (espelha permissoes.js; o servidor impõe) e pede confirmação explícita. Texto até 300 com contador, descrição da
// imagem (alt) para quem não consegue ver, aviso fixo de que a localização sai da foto. A foto é
// redesenhada e comprimida AQUI (WebP/JPEG ≤ 1080 px, ~150 KB, sem EXIF) e o tamanho final aparece.
// O servidor faz a triagem de texto (legenda E descrição) e os limites. Desde 29/09/2026 (decisão do
// dono) a publicação é DIRETA: antes de enviar, a tela pergunta "Tem certeza? Fica visível para todos
// os clubes da Rede DBV." (Publicar · Voltar). A moderação passa a ser por denúncia.
const TIPOS_CLUBE = [['foto', 'Foto', 'camera'], ['desafio', 'Desafio', 'trofeu']]
const TIPOS_NOVOS = [['atividade', 'Atividade', 'grade'], ['evento', 'Evento', 'bandeira'], ['aviso', 'Aviso', 'sino'], ['foto_clube', 'Foto do clube', 'camera']]
const ALCANCES = [['clube', 'Só meu clube'], ['comunidade', 'Comunidade (todos os clubes)']]
const tiposDoAlcance = (alcance) => (alcance === 'comunidade' ? TIPOS_NOVOS : [...TIPOS_CLUBE, ...TIPOS_NOVOS])
const PLACEHOLDER_ALT = { foto_clube: 'Ex.: nosso clube reunido no pátio' }
const MAX = 300

export default function RedePublicar() {
  const { profile } = useAuth()
  const clubeId = useUnidadeDaRede()   // clube em uso ou unidade de coordenação (490)
  const { status } = useRede()
  const podeComunidade = !status?.coordenacao && podeGerirAtividades(status?.papel)
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const desafioDaUrl = params.get('desafio')
  const [tipo, setTipo] = useState(params.get('origem_tipo') ? 'conquista' : desafioDaUrl ? 'desafio' : 'foto')
  const [texto, setTexto] = useState('')
  const [foto, setFoto] = useState(null)          // { arquivo, antes, depois }
  const [previa, setPrevia] = useState(null)
  const [preparando, setPreparando] = useState(false)
  const [alt, setAlt] = useState('')
  const [desafios, setDesafios] = useState(null)
  const [desafioId, setDesafioId] = useState(desafioDaUrl || '')
  const [alcance, setAlcance] = useState('clube')
  // Conquista (517): lista vinda do servidor -> preview seguro -> publicar. O cliente só manda origem_tipo/origem_id
  // que VIERAM da lista. ?origem_tipo/?origem_id antigos só pré-selecionam um item que exista na lista.
  const origemDaUrl = { tipo: params.get('origem_tipo'), id: params.get('origem_id') }
  const [conquistas, setConquistas] = useState(null)     // null = carregando
  const [erroConquistas, setErroConquistas] = useState(null)
  const [conquista, setConquista] = useState(null)       // item escolhido da lista
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
  const liderancaPodeConquista = podeGerirAtividades(status?.papel)
  const alcanceConq = podeComunidade ? alcance : 'clube'
  const carregarConquistas = useCallback(async () => {
    setConquistas(null); setErroConquistas(null); setConquista(null)
    try {
      const lista = await listarConquistasPublicaveis(alcanceConq)
      setConquistas(lista)
      const daUrl = lista.find((c) => c.origem_tipo === origemDaUrl.tipo && c.origem_id === origemDaUrl.id)
      if (daUrl) setConquista(daUrl)
    } catch (e) { setErroConquistas(e) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [alcanceConq])
  useEffect(() => { if (tipo === 'conquista' && liderancaPodeConquista) carregarConquistas() }, [tipo, liderancaPodeConquista, carregarConquistas])
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

  const alcanceEfetivo = podeComunidade ? alcance : 'clube'
  const tipoFinal = tipo === 'foto' ? (foto ? 'foto' : 'livre') : tipo
  const pronto = !enviando && !preparando && texto.length <= MAX && (
    tipo === 'conquista' ? liderancaPodeConquista && !!conquista
      : tipo === 'foto' ? (!!foto || !!texto.trim())
        : tipo === 'desafio' ? !!desafioId && (!!foto || !!texto.trim())
          : tipo === 'foto_clube' ? !!foto && !!alt.trim()
            : (!!foto || !!texto.trim()))

  function escolherAlcance(a) {
    setAlcance(a)
    // Comunidade só aceita os tipos novos: um tipo antigo volta para "Atividade"
    if (a === 'comunidade' && !TIPOS_NOVOS.some(([c]) => c === tipo) && tipo !== 'conquista') setTipo('atividade')
  }

  async function publicar() {
    if (!pronto) return
    if (!(await avisar.confirmar(confirmacaoDePublicar(alcanceEfetivo)))) return
    setEnviando(true); setRecusa('')
    try {
      const r = tipo === 'conquista'
        ? await publicarConquista({ origemTipo: conquista.origem_tipo, origemId: conquista.origem_id, alcance: alcanceEfetivo })
        : await publicarNaRede({ tipo: tipoFinal, legenda: texto.trim(), foto, alt: alt.trim(), desafioId, alcance: alcanceEfetivo, clubeId, userId: profile?.id })
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
      <div className="sticky top-[calc(3.5rem+var(--seguro-topo))] z-20 px-2 py-1.5 bg-[var(--rede-bg)] border-b border-[var(--rede-linha)] flex items-center justify-between gap-2">
        <button type="button" onClick={() => navigate(-1)} aria-label="Voltar à tela anterior" className={`min-h-[44px] min-w-[44px] rounded-full grid place-items-center ${TXT}`}>
          <Icone nome="voltar" />
        </button>
        <h1 className={`font-bold text-[17px] ${TXT}`}>Nova publicação</h1>
        {tipo === 'conquista'
          ? <span className="min-w-[44px]" aria-hidden="true" />   // na conquista o "Publicar" fica no preview seguro
          : <button type="button" onClick={publicar} disabled={!pronto} className={PILL_PRIMARIA}>{enviando ? 'Publicando…' : 'Publicar'}</button>}
      </div>

      {podeComunidade && (
        <fieldset className="mx-3 mt-3">
          <legend className={`text-sm font-bold ${TXT} mb-1`}>Quem vai ver?</legend>
          <div role="radiogroup" aria-label="Alcance da publicação" className="grid grid-cols-2 gap-2">
            {ALCANCES.map(([chave, rotulo]) => (
              <button key={chave} type="button" role="radio" aria-checked={alcance === chave} onClick={() => escolherAlcance(chave)}
                className={`min-h-[56px] rounded-2xl px-2 text-sm font-semibold leading-tight ${alcance === chave ? 'bg-[var(--rede-acao-suave)] text-[var(--rede-acao)] ring-2 ring-[var(--rede-acao)]' : `bg-[var(--rede-superficie)] ${TXT}`}`}>
                {rotulo}
              </button>
            ))}
          </div>
          {alcance === 'comunidade' && (
            <p role="note" className="mt-2 text-xs font-semibold text-amber-900 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
              Atenção: esta publicação fica visível para todos os clubes da Rede DBV.
            </p>
          )}
        </fieldset>
      )}

      {tipo !== 'conquista' && (
        <div role="tablist" aria-label="Tipo de publicação" className="grid grid-cols-3 gap-2 m-3">
          {tiposDoAlcance(alcanceEfetivo).map(([chave, rotulo, icone]) => (
            // ícone EM CIMA e nome embaixo, centralizados (lado a lado não cabia em 375 px)
            <button key={chave} type="button" role="tab" aria-selected={tipo === chave} onClick={() => setTipo(chave)}
              className={`flex min-h-[64px] flex-col items-center justify-center gap-1 rounded-2xl px-1 text-xs font-semibold ${tipo === chave ? 'bg-[var(--rede-acao-suave)] text-[var(--rede-acao)] ring-2 ring-[var(--rede-acao)]' : `bg-[var(--rede-superficie)] ${TXT}`}`}>
              <Icone nome={icone} className="block h-6 w-6 shrink-0" />
              <span className="leading-none text-center">{rotulo}</span>
            </button>
          ))}
        </div>
      )}
      {podeComunidade && (
        <div className="mx-3 mb-1 mt-3">
          <button type="button" aria-pressed={tipo === 'conquista'} onClick={() => setTipo(tipo === 'conquista' ? 'atividade' : 'conquista')}
            className={`${PILL} w-full ${tipo === 'conquista' ? 'bg-[var(--rede-destaque-suave)] text-[var(--rede-destaque-texto)] ring-2 ring-[var(--rede-destaque)]' : `bg-[var(--rede-superficie)] ${TXT}`}`}>
            <span aria-hidden="true">🎖️</span> Compartilhar conquista
          </button>
        </div>
      )}

      <div className="px-3 pb-4 space-y-4">
        {tipo === 'desafio' && (
          <div>
            <label htmlFor="rede-desafio" className={`block text-sm font-bold ${TXT} mb-1`}>Qual desafio?</label>
            <select id="rede-desafio" value={desafioId} onChange={(e) => setDesafioId(e.target.value)}
              className={`w-full min-h-[44px] rounded-2xl bg-[var(--rede-superficie)] px-3 text-sm ${TXT}`}>
              <option value="">Escolha um desafio ativo</option>
              {(desafios || []).map((d) => <option key={d.id} value={d.id}>{d.titulo} (+{d.pontos} pts)</option>)}
            </select>
            {desafios && desafios.length === 0 && <p className={`text-xs ${TXT_SUAVE} mt-1`}>Não há desafio aberto agora (ou você já participou de todos).</p>}
          </div>
        )}
        {tipo === 'conquista' && (
          <div data-testid="conquista-origem" className="space-y-3">
            {!liderancaPodeConquista ? (
              <p className={`rounded-2xl bg-[var(--rede-superficie)] p-3 text-sm ${TXT_SUAVE}`}>Só a diretoria e os instrutores compartilham conquistas.</p>
            ) : conquista ? (
              <div className={`${CARD} p-4`}>
                <p className={`text-xs font-semibold ${TXT_SUAVE}`}>Assim vai aparecer ({alcanceEfetivo === 'comunidade' ? 'Comunidade' : 'Meu Clube'})</p>
                <p data-testid="previa-conquista" className={`mt-2 text-[15px] leading-snug whitespace-pre-line ${TXT}`}>{conquista.previa}</p>
                <p className={`mt-2 text-xs ${TXT_SUAVE}`}>O texto é montado pelo sistema a partir do registro real, com o nome reduzido. Não dá para editar nem anexar foto.</p>
                <div className="mt-4 grid grid-cols-2 gap-2">
                  <button type="button" onClick={() => { setConquista(null); setRecusa('') }} disabled={enviando} className={PILL_CLARA}>Voltar</button>
                  <button type="button" onClick={publicar} disabled={!pronto} className={PILL_PRIMARIA}>{enviando ? 'Publicando…' : 'Publicar'}</button>
                </div>
              </div>
            ) : erroConquistas ? (
              <div className="p-4 text-center">
                <p className={TXT}>{textoDoErro(erroConquistas, 'Não consegui carregar as conquistas.')}</p>
                <button type="button" onClick={carregarConquistas} className={`${PILL_CLARA} mt-3`}>Tentar de novo</button>
              </div>
            ) : conquistas === null ? (
              <p role="status" className={`p-4 text-center text-sm ${TXT_SUAVE}`}>Carregando conquistas…</p>
            ) : conquistas.length === 0 ? (
              <div className={`${CARD} p-5 text-center`}>
                <p className={`font-bold ${TXT}`}>Nenhuma conquista para compartilhar ainda</p>
                <p className={`mt-1 text-sm ${TXT_SUAVE}`}>Quando uma classe ou especialidade do seu clube for concluída, ela aparece aqui.</p>
              </div>
            ) : (
              <>
                <p className={`text-sm font-bold ${TXT}`}>Escolha a conquista</p>
                <ul className="space-y-2">
                  {conquistas.map((c) => (
                    <li key={`${c.origem_tipo}:${c.origem_id}`}>
                      <button type="button" onClick={() => { setConquista(c); setRecusa('') }}
                        className={`${CARD} w-full min-h-[56px] px-4 py-3 text-left flex items-center gap-3`}>
                        <span aria-hidden="true" className="text-xl">{c.origem_tipo === 'classe' ? '🎖️' : '🏅'}</span>
                        <span className="min-w-0 flex-1">
                          <span className={`block font-semibold leading-tight ${TXT}`}>{c.titulo}</span>
                          <span className={`block text-xs ${TXT_SUAVE}`}>{c.rotulo}{c.concluida_em ? ` · ${new Date(c.concluida_em).toLocaleDateString('pt-BR')}` : ''}</span>
                        </span>
                        <Icone nome="seta" className="w-5 h-5 -rotate-90 text-[var(--rede-ink-suave)]" />
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        )}

        {tipo !== 'conquista' && (<div>
          <label htmlFor="rede-texto" className={`block text-sm font-bold ${TXT} mb-1`}>
            No que você está pensando?
          </label>
          <textarea id="rede-texto" value={texto} onChange={(e) => setTexto(e.target.value.slice(0, MAX))} maxLength={MAX} rows={4}
            placeholder="Conte como foi a reunião, o acampamento, a especialidade…"
            className={`w-full rounded-2xl bg-[var(--rede-superficie)] px-3 py-2.5 text-sm ${TXT}`} />
          <p className={`text-xs text-right ${texto.length >= MAX ? 'text-amber-700 font-bold' : TXT_SUAVE}`} aria-live="polite">{texto.length}/{MAX}</p>
        </div>)}

        {tipo !== 'conquista' && (
          <div>
            {!foto ? (
              <label htmlFor="rede-foto" className={`flex flex-col items-center justify-center gap-1 min-h-[120px] rounded-3xl border-2 border-dashed border-[var(--rede-linha)] bg-[var(--rede-superficie)] text-sm font-bold ${TXT_SUAVE} cursor-pointer`}>
                <Icone nome="camera" className="w-9 h-9" />
                {preparando ? 'Otimizando a foto…' : `Adicionar foto${tipo === 'foto' ? ' (opcional)' : tipo === 'foto_clube' ? ' do clube' : ''}`}
              </label>
            ) : (
              <div className="relative rounded-2xl overflow-hidden bg-[var(--rede-superficie)]">
                {previa && <img src={previa} alt="Prévia da foto" className="block w-full h-auto" />}
                <button type="button" onClick={tirarFoto} className={`${PILL} absolute top-2 right-2 bg-[var(--rede-bg)]/90 ${TXT}`}>Trocar</button>
              </div>
            )}
            <input ref={input} id="rede-foto" type="file" accept="image/*" className="sr-only" onChange={escolherFoto} />
            {foto && (
              <>
                <p className={`text-xs ${TXT_SUAVE} mt-2`} data-testid="tamanho-foto">Foto otimizada: {tamanhoLegivel(foto.antes)} → {tamanhoLegivel(foto.depois)}</p>
                <label htmlFor="rede-alt" className={`block text-sm font-bold ${TXT} mt-3 mb-1`}>Descrição da imagem (para quem não consegue ver){tipo === 'foto_clube' ? ' *' : ''}</label>
                <input id="rede-alt" value={alt} onChange={(e) => setAlt(e.target.value.slice(0, 200))} maxLength={200}
                  required={tipo === 'foto_clube'} aria-required={tipo === 'foto_clube'}
                  placeholder={PLACEHOLDER_ALT[tipo] || 'Ex.: minha unidade montando a barraca'}
                  className={`w-full min-h-[44px] rounded-2xl bg-[var(--rede-superficie)] px-3 text-sm ${TXT}`} />
              </>
            )}
          </div>
        )}

        <p className="text-sm font-bold text-[var(--rede-sucesso)] bg-[var(--rede-sucesso-suave)] rounded-xl px-3 py-2">✅ Localização removida da foto automaticamente</p>
        <p className={`text-xs ${TXT_SUAVE}`}>Não mostre documento, endereço, escola ou nome completo. Nada de telefone, @ ou links.</p>
        {recusa && <p role="alert" className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-2xl p-3">{recusa}</p>}
      </div>
    </div>
  )
}
