# Checklist — domínio oficial (desbravaclube.com.br)

Item 8 da rodada de fechamento. O usuário já adquiriu `desbravaclube.com.br`. Este documento
prepara o código e lista exatamente o que falta em infraestrutura (DNS/Vercel/Supabase) — **nada
disso foi alterado nesta rodada**, por instrução explícita.

## Arquitetura alvo

- `https://desbravaclube.com.br` — landing/institucional/comercial (`/`, `/adquirir`).
- `https://app.desbravaclube.com.br` — aplicação autenticada (login, gestão, tudo o resto).
- `https://app.desbravaclube.com.br/admin` — administração da plataforma (sem link em menu nenhum).

## O que o código JÁ está pronto pra isso (verificado nesta rodada)

- **Nenhum domínio está hardcoded em lugar nenhum do app.** Todo link que precisa da própria URL
  (verificação de documento, convite, recuperação de senha, QR) usa `window.location.origin` no
  front ou o header `Origin` da requisição na Edge Function — o app já se adapta sozinho a
  qualquer domínio onde for servido, local, staging ou produção, sem precisar de uma variável de
  domínio pra manter sincronizada.
- `vercel.json` não referencia domínio nenhum.
- O manifest PWA usa `start_url`/`scope` relativos (`/`), não um domínio absoluto.
- `VITE_SUPABASE_URL` (a única URL que realmente precisa ser configurada) já vem de `.env`/variável
  de ambiente da Vercel — nunca do código.

**Conclusão prática:** hospedar `desbravaclube.com.br` (landing) e `app.desbravaclube.com.br` (app)
como **dois domínios apontando pro MESMO deploy** (ou dois projetos Vercel do mesmo repositório)
funciona sem mudar uma linha de código — a diferença de comportamento (mostrar a Landing pública na
raiz "/" pra quem não tem sessão) já existe e é a mesma em qualquer domínio.

## Preparado nesta rodada (arquivos)

- `public/robots.txt` — permite indexar `/` e `/adquirir`, bloqueia o resto (a aplicação
  autenticada não tem valor sendo indexada, e nada nela é destinado a mecanismo de busca).
- `index.html` — meta description adicionada (estava ausente).
- `.env.example` já documentava `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY`/`VITE_VAPID_PUBLIC_KEY`
  — nenhuma variável nova é necessária pro domínio (ver acima: não há domínio pra configurar no
  front).

## O que falta — só em infraestrutura, quando for autorizado

- [ ] **DNS**: apontar `desbravaclube.com.br` e `app.desbravaclube.com.br` pra Vercel (registros A/CNAME
      conforme o painel da Vercel indicar).
- [ ] **Vercel Domains**: adicionar os dois domínios ao projeto (ou um projeto por domínio, se a
      landing e o app forem deploys separados — decisão de produto, não técnica).
- [ ] **Supabase Auth → URL Configuration**:
  - `Site URL` → `https://app.desbravaclube.com.br` (hoje aponta pro local, `supabase/config.toml`
    linha 161 — isso é config do stack LOCAL, não produção; o projeto remoto tem a própria config,
    inalterada nesta rodada).
  - `Redirect URLs` → incluir `https://app.desbravaclube.com.br/*` (login, `/nova-senha` da
    recuperação de senha, confirmação de e-mail, callback de convite).
- [ ] **CORS / Origins** (se aplicável no painel do Supabase ou em alguma Edge Function futura que
      declare uma allowlist explícita — as duas Edge Functions de PDF hoje aceitam qualquer
      `Origin` porque o valor só é usado pra MONTAR um link, nunca pra autorizar nada).
- [ ] **Recuperação de senha / confirmação de e-mail**: os templates de e-mail do Supabase Auth
      (painel → Authentication → Email Templates) usam `{{ .SiteURL }}` — herdam automaticamente o
      Site URL acima, sem precisar editar o HTML dos templates.
- [ ] **Links de convite / QR de inscrição**: já usam `window.location.origin` (ver acima) — abrem
      corretos assim que o app estiver servindo em `app.desbravaclube.com.br`. Nenhum código a
      mudar; só confirmar visualmente depois do DNS/Vercel apontarem pro domínio novo.
- [ ] **PWA manifest / Service Worker**: `scope`/`start_url` relativos já funcionam em qualquer
      domínio; o Service Worker (`vite-plugin-pwa`) é gerado por build e também não referencia
      domínio algum. Vale testar instalação do PWA uma vez no domínio novo antes do piloto.
- [ ] **Canonical**: adicionar `<link rel="canonical" href="https://desbravaclube.com.br/">` (e
      variante pra `/adquirir`) — deixado de propósito FORA desta rodada porque hardcoded um domínio
      antes do DNS apontar pra ele seria uma afirmação falsa enquanto não é verdade ainda.
- [ ] **Sitemap**: com só 2 páginas públicas (`/`, `/adquirir`) um `sitemap.xml` não agrega muito;
      considerar quando a landing crescer (ex.: página de ajuda/institucional pública).

## Prova de que a resolução de URL funciona (testado nesta rodada)

- `window.location.origin` é usado (não reimplementado) nas 4 telas que geram link
  (`DocumentoClasse.jsx`, `GestaoInscricoes.jsx`, `Recuperar.jsx`, `VinculosPais.jsx`) — mesma
  função do navegador, sem lógica própria pra "adivinhar" domínio, então não há bug de resolução
  pra testar isoladamente: é o comportamento padrão do browser, já coberto indiretamente por todo
  teste que usa essas telas.
- As duas Edge Functions de PDF (`gerar-documento-pdf`, `gerar-documento-pdf-final`) usam
  `req.headers.get('origin') ?? SUPABASE_URL` — testado pelo e2e real (`test:pdf:e2e`, 40/40): o QR
  e o texto "Verificação: ..." no PDF usam exatamente essa URL, e o e2e confirma que o texto
  extraído do PDF é coerente (não vazio, sem host interno vazando).
