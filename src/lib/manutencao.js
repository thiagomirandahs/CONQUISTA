// Modo manutenção (migration 400) — regras PURAS do cliente.
//
// O servidor é quem garante que nada se perde: com a manutenção ligada ele RECUSA a escrita de
// quem não é admin da plataforma (mensagem começando com "MANUTENCAO:") — nada fica pela metade.
// Aqui o app só decide o que mostrar: a faixa do aviso prévio, a tela de manutenção, e reconhece o
// erro para guardar o que a pessoa estava enviando (rascunho / fila de jogos).

export const INTERVALO_CONSULTA_MS = 60 * 1000

// Telas que continuam abertas com a manutenção ligada: o login (o admin da plataforma precisa
// entrar para testar), a recuperação de senha e a verificação pública de documento (só leitura).
const LIVRES = [/^\/login\/?$/, /^\/recuperar\/?$/, /^\/nova-senha\/?$/, /^\/verificar\//]
export const rotaLivreNaManutencao = (caminho = '') => LIVRES.some((r) => r.test(caminho))

export function ehErroDeManutencao(e) {
  if (!e) return false
  const msg = typeof e === 'string' ? e : `${e.message || ''} ${e.hint || ''}`
  return /MANUTENCAO|em manutenção/i.test(msg)
}

// Normaliza o JSON de manutencao_estado() (null/erro = "não sei" = segue normal: a guarda de
// verdade é o servidor; o app nunca se tranca sozinho por falha de rede).
export function normalizarEstado(bruto) {
  if (!bruto || typeof bruto !== 'object') return { ativo: false, mensagem: '', avisoInicio: null, avisoMensagem: '', souAdmin: false }
  const inicio = bruto.aviso_inicio ? new Date(bruto.aviso_inicio) : null
  return {
    ativo: bruto.ativo === true,
    mensagem: String(bruto.mensagem || ''),
    avisoInicio: inicio && !Number.isNaN(inicio.getTime()) ? inicio : null,
    avisoMensagem: String(bruto.aviso_mensagem || ''),
    souAdmin: bruto.sou_admin === true,
  }
}

export const deveMostrarTela = (estado, caminho) => !!estado?.ativo && !estado.souAdmin && !rotaLivreNaManutencao(caminho)

export function horaCurta(data) {
  try {
    return new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' }).format(data)
  } catch { return '' }
}

// Texto da faixa (ou null = sem faixa).
//  - manutenção ligada e eu sou admin: lembrete de que está ligada (só o admin navega)
//  - aviso prévio agendado: "O app vai entrar em manutenção às HH:MM. Termine o que está fazendo."
//    (some 2h depois do horário se ninguém desligou o aviso — não fica pendurado para sempre)
export function textoDaFaixa(estado, agora = new Date()) {
  if (!estado) return null
  if (estado.ativo) return estado.souAdmin ? 'Manutenção LIGADA — só a equipe da plataforma consegue salvar.' : null
  if (!estado.avisoInicio) return null
  const falta = estado.avisoInicio.getTime() - agora.getTime()
  if (falta < -2 * 60 * 60 * 1000) return null
  const base = falta > 0
    ? `O app vai entrar em manutenção às ${horaCurta(estado.avisoInicio)}. Termine o que está fazendo.`
    : 'O app vai entrar em manutenção a qualquer momento. Termine o que está fazendo.'
  return estado.avisoMensagem ? `${base} ${estado.avisoMensagem}` : base
}
