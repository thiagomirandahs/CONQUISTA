import { marcarInicioDaNavegacao } from '../lib/barreiraDeVoltar.js'
import Avatar from '../components/Avatar.jsx'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/Auth.jsx'
import { useClube } from '../context/Clube.jsx'
import { useEscopo } from '../context/Escopo.jsx'
import { Card, Selecao, GrupoLista, ItemLista } from '../ui/index.jsx'
import { MeusConvites } from '../components/ConvitesDeEquipe.jsx'

// "Eu" (fase 7): identidade, TROCA DE JORNADA e ajustes.
// Aqui mora o que antes estava espalhado: o seletor de clube ficava no fim de uma gaveta com 17
// itens, o portal institucional só existia como card dentro de Gestão, e o onboarding de clube novo
// não tinha NENHUM link no app. Uma pessoa com vários papéis usa a mesma conta e troca de jornada
// por aqui — nunca criando outra conta.
export default function Eu() {
  const { profile, sair } = useAuth()
  const { vinculos, clubeId, trocarClube, marca, papel } = useClube()
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
        {/* Avatar assina a URL do bucket privado 'imagens' (img direto não carregava a foto) */}
        <span className="shrink-0 rounded-full ring-2 ring-line"><Avatar foto={profile?.foto} nome={iniciais} size="w-14 h-14" textSize="text-lg" /></span>
        <div className="min-w-0">
          <h1 className="text-lg font-extrabold leading-tight text-ink">{nome}</h1>
          <p className="text-sm text-muted truncate">
            <span className="mr-1.5 inline-block rounded-full bg-surface2 px-2 py-0.5 text-xs font-semibold text-ink">{rotuloPapel(papel)}</span>
            {marca?.nome || 'seu clube'}
          </p>
        </div>
      </section>

      <GrupoLista titulo="Conta">
        <ItemLista to="/perfil" icone="🪪" titulo="Meu perfil" descricao="Foto, avatar e seus dados" />
        <ItemLista to="/trocar-senha" icone="🔑" titulo="Trocar senha" descricao="Confirme a senha atual e crie uma nova" testid="ir-trocar-senha" />
      </GrupoLista>

      {(papel === 'diretoria' || temEscopo) && (
        <GrupoLista titulo="Clube">
          {papel === 'diretoria' && <ItemLista to="/clube" icone="🎨" titulo="Configurações do clube" descricao="Identidade, recursos e plano" />}
          {temEscopo && (
            <ItemLista to="/institucional" icone="🏛️" titulo="Portal institucional" testid="ir-portal"
              descricao={escopos.length === 1 ? escopos[0].nome : `${escopos.length} escopos`} />
          )}
        </GrupoLista>
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

      <GrupoLista titulo="Aplicativo">
        <ItemLista to="/ajuda" icone="❓" titulo="Ajuda / Como usar" descricao="Passo a passo de cada parte do app" testid="ir-ajuda" />
        <ItemLista to="/suporte" icone="🛟" titulo="Suporte" descricao="Abrir chamado e ver respostas" testid="ir-suporte" />
        <ItemLista onClick={atualizarApp} icone="🔄" titulo="Atualizar o app" descricao="Buscar a versão mais nova" testid="atualizar-app" />
      </GrupoLista>

      <button type="button" onClick={sair}
        className="w-full min-h-[48px] rounded-2xl border border-line bg-surface text-sm font-bold text-red-600 active:bg-surface2">
        Sair da conta
      </button>
    </div>
  )
}

// A lista agrupada (estilo ajustes do celular) virou GrupoLista/ItemLista em src/ui/lista.jsx.

const PAPEIS = {
  desbravador: 'Desbravador', conselheiro: 'Conselheiro', instrutor: 'Instrutor',
  diretoria: 'Diretoria', tesoureiro: 'Tesouraria', pais: 'Responsável',
}
const rotuloPapel = (p) => PAPEIS[p] || 'Membro'
