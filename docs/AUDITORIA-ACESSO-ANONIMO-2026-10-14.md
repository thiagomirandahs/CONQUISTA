# Auditoria de acesso sem autenticação — 14/10/2026

Base: `main`, commit `d007e4faf7860bfef4c20ab805eeed2d4e0c5ad9`. Varredura das 284 migrations, grants/revokes/policies, definições atuais das RPCs públicas, rotas e oito Edge Functions. Código do PR de pagamento examinado separadamente. Esta é uma auditoria do código e dos contratos; não houve consulta ao banco/configuração implantados nem exploração de produção. Não equivale a afirmar que o banco real está seguro ou que todas as migrations foram aplicadas.

## Tudo que um visitante pode acessar

### Páginas e operações públicas

| Caminho/operação | Informação ou ação disponível |
|---|---|
| `/` | Landing comercial, explicação do aplicativo e planos publicados. |
| `/planos`, `/adquirir` no site | Catálogo público de licenças, preço e condições. No app, a rota interna `/planos` é protegida; `/adquirir` é pública. |
| `/conheca`, `/ajuda` no site | Apresentação e instruções públicas. A ajuda interna do app exige sessão. |
| `/clubes`, `/clubes/:slug` | Lista de clubes ATIVOS não ocultados pela diretoria/moderação; nome, slug, sigla, lema, cores, logo, cidade/UF e região/distrito. **A listagem institucional é automática por decisão anterior registrada na migration 203**, mesmo sem cartão opt-in. Não muda nesta correção. Detalhes/horário/local/link de inscrição só com cartão ativo e aceite; nome do diretor, WhatsApp e e-mail também exigem seus respectivos publicar_* ligados. |
| `/parceiros` | Parceiros ativos dentro da vigência, nome, descrição, categoria, logo e links/WhatsApp publicados. |
| `/verificar/:token` | Com token válido: nome do titular (pode ser menor), classe, clube emissor, versão curricular, datas, estado/integridade, código de conferência, template/versão/hashes de PDF e nomes/papéis/datas/status das assinaturas registradas. **Não é só um selo válido/inválido**. Não entrega os requisitos, provas, histórico nem o PDF privado. O token é uma capacidade de consulta: quem receber o QR/link pode ver esse resumo. |
| `/login`, `/cadastro` | Autenticar/criar conta pela API Supabase Auth. Criar conta não dá papel de liderança nem acesso a clube automaticamente. Metadados do cadastro não escolhem papel privilegiado. |
| `/recuperar` | Solicitar e-mail de recuperação. Não permite mudar a senha de alguém sem o fluxo/token de recuperação. |
| `/nova-senha` | Carregar a tela; a mudança de senha depende de sessão válida de recuperação. |
| `/entrar?codigo=...` | Sem sessão e com código: identidade pública do clube (nome/sigla/lema/logo); pode seguir para cadastro. Sem código, redireciona para login. Solicitar entrada de fato exige sessão e aprovação. |
| Convite de coordenação | A RPC de abertura aceita um token sem login e mostra papel/modo/tipo de unidade/expiração, unidade institucional/id/caminho e opções institucionais no modo escolha. **A página `/coordenacao` exige sessão**; a existência da RPC pública independe dessa proteção do frontend. Aceitar o convite exige autenticação. |
| Estado de manutenção | Ligado/desligado, mensagens, horário do aviso e horário atual; não expõe quem alterou a configuração. |
| Telemetria | Enviar código aleatório da sessão, origem site/app/apk e sinal/página. Não pode ler métricas nem dados de outras sessões. Até a correção, podia enviar o indicador logado=true e inflar o número exibido ao admin. |

### RPCs explicitamente públicas no código atual

1. `planos_disponiveis()`
2. `vitrine_clubes_publico()`
3. `vitrine_clube_publico(text)`
4. `parceiros_publico()`
5. `documento_verificar(text)`
6. `entrada_abrir_publico(text)`
7. `convite_hierarquia_abrir(text)`
8. `manutencao_estado()`
9. `metrica_registrar(uuid,text,boolean,boolean)` — escrita limitada, sem resultado de consulta.

O PR de pagamento adiciona `licenca_promocao_situacao()`, com números agregados das 50 vagas e preços, sem identificação de clubes/contas/pedidos. Ainda não está em `main`. A migration de segurança permite essa função apenas se ela já estiver instalada.

### Arquivos e APIs acessíveis sem login

- HTML, JavaScript e CSS publicados, manifest/service workers, ícones, logos, screenshots, imagens das classes/especialidades e `public/especialidades/fontes.json`. Tudo em `public/` é recurso público. O código cliente e a chave Supabase anon/publishable são públicos por arquitetura; a segurança precisa estar no banco/servidor, não no segredo dos caminhos.
- Bundles de atualização OTA, quando gerados/publicados, também precisam ser baixados antes do login.
- Storage `publico` (logos/divulgação dos clubes) e `parceiros`: arquivos podem ser obtidos pelo URL conhecido mesmo sem sessão. As policies de listagem/escrita não protegem downloads de um bucket público. Um cartão ocultado/parceiro vencido deixa de aparecer na vitrine, mas isso **não revoga** a URL do arquivo nesses buckets. Não tornam-se privados nesta correção, pois são assets públicos previstos.
- Storage privado: `imagens`, `comprovacoes`, `documentos-emitidos`, `assinaturas-desenhadas`, `comunidade`, `suporte-anexos`. Download exige autorização ou uma URL assinada ainda válida. Uma URL assinada pode ser usada sem login enquanto não expirar: é acesso por capacidade, não liberação geral da tabela/bucket.
- Supabase Auth: endpoints de login/cadastro/recuperação/confirmação/renovação, com os limites do provedor. A configuração versionada exige confirmação de e-mail, rotação de refresh token, senha mínima e desabilita anonymous sign-ins; **configuração de produção não foi confirmada**. CAPTCHA está comentado; não foi ativado sem credencial/configuração do provedor.
- `licenca-infinitepay?webhook=1`: endpoint público do provedor. Não confia no corpo para declarar um pagamento: consulta `payment_check`, confere valor/método/parcelas e só então ativa. Comprar/consultar situação como cliente exige getUser + autorização financeira no banco.
- As outras funções de servidor são invocáveis como endpoints, mas operação é recusada sem sessão autorizada (PDF/foto admin) ou sem segredo interno (push/saneamento/limpeza/exclusão). OPTIONS/CORS não concede acesso a dados.
- O repositório GitHub indicado é público; seu código/docs/migrations podem ser lidos independentemente do login no aplicativo. Esta revisão não auditou todo o histórico Git nem todos os artefatos de evidências em busca de dados pessoais. Não foram encontrados JWTs/chaves secretas/chaves privadas literais nos arquivos SQL/Edge inspecionados.

