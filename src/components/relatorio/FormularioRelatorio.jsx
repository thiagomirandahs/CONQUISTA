// Formulário ÚNICO do relatório estruturado (fase 7): monta a tela a partir do `schema` do requisito.
// Nada de tela por tipo de requisito — o modelo diz quais campos existem; aqui só se apresenta.
//
// Regras que este componente respeita:
//  * o rascunho salva sozinho (debounce), MAS nunca envia: enviar é só o botão "Enviar";
//  * quem decide se o requisito está completo/concluído é o SERVIDOR; a validação daqui (modelo.js) só
//    avisa cedo, em português, perto do campo;
//  * foto/anexo só é obrigatório quando o modelo manda (`min` do campo de anexos);
//  * alvos de toque >= 44 px, campos de 16 px (sem zoom no celular), sem rolagem lateral.
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { validarConteudo, LIMITES } from '../../lib/relatorio/modelo.js'
import { limparConteudo, completarEntradas } from '../../lib/relatorio/conteudo.js'
import Comprovacao from '../Comprovacao.jsx'
import { Aviso, Botao } from '../../ui/index.jsx'
import { textoDoErro } from './mensagens.js'
import { useRascunhoRelatorio, decidirInicio } from './useRascunhoRelatorio.js'
import { ehErroDeRede } from '../../lib/prazo.js'
import ConflitoRascunho from './ConflitoRascunho.jsx'

const juntar = (...c) => c.filter(Boolean).join(' ')
const ENTRADA = 'w-full min-h-[44px] rounded-xl border border-line bg-surface px-3 py-2.5 text-base text-ink focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand disabled:opacity-70'
const hojeISO = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const definir = (obj, chave, valor) => {
  const novo = { ...(obj || {}) }
  if (valor === undefined) delete novo[chave]
  else novo[chave] = valor
  return novo
}

