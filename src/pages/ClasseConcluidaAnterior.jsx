import { useCallback, useEffect, useMemo, useState } from 'react'
import { useClube } from '../context/Clube.jsx'
import { membrosDoClube } from '../services/membros.js'
import {
  carregarClassesOficiais, carregarConclusoesDoMembro, registrarClasseAnterior,
  revogarRegistroAnterior, urlComprovanteAnterior,
} from '../services/classesAnteriores.js'
import {
  IMPACTO_REGISTRO, MAX_OBSERVACAO, fmtDataBR, hojeISO, mensagemRegistro, podeRegistrarClasseAnterior,
  rotuloData, rotuloOrigem, validarMotivo, validarRegistro,
} from '../lib/classeAnterior.js'
import { Cabecalho, Botao, Aviso, Carregando, Vazio, Card, ZonaUpload } from '../ui/index.jsx'

// Registrar classe já concluída (migration 521). Fluxo da liderança (diretoria|instrutor):
// membro -> classe -> data/observação/comprovante -> CONFIRMAÇÃO -> pronto. O servidor é a autoridade.
const CAMPO = 'w-full min-h-[44px] rounded-xl border border-line bg-surface px-3 py-2.5 text-base text-ink focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand'
const ROTULO = 'block text-sm font-semibold text-muted mb-1'

export default function ClasseConcluidaAnterior() {
  const { papel, clubeId } = useClube()
  const pode = podeRegistrarClasseAnterior(papel)
  const [membros, setMembros] = useState(null)
  const [erroLista, setErroLista] = useState('')
  const [busca, setBusca] = useState('')
  const [membro, setMembro] = useState(null)

  useEffect(() => {
    if (!pode) return undefined
    let vivo = true
    membrosDoClube()
      .then((l) => { if (vivo) setMembros(l.filter((m) => !m.teste && m.papel !== 'pais')) })
      .catch((e) => { if (vivo) { setErroLista(mensagemRegistro(e)); setMembros([]) } })
    return () => { vivo = false }
  }, [pode])

  if (!pode) {
    return (
      <div className="max-w-2xl mx-auto">
        <Vazio icone="🔒" titulo="Só a liderança">Apenas a diretoria e os instrutores registram classes já concluídas.</Vazio>
      </div>
    )
  }

  const filtrados = (membros || []).filter((m) => !busca.trim() || (m.nome || '').toLowerCase().includes(busca.trim().toLowerCase()))

  return (
    <div className="max-w-2xl mx-auto">
      <Cabecalho icone="🎖️" titulo="Classes já concluídas" descricao="Registre a classe que o membro concluiu antes de usar o app" />
      {membro ? (
        <PainelDoMembro membro={membro} clubeId={clubeId} aoTrocar={() => setMembro(null)} />
      ) : (
        <section aria-labelledby="t-escolher-membro">
          <h2 id="t-escolher-membro" className="text-sm font-extrabold text-ink mb-2">1. Escolha o membro</h2>
          {erroLista && <Aviso tom="erro" titulo="Não deu pra ver os membros">{erroLista}</Aviso>}
          <label htmlFor="busca-membro" className={ROTULO}>Buscar pelo nome</label>
          <input id="busca-membro" type="search" value={busca} onChange={(e) => setBusca(e.target.value)}
            placeholder="Digite o nome" className={`${CAMPO} mb-3`} autoComplete="off" />
          {membros === null ? <Carregando linhas={3} texto="Carregando os membros" />
            : filtrados.length === 0 ? <Vazio icone="🔎" titulo="Ninguém encontrado">Confira o nome e tente de novo.</Vazio>
            : (
              <ul className="space-y-2">
                {filtrados.map((m) => (
                  <li key={m.id}>
                    <button type="button" onClick={() => setMembro(m)}
                      className="w-full min-h-[44px] text-left bg-surface rounded-2xl p-3 shadow-soft font-bold text-ink text-base">
                      {m.nome}
                      {m.papel && <span className="block text-xs font-normal text-faint">{m.papel}</span>}
                    </button>
                  </li>
                ))}
              </ul>
            )}
        </section>
      )}
    </div>
  )
}

