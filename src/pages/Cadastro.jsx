import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import Logo from '../components/Logo.jsx'
import { supabase } from '../lib/supabase.js'
import { traduzErro } from '../lib/erros.js'
import { comprimirImagem } from '../lib/imagem.js'
import { CARGOS, precisaUnidade } from '../lib/cargos.js'

const inputClass =
  'w-full rounded-lg border border-slate-300 px-3 py-2.5 text-slate-900 outline-none transition focus:border-azul-claro focus:ring-2 focus:ring-azul-claro/30'

export default function Cadastro() {
  const [unidades, setUnidades] = useState([])
  const [form, setForm] = useState({ nome: '', email: '', senha: '', nascimento: '', unidade_id: '', cargo: 'Desbravador' })
  const [ehPai, setEhPai] = useState(false) // cadastro de responsável (pai/mãe)
  const [foto, setFoto] = useState(null)
  const [erro, setErro] = useState('')
  const [carregando, setCarregando] = useState(false)
  const [enviado, setEnviado] = useState(false)

  const set = (campo, v) => setForm((f) => ({ ...f, [campo]: v }))

  // Carrega as unidades do banco para o desbravador escolher
  useEffect(() => {
    supabase.from('unidades').select('id,nome').order('nome').then(({ data }) => setUnidades(data || []))
  }, [])

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
        nascimento: ehPai ? '' : form.nascimento,
        cargo: ehPai ? '' : form.cargo,
        unidade_id: (!ehPai && precisaUnidade(form.cargo)) ? form.unidade_id : '',
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
        const arquivo = await comprimirImagem(foto, { maxLado: 640 })
        const ext = (arquivo.name.split('.').pop() || 'jpg').toLowerCase()
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
      <div className="min-h-full bg-slate-100 flex flex-col items-center justify-center py-8 px-6">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
          className="w-full max-w-sm bg-white rounded-2xl shadow-xl p-7 text-center">
          <div className="text-5xl mb-3">{ehPai ? '👋' : '✅'}</div>
          <h1 className="text-azul text-lg font-extrabold mb-2">Cadastro {ehPai ? 'criado' : 'enviado'}!</h1>
          <p className="text-slate-600 text-sm mb-5">
            {ehPai ? (
              <>Pronto! Agora é só <strong>entrar</strong> e <strong>pedir o vínculo com seu filho(a)</strong>. A diretoria confirma e você já acompanha tudo. 🎉</>
            ) : (
              <>Seu cadastro foi recebido e está <strong>aguardando a aprovação da diretoria</strong>. Assim que aprovado, você já poderá entrar. 🎉</>
            )}
          </p>
          <Link to="/login" className="block w-full rounded-lg bg-azul text-white font-semibold py-2.5">
            {ehPai ? 'Entrar agora' : 'Voltar para o login'}
          </Link>
        </motion.div>
      </div>
    )
  }

  return (
    <div className="min-h-full bg-slate-100 flex flex-col items-center py-8 px-6">
      <motion.div initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35, ease: 'easeOut' }}
        className="w-full max-w-sm bg-white rounded-2xl shadow-xl p-7">
        <div className="flex flex-col items-center mb-5">
          <Logo className="w-16 h-16 mb-2" />
          <h1 className="text-azul text-lg font-extrabold">Criar cadastro</h1>
          <p className="text-prata text-xs text-center">Preencha seus dados para participar do clube</p>
        </div>

        <div className="bg-slate-100 rounded-xl p-1 flex mb-4">
          {[[false, '🧒 Sou membro'], [true, '👨‍👩‍👧 Sou responsável']].map(([v, lbl]) => (
            <button type="button" key={String(v)} onClick={() => setEhPai(v)}
              className={`flex-1 rounded-lg py-2 text-sm font-bold transition-colors ${ehPai === v ? 'bg-white text-azul shadow-sm' : 'text-slate-500'}`}>
              {lbl}
            </button>
          ))}
        </div>

        <form onSubmit={cadastrar} className="space-y-3.5">
          <Campo label="Nome completo" type="text" value={form.nome} onChange={(v) => set('nome', v)} placeholder={ehPai ? 'Seu nome (do responsável)' : 'Seu nome'} />
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Foto de perfil</label>
            <input type="file" accept="image/*" onChange={(e) => setFoto(e.target.files?.[0] || null)} className="text-sm w-full text-slate-600" />
            <p className="text-[11px] text-slate-400 mt-1">
              {foto ? `Selecionada: ${foto.name}` : 'Ajuda líderes e colegas a te reconhecerem 😊 (opcional)'}
            </p>
          </div>
          <Campo label="E-mail" type="email" value={form.email} onChange={(v) => set('email', v)} placeholder="voce@email.com" />
          <Campo label="Senha (mín. 6 caracteres)" type="password" value={form.senha} onChange={(v) => set('senha', v)} placeholder="••••••••" />
          {!ehPai && (
            <>
              <Campo label="Data de nascimento" type="date" value={form.nascimento} onChange={(v) => set('nascimento', v)} />
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Função no clube</label>
                <select required className={inputClass} value={form.cargo} onChange={(e) => set('cargo', e.target.value)}>
                  {CARGOS.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              {precisaUnidade(form.cargo) && (
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Unidade</label>
                  <select required className={inputClass} value={form.unidade_id} onChange={(e) => set('unidade_id', e.target.value)}>
                    <option value="" disabled>{unidades.length ? 'Escolha sua unidade' : 'Carregando unidades...'}</option>
                    {unidades.map((u) => <option key={u.id} value={u.id}>{u.nome}</option>)}
                  </select>
                </div>
              )}
            </>
          )}

          <div className="bg-amber-50 border border-amber-200 text-amber-800 text-xs rounded-lg p-3">
            {ehPai
              ? <>👨‍👩‍👧 Depois de entrar, você <strong>pede o vínculo com seu filho(a)</strong> e a diretoria confirma.</>
              : <>⚠️ Seu cadastro passará pela <strong>aprovação da diretoria</strong> antes de liberar o acesso.</>}
          </div>

          {erro && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3">{erro}</div>}

          <motion.button type="submit" disabled={carregando} whileHover={{ scale: carregando ? 1 : 1.02 }} whileTap={{ scale: 0.97 }}
            className="w-full rounded-lg bg-azul text-white font-semibold py-2.5 shadow-md disabled:opacity-60">
            {carregando ? 'Enviando...' : 'Enviar cadastro'}
          </motion.button>
        </form>

        <p className="text-center text-sm mt-4 text-slate-600">
          Já tem conta?{' '}
          <Link to="/login" className="text-azul-claro font-semibold hover:underline">Entrar</Link>
        </p>
      </motion.div>
    </div>
  )
}

function Campo({ label, value, onChange, ...props }) {
  return (
    <div>
      <label className="block text-sm font-medium text-slate-700 mb-1">{label}</label>
      <input {...props} required value={value} onChange={(e) => onChange(e.target.value)} className={inputClass} />
    </div>
  )
}
