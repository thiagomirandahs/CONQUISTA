import { Icone } from './Icones.jsx'

// Ilustrações do PRÓPRIO produto, em HTML/CSS (nenhuma imagem, nenhum dado real — "Clube Exemplo").
// Decorativas: cada bloco tem role="img" + aria-label com o resumo, o conteúdo interno fica oculto
// do leitor de tela para não ler números de exemplo como se fossem informação.

function Barra({ valor, cor = 'bg-[#2f6bff]' }) {
  return (
    <div className="h-1.5 rounded-full bg-slate-200 overflow-hidden">
      <div className={`h-full rounded-full ${cor}`} style={{ width: `${valor}%` }} />
    </div>
  )
}

export function NotebookPainel() {
  const linhas = [
    { nome: 'Ana B.', req: 'Amigo · Req. 4', estado: 'Aguardando', cor: 'bg-amber-100 text-amber-800' },
    { nome: 'Lucas M.', req: 'Companheiro · Req. 2', estado: 'Tentativa 2', cor: 'bg-sky-100 text-sky-800' },
    { nome: 'Júlia R.', req: 'Amigo · Req. 1', estado: 'Aprovado', cor: 'bg-emerald-100 text-emerald-800' },
  ]
  return (
    <div role="img" aria-label="Ilustração do painel da diretoria no computador: membros, presença, avaliações pendentes e documentos." className="w-full">
      <div aria-hidden="true" className="mx-[4%] rounded-t-2xl border border-slate-200 bg-white shadow-[0_30px_60px_-30px_rgba(11,27,70,0.45)] overflow-hidden">
        <div className="flex items-center gap-1.5 px-3 py-2 bg-slate-100 border-b border-slate-200">
          <span className="w-2.5 h-2.5 rounded-full bg-slate-300" /><span className="w-2.5 h-2.5 rounded-full bg-slate-300" /><span className="w-2.5 h-2.5 rounded-full bg-slate-300" />
          <span className="ml-3 text-[10px] text-slate-500 truncate">app.desbravaclube.com.br/gestao</span>
        </div>
        <div className="grid grid-cols-[92px_1fr] min-h-[250px]">
          <div className="bg-[#0b1b46] text-white/80 p-2.5 space-y-2 text-[10px]">
            <div className="flex items-center gap-1.5 text-white font-bold mb-3"><img src="/logo.png" alt="" className="w-5 h-5 rounded-full" />Clube</div>
            {['Início', 'Membros', 'Presença', 'Avaliações', 'Documentos', 'Inscrições'].map((m, i) => (
              <div key={m} className={`rounded-md px-2 py-1 ${i === 3 ? 'bg-white/15 text-white' : ''}`}>{m}</div>
            ))}
          </div>
          <div className="p-3 space-y-3 bg-slate-50">
            <div className="grid grid-cols-3 gap-2">
              {[['Membros', '48'], ['Presença', '92%'], ['Pendentes', '7']].map(([r, v]) => (
                <div key={r} className="rounded-lg bg-white border border-slate-200 p-2">
                  <div className="text-[9px] text-slate-500">{r}</div>
                  <div className="text-sm font-extrabold text-[#0b1b46]">{v}</div>
                </div>
              ))}
            </div>
            <div className="rounded-lg bg-white border border-slate-200 p-2">
              <div className="text-[10px] font-bold text-[#0b1b46] mb-1.5">Fila de avaliação</div>
              {linhas.map((l) => (
                <div key={l.nome} className="flex items-center justify-between gap-2 py-1 border-t border-slate-100 first:border-0">
                  <div className="min-w-0">
                    <div className="text-[10px] font-semibold text-slate-800 truncate">{l.nome}</div>
                    <div className="text-[9px] text-slate-500 truncate">{l.req}</div>
                  </div>
                  <span className={`shrink-0 text-[9px] font-semibold rounded-full px-1.5 py-0.5 ${l.cor}`}>{l.estado}</span>
                </div>
              ))}
            </div>
            <div className="rounded-lg bg-white border border-slate-200 p-2">
              <div className="flex justify-between text-[10px] mb-1"><span className="font-bold text-[#0b1b46]">Unidade Águias</span><span className="text-slate-500">68%</span></div>
              <Barra valor={68} />
            </div>
          </div>
        </div>
      </div>
      <div aria-hidden="true" className="h-3 rounded-b-xl bg-gradient-to-b from-slate-300 to-slate-400" />
    </div>
  )
}