export default function FormularioRelatorio({
  schema, valorInicial, desativado = false, comentarioDevolucao = '',
  onSalvarRascunho, onEnviar, subirAnexo,
  rotuloEnviar = 'Enviar para avaliação', enviarDesativado = false, descricaoEnviarId,
  autosaveMs = 1500, chaveLocal = null, carregarServidor, className,
}) {
  const base = useId()
  const campos = useMemo(() => schema?.campos || [], [schema])
  // abertura: servidor, local (servidor não mudou) ou conflito — decidido uma vez, sem escrever no storage
  const [inicio] = useState(() => decidirInicio({ chaveLocal, valorInicial }))
  const [conteudo, setConteudo] = useState(inicio.conteudo)
  const [anexos, setAnexos] = useState(inicio.anexos)
  const [erros, setErros] = useState([])
  const [enviando, setEnviando] = useState(false)
  const [erroEnvio, setErroEnvio] = useState('')
  const resumoRef = useRef(null)
  const rasc = useRascunhoRelatorio({
    campos, conteudo, anexos, setConteudo, setAnexos, desativado, onSalvarRascunho, autosaveMs, chaveLocal, carregarServidor, inicio,
  })
  const { estado } = rasc

  useEffect(() => { if (erros.length) resumoRef.current?.focus() }, [erros])

  function mudar(chave, valor) {
    setConteudo((c) => definir(c, chave, valor))
    setErros([])
    setErroEnvio('')
  }
  function mudarAnexos(novos) { setAnexos(novos); setErros([]) }

  async function enviar() {
    const pronto = limparConteudo(campos, completarEntradas(campos, conteudo))
    const lista = validarConteudo(schema, pronto, anexos, { envio: true })
    setErros(lista)
    if (lista.length) return
    setEnviando(true); setErroEnvio('')
    rasc.parar()
    try {
      await onEnviar?.(pronto, anexos)
      rasc.aoEnviado() // enviou: o rascunho local (e o backup) já não servem
    } catch (e) {
      rasc.retomar()
      setErroEnvio(textoDoErro(e, 'Não consegui enviar.'))
    } finally {
      setEnviando(false)
    }
  }

  if (!campos.length) return null

  return (
    <form className={juntar('space-y-4', className)} data-testid="formulario-relatorio" noValidate
      onSubmit={(e) => { e.preventDefault(); if (!desativado) enviar() }}>
      {comentarioDevolucao && (
        <Aviso tom="erro" titulo="A liderança pediu correção">
          <p data-testid="comentario-devolucao" className="font-semibold">"{comentarioDevolucao}"</p>
          <p className="mt-1">Ajuste o que foi pedido e envie de novo.</p>
        </Aviso>
      )}

      {rasc.conflito && <ConflitoRascunho conflito={rasc.conflito} aoEscolher={rasc.resolverConflito} />}
      {rasc.encerrado && (
        <Aviso tom="info">
          <p data-testid="aviso-encerrado">Este requisito já foi enviado/aprovado; guardamos uma cópia do seu texto neste aparelho.</p>
        </Aviso>
      )}

      <Campos campos={campos} dados={conteudo} aoMudar={mudar} erros={erros} base={base} desativado={desativado || rasc.encerrado}
        anexosProps={{ anexos, aoMudar: mudarAnexos, subirAnexo, erros }} />

      {erros.length > 0 && (
        <div ref={resumoRef} tabIndex={-1} role="alert" data-testid="erros-formulario"
          className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
          <p className="font-bold">Falta ajeitar {erros.length === 1 ? '1 coisa' : `${erros.length} coisas`} antes de enviar:</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5">{erros.map((e, i) => <li key={i}>{e}</li>)}</ul>
        </div>
      )}
      {erroEnvio && <Aviso tom="erro">{erroEnvio}</Aviso>}

      {!desativado && (
        <div className="space-y-1.5">
          <p role="status" aria-live="polite" data-testid="estado-rascunho" className="min-h-[1.25rem] text-xs text-muted">
            {estado === 'salvando' && 'Salvando...'}
            {estado === 'salvo' && 'Salvo'}
            {estado === 'local' && 'Salvo neste aparelho'}
            {estado === 'erro' && 'Erro ao sincronizar'}
          </p>
          {estado === 'erro' && (
            <div className="flex flex-wrap items-center gap-2 text-sm text-rose-800" data-testid="erro-sincronizar">
              {rasc.motivo && <span>{rasc.motivo}</span>}
              <button type="button" onClick={rasc.tentarDeNovo}
                className="inline-flex min-h-[44px] items-center rounded-xl px-3 font-bold underline">Tentar de novo</button>
            </div>
          )}
          {rasc.temBackup && !rasc.conflito && (
            <button type="button" onClick={rasc.recuperarBackup} data-testid="recuperar-versao"
              className="inline-flex min-h-[44px] items-center text-sm font-semibold text-muted underline">Recuperar a outra versão</button>
          )}
          <Botao tipo="submit" carregando={enviando} desabilitado={enviarDesativado || !!rasc.conflito} aria-describedby={enviarDesativado ? descricaoEnviarId : undefined}
            data-testid="botao-enviar-relatorio" className="w-full">
            {enviarDesativado ? `🔒 ${rotuloEnviar}` : rotuloEnviar}
          </Botao>
        </div>
      )}
    </form>
  )
}

// ---------------------------------------------------------------- campos (recursivo)
const doCampo = (erros, c) => (erros || []).filter((e) => e.includes(c.rotulo || c.chave))

function Campos({ campos, dados, aoMudar, erros, base, desativado, anexosProps }) {
  return campos.map((c) => {
    const id = `${base}-${c.chave}`
    const errosCampo = c.tipo === 'anexos' ? [] : doCampo(erros, c)
    const comum = { c, id, desativado, erros: errosCampo }
    switch (c.tipo) {
      case 'texto_curto': case 'texto_longo': return <CampoTexto key={c.chave} {...comum} valor={dados?.[c.chave]} aoMudar={(v) => aoMudar(c.chave, v)} />
      case 'numero': return <CampoNumero key={c.chave} {...comum} valor={dados?.[c.chave]} aoMudar={(v) => aoMudar(c.chave, v)} />
      case 'data': return <CampoData key={c.chave} {...comum} valor={dados?.[c.chave]} aoMudar={(v) => aoMudar(c.chave, v)} />
      case 'selecao': return <CampoSelecao key={c.chave} {...comum} valor={dados?.[c.chave]} aoMudar={(v) => aoMudar(c.chave, v)} />
      case 'checklist': return <CampoChecklist key={c.chave} {...comum} valor={dados?.[c.chave]} aoMudar={(v) => aoMudar(c.chave, v)} />
      case 'lista': return <CampoLista key={c.chave} {...comum} valor={dados?.[c.chave]} aoMudar={(v) => aoMudar(c.chave, v)} />
      case 'entradas': return <CampoEntradas key={c.chave} {...comum} valor={dados?.[c.chave]} todosErros={erros} base={base} aoMudar={(v) => aoMudar(c.chave, v)} />
      case 'escolha': return <CampoEscolha key={c.chave} {...comum} valor={dados?.[c.chave]} todosErros={erros} base={base} aoMudar={(v) => aoMudar(c.chave, v)} />
      case 'confirmacao': return <CampoConfirmacao key={c.chave} {...comum} valor={dados?.[c.chave]} aoMudar={(v) => aoMudar(c.chave, v)} />
      case 'anexos': return anexosProps ? <CampoAnexos key={c.chave} c={c} id={id} desativado={desativado} {...anexosProps} /> : null
      default: return null
    }
  })
}