// Conclusões do membro + o botão que abre o assistente de registro.
export function PainelDoMembro({ membro, clubeId, aoTrocar }) {
  const [dados, setDados] = useState(null)
  const [erro, setErro] = useState('')
  const [registrando, setRegistrando] = useState(false)
  const [pronto, setPronto] = useState('')

  const carregar = useCallback(async () => {
    setErro('')
    try { setDados(await carregarConclusoesDoMembro(membro.id)) } catch (e) { setErro(mensagemRegistro(e)); setDados({ disponivel: true, itens: [] }) }
  }, [membro.id])
  useEffect(() => { carregar() }, [carregar])

  if (registrando) {
    return (
      <AssistenteRegistro membro={membro} clubeId={clubeId}
        aoVoltar={() => setRegistrando(false)}
        aoConcluir={(texto) => { setRegistrando(false); setPronto(texto); carregar() }} />
    )
  }

  return (
    <section aria-labelledby="t-membro">
      <div className="flex items-center justify-between gap-2 mb-3">
        <h2 id="t-membro" className="text-base font-extrabold text-ink min-w-0 truncate">{membro.nome}</h2>
        <Botao variacao="contorno" aoTocar={aoTrocar}>Trocar membro</Botao>
      </div>
      {pronto && <div className="mb-3"><Aviso tom="ok" titulo="Registro feito">{pronto}</Aviso></div>}
      {erro && <div className="mb-3"><Aviso tom="erro" titulo="Não deu pra ver as conclusões">{erro}</Aviso></div>}
      {dados === null ? <Carregando linhas={2} texto="Carregando as classes concluídas" />
        : !dados.disponivel ? (
          <Aviso tom="info" titulo="Ainda não disponível">Este recurso ainda não está disponível neste ambiente.</Aviso>
        ) : (
          <>
            <Botao aoTocar={() => { setPronto(''); setRegistrando(true) }} className="w-full mb-4">
              Registrar classe já concluída
            </Botao>
            <ConclusoesDoMembro itens={dados.itens} aoMudar={carregar} />
          </>
        )}
    </section>
  )
}

