import { useState, useEffect, useId } from 'react'
import { Link, useNavigate, useLocation } from 'react-router-dom'
import { lerRetorno, limparRetorno, retornoDaUrl } from '../lib/retornoPosLogin.js'
import { m as motion } from 'framer-motion'
import { lerTokenConvite, limparConviteDaUrl } from '../lib/convite.js'
import { clubesDaVitrine } from '../services/vitrine.js'
import Logo from '../components/Logo.jsx'
import { supabase } from '../lib/supabase.js'
import { traduzErro } from '../lib/erros.js'
import { comprimirImagem } from '../lib/imagem.js'
import { validarImagem } from '../lib/upload.js'
import { CARGOS } from '../lib/cargos.js'

const inputClass =
  'w-full rounded-lg border border-line bg-surface2 px-3 py-2.5 text-ink outline-none transition placeholder:text-faint focus:border-brand focus:ring-2 focus:ring-brand/30'

export default function Cadastro() {
  const navigate = useNavigate()
  const { search } = useLocation()
  // veio do link de inscrição de um clube: depois de criar a conta, volta para pedir a entrada nele
  const retorno = retornoDaUrl(search) || lerRetorno()
  // O token vem no fragmento da URL (não vai pro servidor nem pros logs); guardamos em memória e
  // tiramos da barra de endereço.
  // veio do convite de COORDENAÇÃO (distrito/região/associação): não é membro de clube — o formulário
  // não pede função no clube nem fala em aprovação da diretoria.
  const ehCoordenacao = typeof retorno === 'string' && retorno.startsWith('/coordenacao')
  const [convite] = useState(() => lerTokenConvite(window.location))
  useEffect(() => { if (convite) limparConviteDaUrl(window.location, window.history) }, [convite])
  const [form, setForm] = useState({ nome: '', email: '', senha: '', nascimento: '', cargo: 'Desbravador' })
  const [ehPai, setEhPai] = useState(Boolean(convite)) // cadastro de responsável (pai/mãe)
  const [foto, setFoto] = useState(null)
  const [erro, setErro] = useState('')
  const [carregando, setCarregando] = useState(false)
  const [enviado, setEnviado] = useState(false)
  // Cadastro escolhendo o clube (26/09): a lista vem da vitrine pública (só clubes ativos e visíveis).
  // A escolha vira um PEDIDO de entrada pendente — a diretoria do clube aprova. Não aparece quando a
  // pessoa já veio de um link de clube/convite (retorno) nem no cadastro de coordenação.
  const [clubes, setClubes] = useState([])
  const [clube, setClube] = useState('')
  const [clubePedido, setClubePedido] = useState(null)
  const mostrarClubes = !retorno && !convite && !ehCoordenacao
  useEffect(() => {
    if (!mostrarClubes) return undefined
    let vivo = true
    clubesDaVitrine().then((l) => { if (vivo) setClubes(Array.isArray(l) ? l : []) }).catch(() => {})
    return () => { vivo = false }
  }, [mostrarClubes])

  const set = (campo, v) => setForm((f) => ({ ...f, [campo]: v }))

  // A LISTA DE UNIDADES SAIU DAQUI (fase 8.6), e ela era o coração da última suposição de clube
  // único do produto: esta tela lia `unidades` sem sessão, o que só devolvia as do Tenant 001 —
  // então quem se cadastrasse para entrar no clube B escolhia uma unidade do clube A, e o servidor
  // o colocava no clube A.
  //
  // Cadastrar-se agora cria só a conta. A unidade vem depois de a pessoa entrar num clube, e quem
  // a atribui é a liderança, que sabe quem ela é e como as unidades estão organizadas. Pedir isso
  // a um desconhecido num formulário público nunca foi uma escolha informada — era uma lista de
  // nomes para adivinhar.

  async function cadastrar(e) {
    e.preventDefault()
    setErro('')
    setCarregando(true)

    const { data, error } = await supabase.auth.signUp({
      email: form.email,
      password: form.senha,
      options: { data: {
        nome: form.nome,
        tipo: ehPai ? 'pais' : '',
        convite_responsavel: ehPai ? convite : '',
        nascimento: ehPai || ehCoordenacao ? '' : form.nascimento,
        cargo: ehPai ? '' : ehCoordenacao ? 'Coordenação' : form.cargo,
      } },
    })

    if (error) {
      setErro(traduzErro(error.message))
      setCarregando(false)
      return
    }

    // Foto de perfil (opcional): só dá para enviar se o cadastro já criou sessão
    // (confirmação de e-mail desligada). Se falhar, o cadastro segue sem foto.
    try {
      if (foto && data?.session?.user) {
        const uid = data.session.user.id
        await validarImagem(foto) // tipo REAL + tamanho (hardening etapa 2)
        const arquivo = await comprimirImagem(foto, { maxLado: 640 })
        const ext = arquivo.type === 'image/jpeg' ? 'jpg' : (arquivo.name.split('.').pop() || 'jpg').toLowerCase()
        const path = `perfis/${uid}-${Date.now()}.${ext}`
        const { error: upErr } = await supabase.storage.from('imagens').upload(path, arquivo, { upsert: true })
        if (!upErr) {
          const { data: pub } = supabase.storage.from('imagens').getPublicUrl(path)
          await supabase.from('profiles').update({ foto: pub.publicUrl }).eq('id', uid)
        }
      }
    } catch {
      /* foto é opcional: ignora qualquer erro de upload */
    }

    // Veio do link de um clube e a conta já tem sessão: segue direto para o pedido de entrada nele
    // (a pessoa não precisa procurar o link de novo). O pedido nasce PENDENTE — a liderança aprova.
    if (retorno && data?.session) {
      limparRetorno()
      navigate(retorno, { replace: true })
      return
    }
    // Escolheu o clube na lista: já envia o pedido de entrada (pendente) antes de sair.
    if (clube && data?.session) {
      try {
        const { data: r } = await supabase.rpc('entrada_solicitar_clube', { p_slug: clube })
        if (r?.encontrado) setClubePedido(r.clube || clubes.find((c) => c.slug === clube)?.nome || 'o clube')
      } catch { /* pedido não saiu: a pessoa ainda pode entrar com o código do clube */ }
    }
    // Sem link de clube: a conta existe, mas ainda não pertence a clube nenhum.
    await supabase.auth.signOut()
    setEnviado(true)
  }

  // Tela de sucesso
  if (enviado) {
    return (
      <div className="min-h-full flex flex-col items-center justify-center py-8 px-6">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
          className="w-full max-w-sm bg-surface rounded-2xl shadow-soft p-7 text-center">
          <div className="text-5xl mb-3">{ehPai ? '👋' : '✅'}</div>
          <h1 className="text-brand text-lg font-extrabold mb-2">Cadastro {ehPai ? 'criado' : 'enviado'}!</h1>
          <p className="text-muted text-sm mb-5">
            {ehPai && retorno ? (
              <>Pronto! Agora é só <strong>entrar</strong> para concluir o seu <strong>pedido de entrada no clube</strong>. Depois que a liderança aprovar, peça o vínculo com seu filho(a) — a diretoria confirma. 🎉</>
            ) : ehPai ? (
              <>Pronto! Agora é só <strong>entrar</strong> e <strong>pedir o vínculo com seu filho(a)</strong>. A diretoria confirma e você já acompanha tudo. 🎉</>
            ) : retorno ? (
              <>Sua conta está pronta! Agora é só <strong>entrar</strong> para concluir o seu <strong>pedido de entrada no clube</strong> — o link do clube já está guardado. 🎉</>
            ) : clubePedido ? (
              <>Sua conta está pronta e o seu pedido para entrar no <strong>{clubePedido}</strong> foi enviado! 🎉 Agora é só <strong>entrar</strong> e aguardar a <strong>diretoria aprovar</strong>.</>
            ) : (
              /* MUDOU NA 8.6: esta frase dizia "aguardando a aprovação da diretoria" — e agora não
                 há diretoria nenhuma esperando, porque o cadastro não coloca mais ninguém em clube
                 algum. Prometer uma aprovação que nunca vem é pior do que não dizer nada: a pessoa
                 fica esperando em vez de dar o próximo passo, que é entrar num clube. */
              <>Sua conta está pronta! Agora é só <strong>entrar</strong> e usar o <strong>código do seu clube</strong> para pedir a sua vaga. 🎉</>
            )}
          </p>
          <Link to={`/login${retorno ? `?proximo=${encodeURIComponent(retorno)}` : ''}`} className="block w-full rounded-lg bg-gradient-to-r from-brand to-brand2 shadow-glow text-white font-semibold py-2.5">
            {ehPai || retorno ? 'Entrar agora' : 'Voltar para o login'}
          </Link>
        </motion.div>
      </div>
    )
  }

  return (
    <div className="min-h-full flex flex-col items-center py-8 px-6">
      <motion.div initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35, ease: 'easeOut' }}
        className="w-full max-w-sm bg-surface rounded-2xl shadow-soft p-7">
        <div className="flex flex-col items-center mb-5">
          <Logo produto className="w-16 h-16 mb-2" />
          <h1 className="text-brand text-lg font-extrabold">{ehCoordenacao ? 'Criar conta de coordenação' : 'Criar cadastro'}</h1>
          <p className="text-faint text-xs text-center">{ehCoordenacao ? 'Depois de criar a conta você volta direto para aceitar o convite' : 'Preencha seus dados para participar do clube'}</p>
        </div>

        {!convite && !ehCoordenacao && <div className="bg-surface2 rounded-xl p-1 flex mb-4">
          {[[false, '🧒 Sou membro'], [true, '👨‍👩‍👧 Sou responsável']].map(([v, lbl]) => (
            <button type="button" key={String(v)} onClick={() => setEhPai(v)}
              className={`flex-1 rounded-lg py-2 text-sm font-bold transition-colors ${ehPai === v ? 'bg-surface text-brand shadow-soft' : 'text-muted'}`}>
              {lbl}
            </button>
          ))}
        </div>}

        <form onSubmit={cadastrar} className="space-y-3.5">
          <Campo label="Nome completo" type="text" value={form.nome} onChange={(v) => set('nome', v)} placeholder={ehPai ? 'Seu nome (do responsável)' : 'Seu nome'} />
          <div>
            <label htmlFor="cadastro-foto" className="block text-sm font-medium text-ink mb-1">Foto de perfil</label>
            <input id="cadastro-foto" type="file" accept="image/*" onChange={(e) => setFoto(e.target.files?.[0] || null)} className="text-sm w-full text-muted" />
            <p className="text-xs text-faint mt-1">
              {foto ? `Selecionada: ${foto.name}` : 'Ajuda líderes e colegas a te reconhecerem 😊 (opcional)'}
            </p>
          </div>
          <Campo label="E-mail" type="email" value={form.email} onChange={(v) => set('email', v)} placeholder="voce@email.com" />
          <Campo label="Senha (mín. 8, com letras e números)" type="password" value={form.senha} onChange={(v) => set('senha', v)} placeholder="••••••••" />
          {!ehPai && !ehCoordenacao && (
            <>
              <Campo label="Data de nascimento" type="date" value={form.nascimento} onChange={(v) => set('nascimento', v)} />
              <div>
                <label htmlFor="cadastro-cargo" className="block text-sm font-medium text-ink mb-1">Função no clube</label>
                <select id="cadastro-cargo" required className={inputClass} value={form.cargo} onChange={(e) => set('cargo', e.target.value)}>
                  {CARGOS.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              {/* A unidade saiu do cadastro (fase 8.6): ela só existe DENTRO de um clube, e aqui
                  ainda não há clube nenhum. Quem atribui é a liderança, depois que a pessoa entra. */}
            </>
          )}

          {mostrarClubes && !ehPai && clubes.length > 0 && (
            <EscolherClube clubes={clubes} valor={clube} aoEscolher={setClube} />
          )}

          <div className="bg-amber-50 border border-amber-200 text-amber-800 text-xs rounded-lg p-3">
            {ehCoordenacao
              ? <>🧭 Convite de <strong>coordenação</strong>: ao criar a conta, você volta para aceitar o convite e escolher a sua unidade.</>
              : ehPai
              ? <>👨‍👩‍👧 Você entrou pelo convite do clube. Depois de entrar, <strong>peça o vínculo com seu filho(a)</strong>.</>
              : <>⚠️ Seu cadastro passará pela <strong>aprovação da diretoria</strong> antes de liberar o acesso.</>}
          </div>

          {erro && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3">{erro}</div>}

          <motion.button type="submit" disabled={carregando} whileHover={{ scale: carregando ? 1 : 1.02 }} whileTap={{ scale: 0.97 }}
            className="w-full rounded-lg bg-gradient-to-r from-brand to-brand2 text-white font-semibold py-2.5 shadow-glow disabled:opacity-60">
            {carregando ? 'Enviando...' : ehCoordenacao ? 'Criar conta e continuar' : 'Enviar cadastro'}
          </motion.button>
        </form>

        <p className="text-center text-sm mt-4 text-muted">
          Já tem conta?{' '}
          <Link to={`/login${retorno ? `?proximo=${encodeURIComponent(retorno)}` : ''}`} className="text-brand font-semibold hover:underline">Entrar</Link>
        </p>
      </motion.div>
    </div>
  )
}