const Ajuda = ({ id, children }) => <p id={id} className="mt-1 text-xs text-muted">{children}</p>
const MsgErro = ({ id, erros }) => (erros?.length ? <p id={id} className="mt-1 text-sm font-semibold text-rose-700">{erros.join(' ')}</p> : null)
const Legenda = ({ c, extra }) => (
  <>
    {c.rotulo}
    {c.obrigatorio && <span className="text-rose-700"> *</span>}
    {extra}
  </>
)

function Bloco({ children }) { return <div className="rounded-2xl bg-surface2/60 p-3">{children}</div> }

function CampoTexto({ c, id, valor, aoMudar, desativado, erros }) {
  const longo = c.tipo === 'texto_longo'
  const max = Math.min(c.max ?? (longo ? LIMITES.longo : LIMITES.curto), LIMITES.longoMax)
  const texto = valor ?? ''
  const idAjuda = `${id}-ajuda`
  const Controle = longo ? 'textarea' : 'input'
  return (
    <Bloco>
      <label htmlFor={id} className="block text-sm font-bold text-ink"><Legenda c={c} /></label>
      <Controle id={id} value={texto} maxLength={max} disabled={desativado} rows={longo ? 5 : undefined} type={longo ? undefined : 'text'}
        autoComplete="off" autoCapitalize="sentences" enterKeyHint={longo ? 'enter' : 'next'}
        onChange={(e) => aoMudar(e.target.value)} aria-invalid={erros.length ? 'true' : undefined} aria-describedby={idAjuda}
        className={juntar(ENTRADA, 'mt-1.5', erros.length && 'border-rose-400')} />
      <Ajuda id={idAjuda}>
        <span data-testid={`contagem-${c.chave}`}>{texto.length} de {max} caracteres</span>
        {c.min ? ` · escreva pelo menos ${c.min}` : ''}
      </Ajuda>
      <MsgErro erros={erros} />
    </Bloco>
  )
}

function CampoNumero({ c, id, valor, aoMudar, desativado, erros }) {
  const [texto, setTexto] = useState(valor == null ? '' : String(valor))
  const idAjuda = `${id}-ajuda`
  const dica = [c.min != null && `mínimo ${c.min}`, c.max != null && `máximo ${c.max}`, c.inteiro && 'número inteiro'].filter(Boolean).join(' · ')
  return (
    <Bloco>
      <label htmlFor={id} className="block text-sm font-bold text-ink"><Legenda c={c} extra={c.unidade ? ` (${c.unidade})` : ''} /></label>
      <input id={id} type="number" inputMode={c.inteiro ? 'numeric' : 'decimal'} value={texto} disabled={desativado}
        min={c.min ?? undefined} max={c.max ?? undefined} step={c.inteiro ? 1 : 'any'}
        onChange={(e) => {
          setTexto(e.target.value)
          const n = e.target.value === '' ? undefined : Number(e.target.value)
          aoMudar(n === undefined || Number.isFinite(n) ? n : undefined)
        }}
        aria-invalid={erros.length ? 'true' : undefined} aria-describedby={dica ? idAjuda : undefined}
        className={juntar(ENTRADA, 'mt-1.5', erros.length && 'border-rose-400')} />
      {dica && <Ajuda id={idAjuda}>{dica}</Ajuda>}
      <MsgErro erros={erros} />
    </Bloco>
  )
}

function CampoData({ c, id, valor, aoMudar, desativado, erros }) {
  return (
    <Bloco>
      <label htmlFor={id} className="block text-sm font-bold text-ink"><Legenda c={c} /></label>
      <input id={id} type="date" value={valor ?? ''} disabled={desativado} max={c.nao_futura ? hojeISO() : undefined}
        onChange={(e) => aoMudar(e.target.value || undefined)}
        aria-invalid={erros.length ? 'true' : undefined}
        className={juntar(ENTRADA, 'mt-1.5', erros.length && 'border-rose-400')} />
      {c.nao_futura && <Ajuda>Use a data de hoje ou de antes.</Ajuda>}
      <MsgErro erros={erros} />
    </Bloco>
  )
}

