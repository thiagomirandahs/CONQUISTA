import SiteLayout, { CONTAINER, TopoDaPagina, useMetaDaPagina } from './SiteLayout.jsx'

// Moldura comum das páginas legais (Privacidade e Termos): mesmo cabeçalho/rodapé do site,
// faixa de topo, data de atualização, sumário com âncoras e tipografia legível. O texto de
// cada página entra como filhos (<Secao>…</Secao>); o sumário é montado a partir de `secoes`.
//
// Conteúdo é um RASCUNHO de boa-fé, descrevendo o que o app realmente faz — não substitui a
// revisão de um advogado antes de valer como documento oficial (ver AVISO ao dono no commit).

const pad = (n) => String(n).padStart(2, '0')

export function PaginaLegal({ titulo, descricao, caminho, atualizadoEm, resumo, secoes = [], children }) {
  useMetaDaPagina(titulo, descricao, caminho)
  return (
    <SiteLayout>
      <TopoDaPagina sobre="Legal" titulo={titulo} texto={resumo} />
      <div className={`${CONTAINER} py-10 sm:py-14`}>
        <p className="text-sm text-muted">Última atualização: {atualizadoEm}</p>

        {secoes.length > 0 && (
          <nav aria-label="Nesta página" className="mt-6 rounded-2xl border border-line bg-surface2 p-5 sm:p-6">
            <h2 className="text-xs font-bold uppercase tracking-widest text-brand">Nesta página</h2>
            <ol className="mt-3 grid gap-x-6 gap-y-1 sm:grid-cols-2">
              {secoes.map((s, i) => (
                <li key={s.id}>
                  <a href={`#${s.id}`} className="inline-flex min-h-[40px] items-center text-sm text-ink hover:text-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand rounded">
                    <span className="mr-2 tabular-nums text-faint">{pad(i + 1)}</span>{s.titulo}
                  </a>
                </li>
              ))}
            </ol>
          </nav>
        )}

        <div className="mt-10 space-y-10">{children}</div>
      </div>
    </SiteLayout>
  )
}

export function Secao({ id, numero, titulo, children }) {
  return (
    <section id={id} aria-labelledby={`${id}-titulo`} className="scroll-mt-24">
      <h2 id={`${id}-titulo`} className="text-xl sm:text-2xl font-extrabold tracking-tight text-ink">
        {numero != null && <span className="mr-2 tabular-nums text-brand">{pad(numero)}.</span>}{titulo}
      </h2>
      <div className="mt-3 space-y-3 text-base leading-relaxed text-muted">{children}</div>
    </section>
  )
}

export function Lista({ children }) {
  return <ul className="mt-2 space-y-2 pl-5 list-disc marker:text-brand">{children}</ul>
}

export function Nota({ children }) {
  return <div className="rounded-2xl border border-line bg-surface2 p-5 text-sm leading-relaxed text-ink">{children}</div>
}
