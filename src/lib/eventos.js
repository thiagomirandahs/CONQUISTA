// Helpers de data/contagem regressiva dos eventos (Agenda + popup da home).

export const curto = (iso) => (iso ? String(iso).slice(0, 10).split('-').reverse().slice(0, 2).join('/') : '')

// Data/hora do evento em milissegundos (local). fimDoDia = 23:59:59 (fim do período).
export function msEvento(dataIso, hora, fimDoDia = false) {
  if (!dataIso) return null
  const [a, m, d] = String(dataIso).slice(0, 10).split('-').map(Number)
  let hh = fimDoDia ? 23 : 0, mm = fimDoDia ? 59 : 0
  if (!fimDoDia && hora && /^\d{1,2}:\d{2}/.test(hora)) { const [h, mi] = hora.split(':').map(Number); hh = h; mm = mi }
  return new Date(a, m - 1, d, hh, mm, fimDoDia ? 59 : 0).getTime()
}

// Pílula compacta: { cor, txt } ou null (passou). Usada no card da Agenda.
export function contagem(ev, agora) {
  const inicio = msEvento(ev.data, ev.hora)
  const fim = msEvento(ev.data_fim || ev.data, null, true)
  if (inicio == null || agora > fim) return null
  if (agora >= inicio && agora <= fim) return { cor: 'verde', txt: '🔴 Acontecendo agora!' }
  const hoje0 = new Date(); hoje0.setHours(0, 0, 0, 0)
  const [a, m, d] = String(ev.data).slice(0, 10).split('-').map(Number)
  const dias = Math.round((new Date(a, m - 1, d).getTime() - hoje0.getTime()) / 86400000)
  if (dias <= 0) {
    const ms = inicio - agora, h = Math.floor(ms / 3600000), mi = Math.floor((ms % 3600000) / 60000)
    return { cor: 'vermelho', txt: h >= 1 ? `⏰ É HOJE! faltam ${h}h ${mi}min` : `⏰ É HOJE! faltam ${mi} min` }
  }
  if (dias === 1) return { cor: 'vermelho', txt: '🎉 É amanhã!' }
  return { cor: dias <= 3 ? 'amarelo' : 'brand', txt: `⏳ faltam ${dias} dias` }
}

// Quebra dias/horas/min/seg pro placar grande do popup. { passou } ou { rolando } ou {dias,...}
export function detalhe(ev, agora) {
  const inicio = msEvento(ev.data, ev.hora)
  const fim = msEvento(ev.data_fim || ev.data, null, true)
  if (inicio == null || agora > fim) return { passou: true }
  if (agora >= inicio && agora <= fim) return { rolando: true }
  let ms = inicio - agora
  const dias = Math.floor(ms / 86400000); ms -= dias * 86400000
  const horas = Math.floor(ms / 3600000); ms -= horas * 3600000
  const min = Math.floor(ms / 60000); ms -= min * 60000
  const seg = Math.floor(ms / 1000)
  return { dias, horas, min, seg }
}

export const CORES_CONT = {
  verde: 'bg-green-100 text-green-700', vermelho: 'bg-red-100 text-red-600',
  amarelo: 'bg-amber-100 text-amber-700', brand: 'bg-brand/10 text-brand',
}