function Opcao({ tipo, nome, marcado, onChange, desativado, children, aviso }) {
  return (
    <label className={juntar('flex min-h-[44px] items-start gap-3 rounded-xl px-2 py-2', desativado ? 'opacity-60' : 'cursor-pointer active:bg-surface2')}>
      <input type={tipo} name={nome} checked={marcado} onChange={onChange} disabled={desativado} className="mt-0.5 h-6 w-6 shrink-0" />
      <span className="text-base text-ink">{children}{aviso && <span className="block text-xs font-semibold text-amber-800">{aviso}</span>}</span>
    </label>
  )
}

function CampoSelecao({ c, id, valor, aoMudar, desativado, erros }) {
  return (
    <Bloco>
      <fieldset aria-invalid={erros.length ? 'true' : undefined} disabled={desativado}>
        <legend className="text-sm font-bold text-ink"><Legenda c={c} /></legend>
        <div className="mt-1">
          {c.opcoes.map((o) => (
            <Opcao key={o.chave} tipo="radio" nome={id} marcado={valor === o.chave} desativado={desativado} onChange={() => aoMudar(o.chave)}>{o.rotulo}</Opcao>
          ))}
        </div>
      </fieldset>
      <MsgErro erros={erros} />
    </Bloco>
  )
}

function CampoChecklist({ c, id, valor, aoMudar, desativado, erros }) {
  const marcados = Object.values(valor || {}).filter((v) => v === true).length
  const cheio = c.max_marcados != null && marcados >= c.max_marcados
  const dica = [c.min_marcados ? `marque pelo menos ${c.min_marcados}` : null, c.max_marcados != null ? `no máximo ${c.max_marcados}` : null].filter(Boolean).join(' · ')
  const idAjuda = `${id}-ajuda`
  return (
    <Bloco>
      <fieldset disabled={desativado} aria-describedby={idAjuda} aria-invalid={erros.length ? 'true' : undefined}>
        <legend className="text-sm font-bold text-ink"><Legenda c={c} /></legend>
        <div className="mt-1">
          {c.itens.map((i) => {
            const on = valor?.[i.chave] === true
            return (
              <Opcao key={i.chave} tipo="checkbox" nome={`${id}-${i.chave}`} marcado={on} desativado={desativado || (cheio && !on)}
                onChange={(e) => aoMudar({ ...(valor || {}), [i.chave]: e.target.checked })}>
                {i.rotulo}{i.obrigatorio && <span className="text-rose-700"> *</span>}
              </Opcao>
            )
          })}
        </div>
      </fieldset>
      <Ajuda id={idAjuda}><span data-testid={`marcados-${c.chave}`}>{marcados} marcado{marcados === 1 ? '' : 's'}</span>{dica ? ` · ${dica}` : ''}</Ajuda>
      <MsgErro erros={erros} />
    </Bloco>
  )
}

function CampoLista({ c, id, valor, aoMudar, desativado, erros }) {
  const itens = Array.isArray(valor) ? valor : []
  const minimo = Math.max(c.min || 0, 1)
  const max = c.max ?? LIMITES.lista
  const linhas = Array.from({ length: Math.max(itens.length, minimo) }, (_, i) => itens[i] ?? '')
  const rot = c.rotulo_item || 'Item'
  const longo = c.tipo_item === 'texto_longo'
  const limite = longo ? LIMITES.longo : LIMITES.curto
  const Controle = longo ? 'textarea' : 'input'
  const trocar = (i, v) => aoMudar(linhas.map((x, j) => (j === i ? v : x)))
  return (
    <Bloco>
      <fieldset disabled={desativado} aria-invalid={erros.length ? 'true' : undefined}>
        <legend className="text-sm font-bold text-ink"><Legenda c={c} /></legend>
        <ul className="mt-1.5 space-y-2">
          {linhas.map((v, i) => (
            <li key={i} className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <label htmlFor={`${id}-${i}`} className="sr-only">{rot} {i + 1}</label>
                <Controle id={`${id}-${i}`} value={v} maxLength={limite} rows={longo ? 3 : undefined} type={longo ? undefined : 'text'}
                  placeholder={`${rot} ${i + 1}`} autoComplete="off" autoCapitalize="sentences" enterKeyHint="next" onChange={(e) => trocar(i, e.target.value)} className={ENTRADA} />
              </div>
              {linhas.length > minimo && !desativado && (
                <button type="button" onClick={() => aoMudar(linhas.filter((_, j) => j !== i))} aria-label={`Remover ${rot} ${i + 1}`}
                  className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl text-sm font-bold text-rose-700 active:bg-rose-50">✕</button>
              )}
            </li>
          ))}
        </ul>
        {!desativado && linhas.length < max && (
          <button type="button" onClick={() => aoMudar([...linhas, ''])}
            className="mt-2 inline-flex min-h-[44px] w-full items-center justify-center rounded-xl border-2 border-dashed border-line px-4 text-sm font-bold text-ink active:bg-surface2">
            + Adicionar item
          </button>
        )}
      </fieldset>
      <MsgErro erros={erros} />
    </Bloco>
  )
}

