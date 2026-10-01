import { useCallback, useEffect, useState } from 'react'
import { adminPainel, adminModerar, adminTermos, adminSalvarTermo, adminRemoverTermo, adminFotoUrl, tempoRelativo } from '../services/comunidade.js'
import { avisar } from '../ui/avisos.jsx'
import { Aviso, Botao, Campo, Card, Carregando, Selecao, Selo, mensagemDeErro } from '../ui/index.jsx'
import AdminDesafiosRede from './AdminDesafiosRede.jsx'
import AdminRedeTodosClubes from './AdminRedeTodosClubes.jsx'

// Foto do item: NUNCA carrega sozinha. Cada toque em "Ver foto" pede uma URL de 60 s ao servidor, que confere o contexto
// (Comunidade em análise/denunciada) e registra EXATAMENTE 1 acesso no log da plataforma.
function FotoDoItem({ item }) {
  const [url, setUrl] = useState(null)
  const [abrindo, setAbrindo] = useState(false)
  async function ver() {
    setAbrindo(true)
    try { setUrl(await adminFotoUrl(item.tipo, item.id)) }
    catch (err) { avisar.erro(err, 'Não consegui abrir a foto.') }
    finally { setAbrindo(false) }
  }
  if (url) {
    return (
      <div className="mt-1">
        <img src={url} alt="Foto em análise" className="max-h-64 rounded-lg" onError={() => setUrl(null)} />
        <Botao variacao="discreto" aoTocar={() => setUrl(null)}>Fechar foto</Botao>
      </div>
    )
  }
  return <Botao variacao="discreto" aoTocar={ver} desabilitado={abrindo} data-testid={`ver-foto-${item.id}`}>{abrindo ? 'Abrindo…' : 'Ver foto (fica registrado)'}</Botao>
}

