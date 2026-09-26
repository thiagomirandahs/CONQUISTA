// Fluxo do cartão de classe (migration 330): revisão do clube → distrito → região → apto à investidura.
// Só apresentação: quem decide a etapa, quem pode aprovar e o que pula é sempre o servidor.

// Rótulo curto da etapa ATUAL, a partir da etapa que o servidor devolve ({ chave, escopo_tipo, nome }).
export function rotuloDaEtapa(etapa) {
  if (!etapa) return null
  if (etapa.chave === 'investidura') return 'Apto à investidura'
  if (etapa.chave === 'revisao_clube') return 'Aguardando revisão do clube'
  if (etapa.escopo_tipo === 'distrito') return 'Aguardando distrito'
  if (etapa.escopo_tipo === 'regiao') return 'Aguardando região'
  return etapa.nome ? `Aguardando: ${etapa.nome}` : 'Em aprovação'
}

// A etapa atual de uma linha do tempo ({ etapa_atual_ordem, etapas: [...] }) — null se a corrida acabou.
export function etapaAtual(linha) {
  if (!linha || linha.etapa_atual_ordem == null) return null
  return (linha.etapas || []).find((e) => e.ordem === linha.etapa_atual_ordem) || null
}

// Normaliza uma corrida vinda de workflow_historico() para o formato da linha do tempo.
export function linhaDoHistorico(run) {
  if (!run) return null
  return {
    status: run.status,
    etapa_atual_ordem: run.etapa_atual_ordem ?? null,
    etapas: (run.etapas || []).map((e) => ({
      ordem: e.ordem, chave: e.chave, nome: e.nome, escopo_tipo: e.escopo_tipo,
      decisao: e.decisao ? {
        decisao: e.decisao.decisao, observacao: e.decisao.observacao, decidido_em: e.decisao.decidido_em,
        decisor_nome: e.decisao.decisor?.nome || null, escopo_nome: e.decisao.escopo?.nome || null,
      } : null,
    })),
  }
}

// Situação de cada etapa para desenhar a linha do tempo.
export function situacaoDaEtapa(etapa, linha) {
  const d = etapa.decisao?.decisao
  if (d === 'aprovado') return etapa.chave === 'investidura' ? 'investida' : 'aprovada'
  if (d === 'pulada_nivel_ausente') return 'pulada'
  if (d === 'correcao_solicitada' || d === 'reprovado') return 'devolvida'
  if (linha?.etapa_atual_ordem === etapa.ordem) return 'atual'
  return 'futura'
}
