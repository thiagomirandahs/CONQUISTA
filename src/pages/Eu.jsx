import { marcarInicioDaNavegacao } from '../lib/barreiraDeVoltar.js'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/Auth.jsx'
import { useClube } from '../context/Clube.jsx'
import { useEscopo } from '../context/Escopo.jsx'
import { Card, Selecao } from '../ui/index.jsx'
import { MeusConvites } from '../components/ConvitesDeEquipe.jsx'

// "Eu" (fase 7): identidade, TROCA DE JORNADA e ajustes.
// Aqui mora o que antes estava espalhado: o seletor de clube ficava no fim de uma gaveta com 17
// itens, o portal institucional só existia como card dentro de Gestão, e o onboarding de clube novo
// não tinha NENHUM link no app. Uma pessoa com vários papéis usa a mesma conta e troca de jornada
// por aqui — nunca criando outra conta.
export default function Eu() {
  const { profile, sair } = useAuth()
  const { vinculos, clubeId, trocarClube, marca, papel, temGestao } = useClube()
  const { temEscopo, escopos } = useEscopo()
  const navigate = useNavigate()

  const clubes = (vinculos || []).filter((v) => v.status === 'ativo' && v.selecionavel)
  const nome = profile?.nome || 'Você'
  const iniciais = nome.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase()).join('') || '?'

  async function trocar(e) {
    const r = await trocarClube(e.target.value)
    if (r?.ok) { navigate('/inicio', { replace: true }); marcarInicioDaNavegacao() }
  }

  async function atualizarApp() {
    try {
      const reg = await navigator.serviceWorker?.getRegistration?.()
      if (reg) await reg.update()
    } catch { /* ignora */ }
    window.location.reload()
  }

  // Modo claro/escuro saiu daqui: ele já mora no botão da barra de cima (lua/sol), em toda tela.
  return (
    <div className="max-w-2xl mx-auto space-y-5">
      {/* ---- identidade ---- */}
      <section className="flex items-center gap-3 pt-1">
        {profile?.foto
          ? <img src={profile.foto} alt="" className="h-14 w-14 shrink-0 rounded-full object-cover ring-2 ring-line" />
          : <span aria-hidden="true" className="grid h-14 w-14 shrink-0 place-items-center rounded-full bg-surface2 text-lg font-extrabold text-muted ring-2 ring-line">{iniciais}</span>}
        <div className="min-w-0">
          <h1 className="text-lg font-extrabold leading-tight text-ink">{nome}</h1>
          <p className="text-sm text-muted truncate">
            <span className="mr-1.5 inline-block rounded-full bg-surface2 px-2 py-0.5 text-xs font-semibold text-ink">{rotuloPapel(papel)}</span>
            {marca?.nome || 'seu clube'}
          </p>
        </div>
      </section>

      <Grupo titulo="Conta">
        <ItemLink para="/perfil" icone="🪪" titulo="Meu perfil" desc="Foto, avatar e seus dados" />
      </Grupo>

      {(temGestao || temEscopo) && (
        <Grupo titulo="Clube">
          {temGestao && <ItemLink para="/clube" icone="🎨" titulo="Configurações do clube" desc="Identidade, recursos e plano" />}
          {temEscopo && (
            <ItemLink para="/institucional" icone="🏛️" titulo="Portal institucional" testid="ir-portal"
              desc={escopos.length === 1 ? escopos[0].nome : `${escopos.length} escopos`} />
          )}
        </Grupo>
      )}

      {/* ---- convites recebidos: é por aqui que uma pessoa entra num SEGUNDO clube ---- */}
      <MeusConvites />

      {clubes.length > 1 && (
        <section aria-labelledby="t-jornadas">
          <h2 id="t-jornadas" className="mb-1.5 px-1 text-xs font-bold uppercase tracking-wide text-faint">Trocar de clube</h2>
          <Card>
            <Selecao id="eu-clube" rotulo="Clube em uso" value={clubeId || ''} onChange={trocar}
              ajuda="Você participa de mais de um clube. Cada aba pode estar em um clube diferente."
              opcoes={clubes.map((v) => [v.clubeId, v.marca.nome])} />
          </Card>
        </section>
      )}

      <Grupo titulo="Aplicativo">
        <ItemLink para="/ajuda" icone="❓" titulo="Ajuda / Como usar" desc="Passo a passo de cada parte do app" testid="ir-ajuda" />
        <ItemLink para="/suporte" icone="🛟" titulo="Suporte" desc="Abrir chamado e ver respostas" testid="ir-suporte" />
        <ItemBotao icone="🔄" titulo="Atualizar o app" desc="Buscar a versão mais nova" aoTocar={atualizarApp} />
      </Grupo>

      <button type="button" onClick={sair}
        className="w-full min-h-[48px] rounded-2xl border border-line bg-surface text-sm font-bold text-red-600 active:bg-surface2">
        Sair da conta
      </button>
    </div>
  )
}

// Lista agrupada (estilo ajustes do celular): um cartão por grupo, linhas separadas por divisória.
function Grupo({ titulo, children }) {
  return (
    <section>
      <h2 className="mb-1.5 px-1 text-xs font-bold uppercase tracking-wide text-faint">{titulo}</h2>
      <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface">{children}</ul>
    </section>
  )
}

function Conteudo({ icone, titulo, desc }) {
  return (
    <>
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-surface2 text-lg" aria-hidden="true">{icone}</span>
      <span className="min-w-0 flex-1 text-left">
        <span className="block text-[15px] font-semibold text-ink">{titulo}</span>
        {desc && <span className="block truncate text-xs text-faint">{desc}</span>}
      </span>
      <span className="shrink-0 text-faint" aria-hidden="true">›</span>
    </>
  )
}

function ItemLink({ para, testid, ...c }) {
  return (
    <li>
      <Link to={para} data-testid={testid} className="flex min-h-[56px] items-center gap-3 px-3.5 py-2.5 active:bg-surface2">
        <Conteudo {...c} />
      </Link>
    </li>
  )
}

function ItemBotao({ aoTocar, ...c }) {
  return (
    <li>
      <button type="button" onClick={aoTocar} className="flex w-full min-h-[56px] items-center gap-3 px-3.5 py-2.5 active:bg-surface2">
        <Conteudo {...c} />
      </button>
    </li>
  )
}

const PAPEIS = {
  desbravador: 'Desbravador', conselheiro: 'Conselheiro', instrutor: 'Instrutor',
  diretoria: 'Diretoria', tesoureiro: 'Tesouraria', pais: 'Responsável',
}
const rotuloPapel = (p) => PAPEIS[p] || 'Membro'
