# Por que o `vercel.json` é só isso

CSP: a política de conteúdo vive no HTML, gerada no build por `vite-plugin-csp.js` a partir do
`VITE_SUPABASE_URL` do ambiente. Aqui fica SÓ o que uma tag `<meta>` não consegue expressar.

Por que isto encolheu na fase 8.5: este header trazia a política INTEIRA, com
`connect-src https://*.supabase.co` escrito à mão. E quando duas CSPs valem para a mesma
página — uma por header e outra por meta — o navegador aplica a INTERSEÇÃO das duas, não a
união. Enquanto o host estava cravado nos dois lugares, davam no mesmo. Desde que a meta passou
a sair do ambiente, um dia em que a API tivesse domínio próprio a meta permitiria e este header
negaria: o app quebraria só em produção, sem nenhum sinal local, e o motivo estaria escrito num
arquivo que ninguém lembra de olhar quando o console acusa CSP.

A regra ficou: quem sabe o ambiente é o build. O header cuida do que só ele pode.

> Este texto morava como `"$comentario"` dentro do próprio `vercel.json`, mas o validador de
> schema do Vercel passou a rejeitar propriedades desconhecidas no arquivo (`should NOT have
> additional property '$comentario'`), o que quebrou o deploy em produção em 25/09/2026. JSON não
> tem comentário nativo — por isso o texto foi movido para este arquivo ao lado.
