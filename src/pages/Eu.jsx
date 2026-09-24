import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/Auth.jsx'
import { useClube } from '../context/Clube.jsx'
import { useEscopo } from '../context/Escopo.jsx'
import { Card, CardAcao, Cabecalho, Selecao, Botao } from '../ui/index.jsx'
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
  const [tema, setTema] = useState(() =>
    (typeof document !== 'undefined' && document.documentElement.getAttribute('data-theme') === 'dark') ? 'escuro' : 'claro')

  const clubes = (vinculos || []).filter((v) => v.status === 'ativo' && v.selecionavel)

  function alternarTema() {
    const novo = tema === 'escuro' ? 'claro' : 'escuro'
    document.documentElement.setAttribute('data-theme', novo === 'escuro' ? 'dark' : 'light')
    try { localStorage.setItem('tema', novo) } catch { /* sem storage */ }
    setTema(novo)
  }

  async function trocar(e) {
    const r = await trocarClube(e.target.value)
    if (r?.ok) navigate('/inicio', { replace: true })
  }

  async function atualizarApp() {
    try {
      const reg = await navigator.serviceWorker?.getRegistration?.()
      if (reg) await reg.update()
    } catch { /* ignora */ }
    window.location.reload()
  }

  return (
    <div className="max-w-2xl mx-auto">
      <Cabecalho icone="👤" titulo={profile?.nome || 'Você'} descricao={`${rotuloPapel(papel)} em ${marca?.nome || 'seu clube'}`} />

      <ul className="space-y-2.5 mb-5">
        <li><CardAcao para="/perfil"><Linha icone="🪪" titulo="Meu perfil" desc="Foto, avatar e seus dados" /></CardAcao></li>
        {temGestao && (
          <li><CardAcao para="/clube"><Linha icone="🎨" titulo="Configurações do clube" desc="Identidade, recursos e plano" /></CardAcao></li>
        )}
      </ul>

      {/* ---- convites recebidos: é por aqui que uma pessoa entra num SEGUNDO clube ---- */}
      <section className="mb-5"><MeusConvites /></section>

      {/* ---- outras jornadas da MESMA conta ---- */}
      {(temEscopo || clubes.length > 1) && (
        <section aria-labelledby="t-jornadas" className="mb-5">
          <h2 id="t-jornadas" className="text-sm font-extrabold text-ink mb-2">Trocar de jornada</h2>
          {clubes.length > 1 && (
            <Card className="mb-2.5">
              <Selecao id="eu-clube" rotulo="Clube em uso" value={clubeId || ''} onChange={trocar}
                ajuda="Você participa de mais de um clube. Cada aba pode estar em um clube diferente."
                opcoes={clubes.map((v) => [v.clubeId, v.marca.nome])} />
            </Card>
          )}
          {temEscopo && (
            <CardAcao para="/institucional" data-testid="ir-portal">
              <Linha icone="🏛️" titulo="Portal institucional"
                desc={escopos.length === 1 ? escopos[0].nome : `${escopos.length} escopos`} />
            </CardAcao>
          )}
        </section>
      )}

      <section aria-labelledby="t-ajustes">
        <h2 id="t-ajustes" className="text-sm font-extrabold text-ink mb-2">Ajustes</h2>
        <div className="space-y-2">
          <Botao variacao="secundario" className="w-full justify-start" aoTocar={alternarTema}>
            {tema === 'escuro' ? '☀️ Modo claro' : '🌙 Modo escuro'}
          </Botao>
          <Botao variacao="secundario" className="w-full justify-start" aoTocar={atualizarApp}>🔄 Atualizar o app</Botao>
          <Botao variacao="secundario" className="w-full justify-start" aoTocar={sair}>🚪 Sair</Botao>
        </div>
      </section>
    </div>
  )
}

function Linha({ icone, titulo, desc }) {
  return (
    <div className="flex items-center gap-3">
      <span className="text-2xl leading-none shrink-0" aria-hidden="true">{icone}</span>
      <span className="min-w-0">
        <span className="block font-bold text-ink">{titulo}</span>
        <span className="block text-sm text-faint leading-snug truncate">{desc}</span>
      </span>
      <span className="ml-auto text-faint shrink-0" aria-hidden="true">›</span>
    </div>
  )
}

const PAPEIS = {
  desbravador: 'Desbravador', conselheiro: 'Conselheiro', instrutor: 'Instrutor',
  diretoria: 'Diretoria', tesoureiro: 'Tesouraria', pais: 'Responsável',
}
const rotuloPapel = (p) => PAPEIS[p] || 'Membro'
