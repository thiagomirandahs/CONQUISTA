import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { lerTokenConvite, limparConviteDaUrl } from '../lib/convite.js'
import Logo from '../components/Logo.jsx'
import { supabase } from '../lib/supabase.js'
import { traduzErro } from '../lib/erros.js'
import { comprimirImagem } from '../lib/imagem.js'
import { validarImagem } from '../lib/upload.js'
import { CARGOS } from '../lib/cargos.js'

const inputClass =
  'w-full rounded-lg border border-line bg-surface2 px-3 py-2.5 text-ink outline-none transition placeholder:text-faint focus:border-brand focus:ring-2 focus:ring-brand/30'

export default function Cadastro() {
  // O token vem no fragmento da URL (não vai pro servidor nem pros logs); guardamos em memória e
  // tiramos da barra de endereço.
  const [convite] = useState(() => lerTokenConvite(window.location))
  useEffect(() => { if (convite) limparConviteDaUrl(window.location, window.history) }, [convite])
  const [form, setForm] = useState({ nome: '', email: '', senha: '', nascimento: '', cargo: 'Desbravador' })
  const [ehPai, setEhPai] = useState(Boolean(convite)) // cadastro de responsável (pai/mãe)
  const [foto, setFoto] = useState(null)
  const [erro, setErro] = useState('')
  const [carregando, setCarregando] = useState(false)
  const [enviado, setEnviado] = useState(false)

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
        nascimento: ehPai ? '' : form.nascimento,
        cargo: ehPai ? '' : form.cargo,
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

    // Cadastro fica pendente de aprovação — não deixa o usuário logado.
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
            {ehPai ? (
              <>Pronto! Agora é só <strong>entrar</strong> e <strong>pedir o vínculo com seu filho(a)</strong>. A diretoria confirma e você já acompanha tudo. 🎉</>
            ) : (
              /* MUDOU NA 8.6: esta frase dizia "aguardando a aprovação da diretoria" — e agora não
                 há diretoria nenhuma esperando, porque o cadastro não coloca mais ninguém em clube
                 algum. Prometer uma aprovação que nunca vem é pior do que não dizer nada: a pessoa
                 fica esperando em vez de dar o próximo passo, que é entrar num clube. */
              <>Sua conta está pronta! Agora é só <strong>entrar</strong> e usar o <strong>código do seu clube</strong> para pedir a sua vaga. 🎉</>
            )}
          </p>
          <Link to="/login" className="block w-full rounded-lg bg-gradient-to-r from-brand to-brand2 shadow-glow text-white font-semibold py-2.5">
            {ehPai ? 'Entrar agora' : 'Voltar para o login'}
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
          <Logo className="w-16 h-16 mb-2" />
          <h1 className="text-brand text-lg font-extrabold">Criar cadastro</h1>
          <p className="text-faint text-xs text-center">Preencha seus dados para participar do clube</p>
        </div>

        {!convite && <div className="bg-surface2 rounded-xl p-1 flex mb-4">
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
            <label className="block text-sm font-medium text-ink mb-1">Foto de perfil</label>
            <input type="file" accept="image/*" onChange={(e) => setFoto(e.target.files?.[0] || null)} className="text-sm w-full text-muted" />
            <p className="text-xs text-faint mt-1">
              {foto ? `Selecionada: ${foto.name}` : 'Ajuda líderes e colegas a te reconhecerem 😊 (opcional)'}
            </p>
          </div>
          <Campo label="E-mail" type="email" value={form.email} onChange={(v) => set('email', v)} placeholder="voce@email.com" />
          <Campo label="Senha (mín. 8, com letras e números)" type="password" value={form.senha} onChange={(v) => set('senha', v)} placeholder="••••••••" />
          {!ehPai && (
            <>
              <Campo label="Data de nascimento" type="date" value={form.nascimento} onChange={(v) => set('nascimento', v)} />
              <div>
                <label className="block text-sm font-medium text-ink mb-1">Função no clube</label>
                <select required className={inputClass} value={form.cargo} onChange={(e) => set('cargo', e.target.value)}>
                  {CARGOS.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              {/* A unidade saiu do cadastro (fase 8.6): ela só existe DENTRO de um clube, e aqui
                  ainda não há clube nenhum. Quem atribui é a liderança, depois que a pessoa entra. */}
            </>
          )}

          <div className="bg-amber-50 border border-amber-200 text-amber-800 text-xs rounded-lg p-3">
            {ehPai
              ? <>👨‍👩‍👧 Você entrou pelo convite do clube. Depois de entrar, <strong>peça o vínculo com seu filho(a)</strong>.</>
              : <>⚠️ Seu cadastro passará pela <strong>aprovação da diretoria</strong> antes de liberar o acesso.</>}
          </div>

          {erro && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3">{erro}</div>}

          <motion.button type="submit" disabled={carregando} whileHover={{ scale: carregando ? 1 : 1.02 }} whileTap={{ scale: 0.97 }}
            className="w-full rounded-lg bg-gradient-to-r from-brand to-brand2 text-white font-semibold py-2.5 shadow-glow disabled:opacity-60">
            {carregando ? 'Enviando...' : 'Enviar cadastro'}
          </motion.button>
        </form>

        <p className="text-center text-sm mt-4 text-muted">
          Já tem conta?{' '}
          <Link to="/login" className="text-brand font-semibold hover:underline">Entrar</Link>
        </p>
      </motion.div>
    </div>
  )
}

function Campo({ label, value, onChange, ...props }) {
  return (
    <div>
      <label className="block text-sm font-medium text-ink mb-1">{label}</label>
      <input {...props} required value={value} onChange={(e) => onChange(e.target.value)} className={inputClass} />
    </div>
  )
}
