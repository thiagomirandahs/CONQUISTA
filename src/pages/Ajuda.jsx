import { useCallback, useState } from 'react'
import { useAuth } from '../context/Auth.jsx'
import { useClube } from '../context/Clube.jsx'
import { useEscopo } from '../context/Escopo.jsx'
import { Cabecalho } from '../ui/index.jsx'
import GuiaDeUso from '../components/tutorial/GuiaDeUso.jsx'
import TourDaArea from '../components/TourDaArea.jsx'
import { atalhoPermitido, secaoDoPapel } from '../lib/tutorial/tutorial.js'
import { toursDoPapel } from '../lib/tutorial/tours.js'
import { lerDiagnostico } from '../lib/atualizacaoOta.js'

// /ajuda no APP: o tutorial com a seção do papel da pessoa (no clube em uso) logo depois de "Primeiros passos" e o
// atalho "Abrir essa tela" só para as telas que esse papel abre. Conteúdo estático: funciona sem internet.
// "Rever tour": um botão por mini-tour (Gestão só para diretoria/instrutor).
export default function Ajuda() {
  const { profile } = useAuth() || {}
  const { papel, temRecurso } = useClube()
  const { temEscopo } = useEscopo() || {}
  const [tour, setTour] = useState(null)

  const podeAbrir = useCallback((rota) => atalhoPermitido(rota, { papel, temRecurso, temEscopo }), [papel, temRecurso, temEscopo])
  const fecharTour = useCallback(() => setTour(null), [])
  const tours = toursDoPapel(papel)

  return (
    <div className="mx-auto max-w-2xl">
      <Cabecalho voltar={{ para: '/eu', rotulo: 'o Eu' }} icone="❓" titulo="Ajuda / Como usar" descricao="Passo a passo de cada parte do app, para desbravadores, pais e liderança." />
      <nav aria-labelledby="rever-tour-titulo" className="mb-5">
        <h2 id="rever-tour-titulo" className="mb-2 text-sm font-bold text-ink">🧭 Rever tour</h2>
        <ul className="flex flex-wrap gap-2">
          {tours.map((t, i) => (
            <li key={t.id}>
              <button type="button" onClick={() => setTour(t.id)} data-testid={i === 0 ? 'rever-tour' : `rever-tour-${t.id}`}
                className="min-h-[44px] rounded-2xl border border-line bg-surface px-4 text-sm font-bold text-ink active:bg-surface2">
                {t.titulo}
              </button>
            </li>
          ))}
        </ul>
      </nav>
      <GuiaDeUso modo="app" secaoDaPessoa={secaoDoPapel(papel, { temEscopo })} podeAbrir={podeAbrir} temRecurso={temRecurso} />
      <VersaoDoApp />
      {tour && <TourDaArea key={tour} id={tour} uid={profile?.id} papel={papel} forcar aoFechar={fecharTour} />}
    </div>
  )
}

// Linha de diagnóstico: qual versão das telas está rodando e o que o app decidiu na última checagem de atualização (só no APK
// há checagem; na web mostra só a versão). Serve para o suporte entender "o app não atualizou" sem olhar o aparelho.
const MOTIVOS = {
  'versao-nova': 'baixou a versão nova (vale ao fechar e abrir o app)', 'ja-baixada': 'versão nova já baixada (vale ao fechar e abrir o app)',
  'mesma-versao': 'já está na versão mais nova', 'nativo-antigo': 'este APK é antigo: precisa instalar o APK novo',
  rede: 'sem rede ou o download falhou', 'sha-errado': 'arquivo baixado não conferiu', 'manifesto-invalido': 'aviso de atualização inválido',
  intervalo: 'checou há pouco', erro: 'erro ao checar', 'falha-ao-marcar': 'não conseguiu marcar a atualização',
}
function VersaoDoApp() {
  const versao = typeof __OTA_VERSAO__ === 'string' ? __OTA_VERSAO__ : 'dev' // eslint-disable-line no-undef
  const d = lerDiagnostico()
  const quando = d?.quando ? new Date(d.quando).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : ''
  return (
    <p className="mt-6 text-xs text-faint" data-testid="versao-do-app">
      Versão das telas: {versao}{d?.nativo ? ` · APK ${d.nativo}` : ''}
      {d ? <><br />Última checagem de atualização ({quando}): {MOTIVOS[d.motivo] || d.motivo || d.acao}</> : null}
    </p>
  )
}