function CampoEntradas({ c, id, valor, aoMudar, desativado, erros, todosErros, base }) {
  const lista = Array.isArray(valor) ? valor : []
  const n = Math.max(lista.length, c.min)
  const linhas = Array.from({ length: n }, (_, i) => lista[i] || {})
  const rot = c.rotulo_item || 'Item'
  const escrever = (i, chave, v) => aoMudar(linhas.map((e, j) => (j === i ? definir(e, chave, v) : e)))
  return (
    <section aria-labelledby={`${id}-t`} className="space-y-2">
      <h4 id={`${id}-t`} className="text-sm font-extrabold text-ink"><Legenda c={c} /></h4>
      {linhas.map((e, i) => {
        const prefixo = `${rot} ${i + 1}: `
        const meus = (todosErros || []).filter((x) => x.startsWith(prefixo)).map((x) => x.slice(prefixo.length))
        return (
          <fieldset key={i} disabled={desativado} data-testid={`entrada-${c.chave}`} className="space-y-2 rounded-2xl border-2 border-line p-3">
            <legend className="px-1 text-sm font-extrabold text-brand">{rot} {i + 1}</legend>
            <Campos campos={c.campos} dados={e} aoMudar={(chave, v) => escrever(i, chave, v)} erros={meus} base={`${base}-${c.chave}-${i}`} desativado={desativado} />
            {!desativado && n > c.min && i === n - 1 && (
              <button type="button" onClick={() => aoMudar(linhas.slice(0, -1))}
                className="min-h-[44px] w-full rounded-xl text-sm font-bold text-rose-700 active:bg-rose-50">Remover {rot} {i + 1}</button>
            )}
          </fieldset>
        )
      })}
      {!desativado && n < c.max && (
        <button type="button" onClick={() => aoMudar([...linhas, {}])}
          className="min-h-[44px] w-full rounded-xl border-2 border-dashed border-line px-4 text-sm font-bold text-ink active:bg-surface2">
          + Adicionar {rot.toLowerCase()}
        </button>
      )}
      <MsgErro erros={erros} />
    </section>
  )
}

function CampoEscolha({ c, id, valor, aoMudar, desativado, erros, todosErros, base }) {
  const atual = c.opcoes.find((o) => o.chave === valor?.opcao)
  const dados = valor?.dados || {}
  const prefixo = atual ? `${atual.rotulo}: ` : ''
  const meus = atual ? (todosErros || []).filter((x) => x.startsWith(prefixo)).map((x) => x.slice(prefixo.length)) : []
  return (
    <Bloco>
      <fieldset disabled={desativado} aria-invalid={erros.length ? 'true' : undefined}>
        <legend className="text-sm font-bold text-ink"><Legenda c={c} /></legend>
        <div className="mt-1">
          {c.opcoes.map((o) => (
            <Opcao key={o.chave} tipo="radio" nome={id} marcado={valor?.opcao === o.chave} desativado={desativado || !!o.pendente}
              aviso={o.pendente ? 'Decisão pendente: esta opção ainda não está disponível.' : undefined}
              onChange={() => { if (valor?.opcao !== o.chave) aoMudar({ opcao: o.chave, dados: {} }) }}>{o.rotulo}</Opcao>
          ))}
        </div>
      </fieldset>
      {atual && (atual.campos || []).length > 0 && (
        <div className="mt-2 space-y-2" data-testid={`escolha-${c.chave}-campos`}>
          <Campos campos={atual.campos} dados={dados} base={`${base}-${c.chave}-${atual.chave}`} desativado={desativado} erros={meus}
            aoMudar={(chave, v) => aoMudar({ opcao: atual.chave, dados: definir(dados, chave, v) })} />
        </div>
      )}
      <MsgErro erros={erros} />
    </Bloco>
  )
}