// Admin da PLATAFORMA → Comunidade: números, fila de todos os clubes (primeiro nome + clube), o que a
// triagem bloqueou (dígitos mascarados) e a LISTA DE TERMOS editável. Tudo auditado no servidor.
export default function AdminComunidade() {
  const [painel, setPainel] = useState(null)
  const [termos, setTermos] = useState(null)
  const [erro, setErro] = useState(null)
  const [novo, setNovo] = useState({ termo: '', modo: 'exata', categoria: 'ofensa' })

  const carregar = useCallback(async () => {
    setErro(null)
    try {
      const [p, t] = await Promise.all([adminPainel(), adminTermos()])
      setPainel(p); setTermos(t)
    } catch (e) { setErro(e) }
  }, [])
  useEffect(() => { carregar() }, [carregar])

  async function salvar(e) {
    e.preventDefault()
    if (!novo.termo.trim()) return
    try { setTermos(await adminSalvarTermo({ ...novo, termo: novo.termo.trim() })); setNovo({ ...novo, termo: '' }); avisar.sucesso('Termo salvo.') }
    catch (err) { avisar.erro(err, 'Não consegui salvar o termo.') }
  }
  async function alternar(t) {
    try { setTermos(await adminSalvarTermo({ ...t, ativo: !t.ativo })) } catch (err) { avisar.erro(err, 'Não consegui alterar.') }
  }
  async function remover(t) {
    if (!(await avisar.confirmar({ titulo: `Remover "${t.termo}"?`, rotulo: 'Remover' }))) return
    try { setTermos(await adminRemoverTermo(t.id)) } catch (err) { avisar.erro(err, 'Não consegui remover.') }
  }
  async function decidir(i, acao) {
    try { await adminModerar(i.tipo, i.id, acao); avisar.sucesso('Decisão registrada.'); carregar() }
    catch (err) { avisar.erro(err, 'Não consegui registrar.') }
  }

  if (erro) return <Aviso tom="erro">{mensagemDeErro(erro, 'Não consegui abrir a Comunidade.')}</Aviso>
  if (!painel || !termos) return <Carregando />

  const fila = [...(painel.fila?.denuncias || []), ...(painel.fila?.fotos || [])]
  return (
    <div className="space-y-4">
      <AdminRedeTodosClubes onFeito={carregar} />
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {[['Clubes com a Comunidade', painel.clubes_com_recurso], ['Denúncias pendentes', painel.denuncias_pendentes],
          ['Bloqueios (7 dias)', painel.bloqueios_7d], ['Pausados', painel.suspensos]].map(([r, v]) => (
          <Card key={r} className="text-center"><p className="text-2xl font-extrabold text-ink">{v ?? 0}</p><p className="text-xs text-muted">{r}</p></Card>
        ))}
      </div>

      <AdminDesafiosRede />

      <Card>
        <h3 className="font-extrabold text-ink mb-2">Fila de todos os clubes</h3>
        {fila.length === 0 ? <p className="text-sm text-faint">Nada pendente.</p> : (
          <ul className="divide-y divide-line">
            {fila.map((i) => (
              <li key={`${i.tipo}-${i.id}`} className="py-2">
                <p className="text-sm"><span className="font-bold text-ink">{i.autor}</span> <span className="text-muted">· {i.clube} · {tempoRelativo(i.criado_em)}</span></p>
                {i.texto && <p className="text-sm text-ink break-words">{i.texto}</p>}
                {i.denuncias > 0 && <Selo tom="perigo">🚩 {i.denuncias}</Selo>} {i.status === 'em_analise' && <Selo tom="atencao">Foto em análise</Selo>}
                {i.foto && (i.tipo === 'post' || i.tipo === 'story') && <FotoDoItem item={i} />}
                <div className="flex gap-2 mt-1">
                  {i.status === 'em_analise'
                    ? <><Botao variacao="secundario" aoTocar={() => decidir(i, 'aprovar_foto')}>Aprovar</Botao><Botao variacao="perigo" aoTocar={() => decidir(i, 'recusar_foto')}>Recusar</Botao></>
                    : <><Botao variacao="secundario" aoTocar={() => decidir(i, 'restaurar')}>Restaurar</Botao><Botao variacao="perigo" aoTocar={() => decidir(i, 'remover')}>Remover</Botao></>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <h3 className="font-extrabold text-ink mb-1">Lista de termos da triagem</h3>
        <p className="text-xs text-muted mb-3">Acentos, números no lugar de letras, letras repetidas e letras separadas são normalizados no servidor. "Radical" pega palavras que começam com o termo.</p>
        <form onSubmit={salvar} className="grid sm:grid-cols-4 gap-2 items-end">
          <Campo id="adm-termo" rotulo="Termo" value={novo.termo} onChange={(e) => setNovo({ ...novo, termo: e.target.value })} maxLength={60} />
          <Selecao id="adm-modo" rotulo="Modo" value={novo.modo} onChange={(e) => setNovo({ ...novo, modo: e.target.value })} opcoes={[['exata', 'Palavra/expressão'], ['radical', 'Radical']]} />
          <Selecao id="adm-cat" rotulo="Categoria" value={novo.categoria} onChange={(e) => setNovo({ ...novo, categoria: e.target.value })} opcoes={[['ofensa', 'Ofensa'], ['contato', 'Contato']]} />
          <Botao tipo="submit" className="mb-3">Adicionar</Botao>
        </form>
        <ul className="divide-y divide-line max-h-96 overflow-y-auto">
          {termos.map((t) => (
            <li key={t.id} className="py-1.5 flex items-center gap-2 text-sm">
              <span className={`flex-1 font-mono ${t.ativo ? 'text-ink' : 'text-faint line-through'}`}>{t.termo}</span>
              <Selo tom={t.categoria === 'contato' ? 'info' : 'perigo'}>{t.categoria}</Selo>
              {t.modo === 'radical' && <Selo>radical</Selo>}
              <Botao variacao="discreto" aoTocar={() => alternar(t)}>{t.ativo ? 'Desativar' : 'Ativar'}</Botao>
              <Botao variacao="discreto" aoTocar={() => remover(t)} aria-label={`Remover ${t.termo}`} className="min-w-[44px]">✕</Botao>
            </li>
          ))}
        </ul>
      </Card>

      <Card>
        <h3 className="font-extrabold text-ink mb-2">O que a triagem bloqueou (últimos 50)</h3>
        {(painel.bloqueios || []).length === 0 ? <p className="text-sm text-faint">Nada bloqueado ainda.</p> : (
          <ul className="divide-y divide-line">
            {painel.bloqueios.map((b, i) => (
              <li key={i} className="py-1.5 text-sm">
                <span className="text-muted">{tempoRelativo(b.quando)} · {b.clube} · {b.alvo} · </span>
                <Selo tom={b.motivo === 'contato' ? 'info' : 'perigo'}>{b.regra}</Selo>
                <p className="text-ink break-words">{b.trecho}</p>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}