// Lista por origem. Revogadas ficam discretas, com o motivo; nada é apagado.
export function ConclusoesDoMembro({ itens, aoMudar }) {
  const lista = Array.isArray(itens) ? itens : []
  const ativas = lista.filter((c) => !c.revogada_em && (!c.status || c.status === 'ativa'))
  const revogadas = lista.filter((c) => !ativas.includes(c))
  if (lista.length === 0) {
    return <Vazio icone="🎖️" titulo="Nenhuma classe concluída registrada">As classes concluídas aparecem aqui, com a origem de cada uma.</Vazio>
  }
  return (
    <div className="space-y-4">
      <ul className="space-y-2" aria-label="Classes concluídas">
        {ativas.map((c) => <ItemConclusao key={c.achievement_id || c.class_id} c={c} aoMudar={aoMudar} />)}
      </ul>
      {revogadas.length > 0 && (
        <section aria-labelledby="t-corrigidos">
          <h3 id="t-corrigidos" className="text-xs font-extrabold uppercase tracking-wide text-faint">Registros corrigidos</h3>
          <ul className="mt-1 space-y-1">
            {revogadas.map((c) => (
              <li key={c.achievement_id || c.class_id} className="rounded-xl border border-line p-2 text-xs text-faint" data-testid="registro-corrigido">
                <span className="font-semibold">{c.nome}</span> · corrigido{c.revogada_em ? ` em ${fmtDataBR(c.revogada_em)}` : ''}
                {c.revogada_motivo && <> · Motivo: {c.revogada_motivo}</>}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}

function ItemConclusao({ c, aoMudar }) {
  const [corrigindo, setCorrigindo] = useState(false)
  const [comprovanteErro, setComprovanteErro] = useState('')
  async function verComprovante() {
    setComprovanteErro('')
    try {
      const url = await urlComprovanteAnterior(c.comprovante_path)
      if (url) window.open(url, '_blank', 'noopener')
    } catch { setComprovanteErro('Não consegui abrir o comprovante agora.') }
  }
  return (
    <li className="bg-surface rounded-2xl p-3 shadow-soft" data-testid="conclusao-item">
      <div className="font-bold text-ink text-base leading-tight"><span aria-hidden="true">✓ </span>{c.nome}{c.avancada ? ' (avançada)' : ''}</div>
      <div className="text-sm text-muted">{rotuloOrigem(c)}</div>
      <div className="text-sm text-muted">{rotuloData(c)}</div>
      {c.observacao && <div className="text-sm text-muted mt-1">Observação: {c.observacao}</div>}
      {c.tem_comprovante && c.comprovante_path && (
        <button type="button" onClick={verComprovante} className="mt-1 min-h-[44px] text-sm font-bold text-brand underline">Ver comprovante</button>
      )}
      {comprovanteErro && <p role="alert" className="text-xs text-rose-600">{comprovanteErro}</p>}
      {c.pode_revogar && !corrigindo && (
        <div className="mt-1">
          <Botao variacao="contorno" aoTocar={() => setCorrigindo(true)}>Corrigir registro</Botao>
        </div>
      )}
      {corrigindo && <CorrigirRegistro c={c} aoCancelar={() => setCorrigindo(false)} aoCorrigir={() => { setCorrigindo(false); aoMudar?.() }} />}
    </li>
  )
}

function CorrigirRegistro({ c, aoCancelar, aoCorrigir }) {
  const [motivo, setMotivo] = useState('')
  const [erro, setErro] = useState('')
  const [enviando, setEnviando] = useState(false)
  async function confirmar() {
    const e = validarMotivo(motivo)
    if (e) { setErro(e); return }
    setEnviando(true); setErro('')
    try { await revogarRegistroAnterior(c.achievement_id, motivo); aoCorrigir() } catch (ex) { setErro(mensagemRegistro(ex)); setEnviando(false) }
  }
  const id = `motivo-${c.achievement_id}`
  return (
    <div className="mt-2 rounded-xl border border-amber-200 bg-amber-50 p-3">
      <p className="text-sm font-semibold text-amber-900">
        Corrigir o registro de {c.nome}? A classe deixa de contar como concluída. O registro continua no histórico: nada é apagado.
      </p>
      <label htmlFor={id} className={`${ROTULO} mt-2`}>Motivo da correção</label>
      <textarea id={id} rows={3} value={motivo} maxLength={500} onChange={(e) => setMotivo(e.target.value)} className={CAMPO} />
      {erro && <p role="alert" className="text-sm text-rose-600 mt-1">{erro}</p>}
      <div className="mt-2 flex gap-2">
        <Botao carregando={enviando} aoTocar={confirmar}>Confirmar correção</Botao>
        <Botao variacao="contorno" desabilitado={enviando} aoTocar={aoCancelar}>Cancelar</Botao>
      </div>
    </div>
  )
}

// Passos: classe -> dados -> confirmar. "Voltar" anda um passo; no primeiro, sai do assistente.
export function AssistenteRegistro({ membro, clubeId, aoVoltar, aoConcluir }) {
  const [passo, setPasso] = useState('classe')
  const [classes, setClasses] = useState(null)
  const [erroClasses, setErroClasses] = useState('')
  const [classId, setClassId] = useState('')
  const [data, setData] = useState('')
  const [desconhecida, setDesconhecida] = useState(false)
  const [observacao, setObservacao] = useState('')
  const [arquivo, setArquivo] = useState(null)
  const [erros, setErros] = useState({})
  const [erroEnvio, setErroEnvio] = useState('')
  const [enviando, setEnviando] = useState(false)

  useEffect(() => {
    let vivo = true
    carregarClassesOficiais()
      .then((l) => { if (vivo) setClasses(l) })
      .catch((e) => { if (vivo) { setErroClasses(mensagemRegistro(e)); setClasses([]) } })
    return () => { vivo = false }
  }, [])

  const classe = useMemo(() => (classes || []).find((c) => c.id === classId) || null, [classes, classId])
  const regulares = (classes || []).filter((c) => !c.avancada)
  const avancadas = (classes || []).filter((c) => c.avancada)

  function irParaConfirmar() {
    const e = validarRegistro({ classId, data, dataDesconhecida: desconhecida, observacao })
    setErros(e)
    if (Object.keys(e).length === 0) setPasso('confirmar')
  }

  async function confirmar() {
    setEnviando(true); setErroEnvio('')
    try {
      await registrarClasseAnterior({ usuarioId: membro.id, classId, data, dataDesconhecida: desconhecida, observacao, arquivo, clubeId })
      aoConcluir(`${membro.nome} agora consta como quem já concluiu a classe ${classe?.nome || ''}.`.replace(' .', '.'))
    } catch (e) {
      setErroEnvio(mensagemRegistro(e)); setEnviando(false)
    }
  }

  const voltar = () => {
    if (enviando) return
    if (passo === 'confirmar') setPasso('dados')
    else if (passo === 'dados') setPasso('classe')
    else aoVoltar()
  }

  return (
    <section aria-labelledby="t-assistente">
      <h2 id="t-assistente" className="text-base font-extrabold text-ink mb-3">Registrar classe já concluída · {membro.nome}</h2>

      {passo === 'classe' && (
        <div>
          <p className="text-sm font-extrabold text-ink mb-2">2. Escolha a classe</p>
          {erroClasses && <Aviso tom="erro" titulo="Não deu pra ver as classes">{erroClasses}</Aviso>}
          {classes === null ? <Carregando linhas={3} texto="Carregando as classes" /> : (
            <div className="space-y-4">
              <GrupoClasses titulo="Regulares" itens={regulares} classId={classId} aoEscolher={(id) => { setClassId(id); setErros({}) }} />
              <GrupoClasses titulo="Avançadas" itens={avancadas} classId={classId} aoEscolher={(id) => { setClassId(id); setErros({}) }} />
            </div>
          )}
          {erros.classe && <p role="alert" className="text-sm text-rose-600 mt-2">{erros.classe}</p>}
          <div className="mt-4 flex gap-2">
            <Botao variacao="contorno" aoTocar={voltar}>Voltar</Botao>
            <Botao aoTocar={() => { if (!classId) setErros({ classe: 'Escolha a classe.' }); else { setErros({}); setPasso('dados') } }}>Continuar</Botao>
          </div>
        </div>
      )}

      {passo === 'dados' && (
        <div>
          <p className="text-sm font-extrabold text-ink mb-2">3. Data, observação e comprovante · {classe?.nome}</p>
          <label htmlFor="data-conclusao" className={ROTULO}>Data da conclusão</label>
          <input id="data-conclusao" type="date" value={data} max={hojeISO()} disabled={desconhecida}
            onChange={(e) => setData(e.target.value)} aria-invalid={erros.data ? 'true' : undefined} className={CAMPO} />
          {erros.data && <p role="alert" className="text-sm text-rose-600 mt-1">{erros.data}</p>}
          <label className="mt-2 flex min-h-[44px] items-center gap-3 text-base text-ink">
            <input type="checkbox" checked={desconhecida} className="h-6 w-6"
              onChange={(e) => { setDesconhecida(e.target.checked); if (e.target.checked) setData('') }} />
            Não sei a data
          </label>

          <label htmlFor="obs-conclusao" className={`${ROTULO} mt-3`}>De onde vem esta informação? (obrigatório)</label>
          <textarea id="obs-conclusao" rows={3} value={observacao} maxLength={MAX_OBSERVACAO}
            placeholder="Ex.: cartão da classe, conferido pela diretoria"
            onChange={(e) => setObservacao(e.target.value)} aria-invalid={erros.observacao ? 'true' : undefined} className={CAMPO} />
          {erros.observacao && <p role="alert" className="text-sm text-rose-600 mt-1">{erros.observacao}</p>}

          <p className={`${ROTULO} mt-3`}>Comprovante (opcional)</p>
          <ZonaUpload rotulo="Foto do cartão ou certificado" arquivo={arquivo} aoEscolher={setArquivo} aoRemover={() => setArquivo(null)}
            capture="environment" ajuda="Foto do cartão ou certificado" />
          <p className="text-xs text-faint mt-1">
            Só foto (JPG, PNG ou WebP); PDF não é aceito. A foto é reduzida no aparelho, fica guardada em área privada e só a liderança deste clube vê.
          </p>

          <div className="mt-4 flex gap-2">
            <Botao variacao="contorno" aoTocar={voltar}>Voltar</Botao>
            <Botao aoTocar={irParaConfirmar}>Revisar</Botao>
          </div>
        </div>
      )}

      {passo === 'confirmar' && (
        <div>
          <p className="text-sm font-extrabold text-ink mb-2">4. Confirme</p>
          <Card className="p-4">
            <p className="text-base text-ink" data-testid="confirmacao-texto">
              Você está registrando que <strong>{membro.nome}</strong> já concluiu a classe <strong>{classe?.nome}</strong>.
            </p>
            <p className="text-sm text-muted mt-2" data-testid="confirmacao-data">
              {desconhecida ? 'Data da conclusão: desconhecida.' : `Data da conclusão: ${fmtDataBR(data)}.`}
            </p>
            <p className="text-sm text-muted mt-1">Observação: {observacao.trim()}</p>
            <p className="text-sm text-muted mt-1">{arquivo ? 'Comprovante: 1 foto.' : 'Sem comprovante.'}</p>
            <p className="text-sm text-amber-900 bg-amber-50 border border-amber-200 rounded-xl p-3 mt-3" data-testid="confirmacao-impacto">{IMPACTO_REGISTRO}</p>
          </Card>
          {erroEnvio && <div className="mt-3"><Aviso tom="erro" titulo="Não foi registrado">{erroEnvio}</Aviso></div>}
          <div className="mt-4 flex gap-2">
            <Botao variacao="contorno" desabilitado={enviando} aoTocar={voltar}>Voltar</Botao>
            <Botao carregando={enviando} aoTocar={confirmar}>Confirmar registro</Botao>
          </div>
        </div>
      )}
    </section>
  )
}

function GrupoClasses({ titulo, itens, classId, aoEscolher }) {
  if (itens.length === 0) return null
  return (
    <fieldset>
      <legend className="text-xs font-extrabold uppercase tracking-wide text-muted mb-1">{titulo}</legend>
      <div className="space-y-2">
        {itens.map((c) => (
          <label key={c.id} className={`flex min-h-[44px] items-center gap-3 rounded-2xl border p-3 text-base font-semibold text-ink ${classId === c.id ? 'border-brand bg-surface' : 'border-line bg-surface'}`}>
            <input type="radio" name="classe-anterior" value={c.id} checked={classId === c.id} onChange={() => aoEscolher(c.id)} className="h-5 w-5" />
            {c.nome}
          </label>
        ))}
      </div>
    </fieldset>
  )
}