function CampoConfirmacao({ c, id, valor, aoMudar, desativado, erros }) {
  return (
    <Bloco>
      <label htmlFor={id} className={juntar('flex min-h-[44px] items-start gap-3', desativado ? 'opacity-70' : 'cursor-pointer')}>
        <input id={id} type="checkbox" checked={valor === true} disabled={desativado} onChange={(e) => aoMudar(e.target.checked)}
          aria-invalid={erros.length ? 'true' : undefined} className="mt-0.5 h-6 w-6 shrink-0" />
        <span className="text-base font-bold text-ink"><Legenda c={c} /><span className="block text-xs font-normal text-muted">Marque quando tiver feito.</span></span>
      </label>
      <MsgErro erros={erros} />
    </Bloco>
  )
}

// ---------------------------------------------------------------- anexos (fotos)
function CampoAnexos({ c, id, anexos, aoMudar, subirAnexo, desativado, erros }) {
  const [subindo, setSubindo] = useState(false)
  const [erroSubida, setErroSubida] = useState('')
  const max = c.max ?? LIMITES.anexos
  const cheio = anexos.length >= max
  const idAjuda = `${id}-ajuda`
  const meus = (erros || []).filter((e) => /anexo/i.test(e) || e.includes(c.rotulo))
  const dica = c.min ? `Envie pelo menos ${c.min} (até ${max}).` : `Opcional. Até ${max}.`

  async function escolher(e) {
    const arquivo = e.target.files?.[0]
    e.target.value = ''
    if (!arquivo || !subirAnexo) return
    setSubindo(true); setErroSubida('')
    try {
      const path = await subirAnexo(arquivo, c.chave)
      aoMudar([...anexos, { campo: c.chave, path }])
    } catch (err) {
      setErroSubida(ehErroDeRede(err) || (typeof navigator !== 'undefined' && navigator.onLine === false)
        ? 'Sem internet: não deu para anexar agora; o texto foi guardado neste aparelho.'
        : textoDoErro(err, 'Não consegui enviar a foto.'))
    } finally {
      setSubindo(false)
    }
  }

  return (
    <Bloco>
      <p className="text-sm font-bold text-ink" id={`${id}-t`}><Legenda c={c} /></p>
      <ul className="mt-2 grid grid-cols-2 gap-2" aria-labelledby={`${id}-t`} data-testid="anexos-lista">
        {anexos.map((a, i) => (
          <li key={a.path} className="rounded-xl border border-line bg-surface p-1.5">
            <Comprovacao valor={a.path} alt={`Foto ${i + 1}`} classImg="h-28 w-full rounded-lg object-cover" classVideo="h-28 w-full rounded-lg" />
            {!desativado && (
              <button type="button" onClick={() => aoMudar(anexos.filter((x) => x.path !== a.path))} aria-label={`Remover foto ${i + 1}`}
                className="mt-1 min-h-[44px] w-full rounded-lg text-sm font-bold text-rose-700 active:bg-rose-50">Remover</button>
            )}
          </li>
        ))}
      </ul>
      {!desativado && (
        <label className={juntar('mt-2 flex min-h-[56px] flex-col items-center justify-center gap-0.5 rounded-2xl border-2 border-dashed border-line bg-surface px-4 py-3 text-center',
          cheio || subindo ? 'cursor-not-allowed opacity-60' : 'cursor-pointer active:scale-[0.99]')}>
          <input type="file" accept="image/*" className="sr-only" disabled={cheio || subindo} onChange={escolher} aria-label={`Adicionar foto: ${c.rotulo}`} aria-describedby={idAjuda} />
          <span aria-hidden="true" className="text-2xl">📷</span>
          <span className="text-base font-bold text-ink">{subindo ? 'Enviando…' : cheio ? 'Limite de fotos atingido' : 'Adicionar foto'}</span>
        </label>
      )}
      <Ajuda id={idAjuda}><span data-testid="contagem-anexos">{anexos.length} de {max} foto(s)</span> · {dica}</Ajuda>
      {erroSubida && <p role="alert" className="mt-1 text-sm font-semibold text-rose-700">{erroSubida}</p>}
      <MsgErro erros={meus} />
    </Bloco>
  )
}