function Campo({ label, value, onChange, ...props }) {
  const id = useId()
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-ink mb-1">{label}</label>
      <input id={id} {...props} required value={value} onChange={(e) => onChange(e.target.value)} className={inputClass} />
    </div>
  )
}

// Busca do clube por DIGITAÇÃO (ignora acento e maiúscula). Mostra até 6 resultados; tocar escolhe.
const semAcento = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
function EscolherClube({ clubes, valor, aoEscolher }) {
  const [busca, setBusca] = useState('')
  const escolhido = clubes.find((c) => c.slug === valor)
  const termo = semAcento(busca).trim()
  const achados = termo ? clubes.filter((c) => semAcento(`${c.nome} ${c.cidade || ''}`).includes(termo)).slice(0, 6) : []
  return (
    <div>
      <label htmlFor="cadastro-clube" className="block text-sm font-medium text-ink mb-1">Seu clube</label>
      {escolhido ? (
        <div className="flex items-center justify-between gap-2 rounded-lg border border-brand bg-surface2 px-3 py-2.5" data-testid="clube-escolhido">
          <span className="min-w-0 truncate font-semibold text-ink">🏕️ {escolhido.nome}{escolhido.cidade ? ` — ${escolhido.cidade}` : ''}</span>
          <button type="button" onClick={() => { aoEscolher(''); setBusca('') }} className="shrink-0 min-h-[40px] px-2 text-sm font-semibold text-brand">Trocar</button>
        </div>
      ) : (
        <>
          <input id="cadastro-clube" type="search" value={busca} onChange={(e) => setBusca(e.target.value)} autoComplete="off"
            placeholder="Digite o nome do seu clube" className={inputClass} data-testid="cadastro-clube" />
          {termo && (
            <ul className="mt-1 overflow-hidden rounded-lg border border-line bg-surface" role="listbox" aria-label="Clubes encontrados">
              {achados.length === 0
                ? <li className="px-3 py-2.5 text-sm text-muted">Nenhum clube com esse nome. Confira a escrita ou entre depois com o código do clube.</li>
                : achados.map((c) => (
                  <li key={c.slug}>
                    <button type="button" role="option" aria-selected="false" onClick={() => aoEscolher(c.slug)}
                      className="flex w-full min-h-[44px] items-center px-3 text-left text-sm text-ink active:bg-surface2">
                      {c.nome}{c.cidade ? <span className="text-muted">&nbsp;— {c.cidade}</span> : null}
                    </button>
                  </li>
                ))}
            </ul>
          )}
        </>
      )}
      <p className="text-xs text-faint mt-1">A diretoria do clube vai aprovar a sua entrada. Não achou? Deixe em branco e entre depois com o código do clube.</p>
    </div>
  )
}