export function CelularClasse({ className = '' }) {
  return (
    <div role="img" aria-label="Ilustração do celular do desbravador: classe atual, progresso e requisitos." className={className}>
      <div aria-hidden="true" className="w-[168px] rounded-[26px] border-[6px] border-[#0b1b46] bg-white shadow-[0_30px_50px_-25px_rgba(11,27,70,0.6)] overflow-hidden">
        <div className="bg-[#0b1b46] text-white px-3 pt-3 pb-4">
          <div className="text-[9px] text-white/70">Minha Classe</div>
          <div className="text-sm font-extrabold">Amigo</div>
          <div className="mt-2 flex justify-between text-[9px] text-white/80"><span>Progresso</span><span>62%</span></div>
          <div className="h-1.5 mt-1 rounded-full bg-white/20 overflow-hidden"><div className="h-full w-[62%] rounded-full bg-[#f5b012]" /></div>
        </div>
        <div className="p-2.5 space-y-1.5">
          {[['1', 'Aprovado', 'text-emerald-600'], ['2', 'Aprovado', 'text-emerald-600'], ['3', 'Correção', 'text-rose-600'], ['4', 'Enviado', 'text-amber-600'], ['5', 'A fazer', 'text-slate-400']].map(([n, s, c]) => (
            <div key={n} className="flex items-center justify-between rounded-lg bg-slate-50 border border-slate-100 px-2 py-1.5">
              <span className="text-[10px] text-slate-700">Requisito {n}</span>
              <span className={`text-[9px] font-bold ${c}`}>{s}</span>
            </div>
          ))}
          <div className="rounded-lg bg-[#2f6bff] text-white text-[10px] font-bold text-center py-1.5">Enviar atividade</div>
        </div>
      </div>
    </div>
  )
}

export function CardTentativas() {
  const passos = [
    { t: 'Tentativa 1 enviada', d: 'Foto da atividade + descrição', icone: 'atividades', cor: 'text-slate-600 bg-slate-100' },
    { t: 'Correção solicitada', d: '“Faltou mostrar o nó finalizado.”', icone: 'historico', cor: 'text-rose-700 bg-rose-50' },
    { t: 'Tentativa 2 reenviada', d: 'Nova evidência — a 1ª continua no histórico', icone: 'atividades', cor: 'text-sky-700 bg-sky-50' },
    { t: 'Aprovado pelo instrutor', d: 'Requisito concluído', icone: 'check', cor: 'text-emerald-700 bg-emerald-50' },
  ]
  return (
    <div role="img" aria-label="Ilustração do histórico de um requisito: envio, correção solicitada, reenvio e aprovação." className="rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_20px_40px_-28px_rgba(11,27,70,0.45)]">
      <div aria-hidden="true">
        <div className="text-xs text-slate-500">Classe Amigo · Requisito 3</div>
        <div className="font-bold text-[#0b1b46] mb-4">Histórico por tentativa</div>
        <ol className="space-y-3">
          {passos.map((p) => (
            <li key={p.t} className="flex gap-3">
              <span className={`shrink-0 w-8 h-8 rounded-full grid place-items-center ${p.cor}`}><Icone nome={p.icone} className="w-4 h-4" /></span>
              <div>
                <div className="text-sm font-semibold text-slate-800">{p.t}</div>
                <div className="text-xs text-slate-500">{p.d}</div>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </div>
  )
}

export function ArvoreMulticlube() {
  const clubes = ['Clube A', 'Clube B', 'Clube C']
  return (
    <div role="img" aria-label="Ilustração: a plataforma DesbravaClube com três clubes separados, cada um com seus membros, gestão e arquivos." className="rounded-2xl border border-slate-200 bg-white p-6">
      <div aria-hidden="true">
        <div className="mx-auto w-fit flex items-center gap-2 rounded-xl bg-[#0b1b46] text-white px-4 py-2.5 font-bold">
          <img src="/logo.png" alt="" className="w-6 h-6 rounded-full" /> DesbravaClube
        </div>
        <div className="mx-auto h-6 w-px bg-slate-300" />
        <div className="mx-[16.6%] h-px bg-slate-300" />
        <div className="grid grid-cols-3 gap-2 sm:gap-3">
          {clubes.map((c) => (
            <div key={c} className="flex flex-col items-center">
              <div className="h-5 w-px bg-slate-300" />
              <div className="w-full rounded-xl border border-slate-200 bg-slate-50 p-2 sm:p-3 text-center">
                <div className="text-xs sm:text-sm font-bold text-[#0b1b46]">{c}</div>
                <div className="mt-1.5 flex justify-center gap-1 text-[#2f6bff]">
                  <Icone nome="membros" className="w-3.5 h-3.5" /><Icone nome="documentos" className="w-3.5 h-3.5" /><Icone nome="cadeado" className="w-3.5 h-3.5" />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
