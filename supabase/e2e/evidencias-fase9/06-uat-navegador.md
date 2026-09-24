# UAT no navegador — fase 9, item 6

Front de staging (`npm run dev -- --port 4273 --mode staging`), CSP conferida: `connect-src` libera só
`127.0.0.1:55321`. Viewport de celular (375×812). Uma identidade por vez, em sequência (regra de
sessão do `HARNESS.md`); a jornada 4 usa duas abas da MESMA conta, que é o caso legítimo.

**Método.** As jornadas 1 (código gerado), 2, 4 e 19 foram feitas por **toque** (clique com
coordenada). A janela do app ficou em segundo plano durante a sessão e a página deixou de desenhar
entre capturas: toques passaram a se perder (o devocional do dia, que abre por cima em todo
carregamento, também engolia toques). A partir da jornada 5 os botões foram acionados **pelo DOM**
(`element.click()` e o setter nativo dos campos): o fluxo exercita a mesma lógica do app, as mesmas
chamadas e o mesmo banco; o que se perde é só a verificação de alvo de toque. Toda jornada foi
conferida **no banco**, não na tela.

| # | jornada | resultado | conferido no banco |
|---|---|---|---|
| 1 | cadastro sem clube → confirmação de e-mail (Mailpit) → código → pedido → aprovação | ✅ entra em C | vínculo desbravador/ativo em C; trilha: `vinculo_criado` (pela própria pessoa, pendente) → `vinculo_alterado` (pelo fundador de C, pendente→ativo) |
| 2 | convite para um segundo clube (fundador de C aceita convite de instrutor em B) | ✅ | vínculo instrutor/ativo em B; trilha com ator |
| 3 | pessoa em A+B+C troca de clube | ✅ título, marca e mural mudam; mural 50/34/11 = piso do banco | — |
| 4 | troca e recarga, duas abas da mesma conta | ✅ aba 1 em B e aba 2 em C, cada uma mantém o seu clube depois de recarregar | — |
| 5 | membro (só B): mural, jogos, devocional | ✅ mural só com as 34 fotos de B | devocional e 5 pontos **em B** |
| 6 | responsável | ✅ cai em "Meu filho", vê só a filha certa (pontos, mensalidade pendente); menu restrito | — |
| 7 · 13 · 14 | criança envia requisito, instrutor (A+B) aprova na aba B | ✅ | requisito `aprovado` em B, avaliado pelo instrutor |
| 8 | diretoria: Usuários, Aprovações, Mensalidades | ❌→✅ **BLOCKER: Usuários quebrava inteira** (corrigido, `3c46139`); depois: lista só gente de A | — |
| 9 | coordenador: portal institucional | ✅ só os 2 clubes do distrito, só agregados | — |
| 10 | fundador sem clube → onboarding completo | ❌→✅ **BLOCKER: ao terminar, "você não está em um clube"** (corrigido, `9abfc30`) | clube e vínculo de diretoria criados |
| 11 | classe | ✅ progresso requisito a requisito, com histórico | — |
| 12 | especialidade | ✅ abre — mas o catálogo é **só de teste** ("[PILOTO/TESTE]") | — |
| 15 | documento: conferência pública sem login | ✅ válido, sem e-mail/nascimento; token adulterado → "não encontrado" | — |
| 16 | experiência | ✅ vê a experiência publicada de B e o próprio status | — |
| 17 | jogos | ✅ partida iniciada | partida **em B** |
| 18 | mensalidade pela tela | ✅ | setembro pago, R$ 30, **caixa de A**, registrado pela diretoria de A |
| 19 | sair → entrar com outra identidade | ✅ aba, semente, marca e sessão zeradas; título volta ao do produto | — |

**Varredura de rotas** (todas as 50 do app, sem recarregar, crash detectado pela fronteira de erro e
pela telemetria): diretoria de A (45 rotas de clube), membro de B (50), responsável (13: tudo do app
interno redireciona para "Meu filho"), coordenador (portal + 7), pessoa A+B+C na aba de C, que tem
recursos desligados (21). **Zero quebras** depois da correção de Usuários; zero erros na telemetria
durante a varredura.

**Achados da UAT que não bloqueiam** (classificados no relatório): a fronteira de erro mostra "saiu
uma versão nova" para qualquer crash; a tela de sucesso do cadastro diz "é só entrar" sem avisar da
confirmação de e-mail, e o e-mail de confirmação vem em inglês (template padrão do Auth); rótulo
"mín. 6 caracteres" (o servidor exige 8 com letras e números); telas que listam pessoas pelo espelho
de `profiles` (a criança de dois clubes some da chamada do segundo clube); duas versões publicadas do
plano Essencial aparecem como duas opções (o servidor usa a mais nova); especialidades só com
catálogo de teste. Não exercitado pela tela: **upload de foto de evidência** — o painel não tem envio
de arquivo; o caminho do Storage foi exercitado pela API (povoamento, restore e red-team).