### O que não deve ser acessível

Sem login: perfis/membros, crianças/responsáveis, presença, pontos/ranking, mensalidades, documentos completos/provas/assinaturas desenhadas, chat, Rede DBV/stories/fotos privadas, chamados e anexos, contas/faturas/pedidos, alterações de plano/cargo, criação de clube/onboarding, dashboards e administração. A proteção de rotas é acompanhada por grants/RLS/checagens de sessão/papel nas RPCs. A configuração real precisa ser conferida pelo SQL de inventário abaixo.

## Achados e correções

| Achado confirmado no código | Consequência | Correção preparada |
|---|---|---|
| Entrada e convite limitavam só respostas erradas. Código válido não consumia cota. | Repetição ilimitada de consultas válidas e gravação de tentativas. | Cota atômica para todas as consultas anônimas, antes da implementação original. |
| COUNT+INSERT não garante limite sob concorrência; métricas tinham teto semelhante. | Requisições simultâneas podem atravessar o limite declarado. | Contadores com UPSERT condicional e teto global; serialização do teto de novas sessões da telemetria. |
| Verificação de documentos não tinha cota. | Raspagem/repetição de consultas e trabalho de banco ilimitados por essa RPC. Não prova descoberta de tokens. | Cota por origem e global; limite de entrada. |
| Telemetria confiava em p_logado enviado por anon. | Visitante podia inflar o indicador de usuários logados; **não obtinha uma sessão**. | O servidor deriva o indicador de auth.uid(). |
| Webhook lê req.json() inteiro; teto real só após parse, Content-Length não é confiável. | Corpo sem tamanho/falso pode consumir memória/trabalho antes da rejeição. | Leitura por fluxo limitada a 16 KiB e prazo de 5 s, antes do parse. |
| Rotas com tokens sem no-store/noindex específicos. | Risco de cache/indexação e propagação do endereço sensível. | Cache-Control private/no-store, Referrer-Policy no-referrer, X-Robots-Tag noindex/nofollow/noarchive. Não apaga caches antigos. |
| Permissões futuras dependem de revokes espalhados. | Risco de RPC criada com exposição acidental. **Não foi identificada uma RPC administrativa anônima atual.** | Reaplica lista fechada e defaults; bloqueia tabelas/sequências diretas de anon/PUBLIC, mantendo privilégios explícitos autenticados. |

Não foi demonstrado um bypass atual de autenticação para ler membros/fotos privadas ou ativar plano sem pagamento. Isso é conclusão limitada ao código analisado, não certificação de produção.

## Limites e validação

- Origem usa o helper existente, que lê headers do gateway. Precisa confirmar na configuração implantada que o gateway substitui esses headers. O teto global não depende da veracidade do IP; limites no gateway/WAF continuam necessários contra volume distribuído.
- Janelas das novas cotas: 10 minutos. Entrada/convite/documento: 120 por origem e 5000 globais por serviço; vitrine compartilhada: 300/10000; planos: 300/10000; métricas: 1200/12000. Nat/proxy pode compartilhar a origem. Ajustar ao tráfego real após medição.
- Chamadas autenticadas mantêm suas checagens internas e ficam fora da nova cota anônima. Não é auditoria completa de abuso por usuário já autenticado.
- RPCs encapsuladas passam a VOLATILE porque registram a cota: chamadas via POST continuam; não dependam de GET/read-only para essas RPCs.
- Passaram os **5 testes Node** de objeto pequeno, excesso sem Content-Length, Content-Length falso, JSON inválido/array e fluxo sem fim: `node supabase/tests/e2e/json-limitado.test.mjs`.
- Testes SQL adicionados em `supabase/tests/148_auditoria_superficie_anonima.sql`; teste 147 ajustado para não aceitar login falsificado. **Não executados**: PostgreSQL/PGlite/dependências não estão disponíveis nesta sessão. Replay completo e testes concorrentes em PostgreSQL real ficam pendentes.

## Antes de publicar

1. Executar `scripts/seguranca/auditoria-anon.sql` no banco real: é somente leitura, mostra grants/policies/buckets sem conteúdo pessoal/segredos. Comparar com a lista acima.
2. Validar migration 548 e suite de banco em ambiente de homologação; conferir bloqueios, limites, reexecução e chamadas reais do frontend.
3. Aplicar migration 548, publicar a Edge Function com `json-limitado.js` e publicar frontend/configuração Vercel. A 548 não exige a 547 de pagamentos, nem altera preços.
4. Conferir configurações Auth, headers de IP do gateway, Storage e cache em produção. Não ativar cobrança antes da homologação prevista no PR de pagamentos.

Nenhuma correção desta auditoria foi aplicada ao banco, provedor ou hospedagem de produção nesta sessão.
