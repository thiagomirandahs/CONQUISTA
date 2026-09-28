# Comunidade entre clubes — fase 1 (migrations 430–432)

> Continuação: a Comunidade virou a **Rede DBV** (migrations 470–472) — ver [REDE-DBV.md](REDE-DBV.md).
> Mudou: nome público = nome + sobrenome; foto de perfil com autorização de imagem; bucket com WebP e 300 KB; fotos expiram em 90 dias.

Feed estilo Instagram/TikTok entre clubes. Público de 10–15 anos: segurança antes de tudo.
**O recurso `comunidade` nasce DESLIGADO e é somente da plataforma** (`recursos_catalogo.somente_plataforma`,
como `especialidades`). Liga-se por clube com `admin_recurso_do_clube_definir(clube, 'comunidade', true)`,
e só depois das decisões pendentes abaixo.

## Como funciona hoje
- **Publicar**: legenda (até 500) + foto opcional; compartilhar = repost interno (sempre aponta para o original).
  Sem download, sem link externo, **sem mensagem privada** (não existe tabela nem RPC para isso).
- **Triagem de texto no servidor** (`_comunidade_triar`, não executável pelo cliente): lista `comunidade_termos`
  (editável pelo admin da plataforma em /admin → Comunidade), normalização de disfarces (acento, leetspeak
  0→o 4→a 3→e @→a 1→i 5→s 7→t, letras repetidas, letras separadas por espaço/ponto) e bloqueio de contato
  (telefone com 8+ dígitos, @usuario, e-mail, URL/domínio, termos de contato como "zap", "insta", "me chama",
  "meu endereço"). Texto ruim **não é publicado**; tudo o que é bloqueado vai para `comunidade_bloqueios`
  com os dígitos mascarados.
- **Foto**: sem IA de imagem contratada, **toda foto entra "em análise"** e só aparece depois que a diretoria do
  clube do autor aprova (Gestão → Moderação da Comunidade). Texto sem foto publica direto após a triagem.
- **EXIF/GPS**: o app sempre redesenha a foto em canvas (`limparFotoParaComunidade`), o que descarta EXIF.
  Atenção: `comprimirImagem` (usada no resto do app) **não** garante isso — devolve o original quando a versão
  nova não fica menor, em GIF ou em erro. O bucket `comunidade` é privado, só aceita JPEG e até 3 MB.
- **Regras**: perfil público = primeiro nome + clube; adulto de outro clube não comenta em post de criança;
  responsável acompanha mas não publica; limites por minuto/dia (menores nos 7 primeiros dias da conta);
  3 avisos (texto bloqueado ou conteúdo removido) em 30 dias = pausa de 3 dias + diretoria avisada.
  Valores em `comunidade_limites()` (mudar = migration nova).
- **Denúncia**: some na hora para todos e a diretoria do clube de quem publicou é notificada (sino + push).
  Quem acumula 3 denúncias improcedentes em 60 dias perde o poder de esconder na hora (a denúncia só entra na fila).
  Diretoria restaura ou remove de vez; tudo em `comunidade_moderacao_log` (imutável). Quem denunciou nunca aparece.
- **Pais**: o desbravador só entra com autorização do responsável vinculado (`responsaveis` aprovado, no clube).
  Revogar retira na hora o que o filho publicou/comentou naquele clube.
- **Alcance**: o feed mostra todos os clubes com o recurso ligado (a plataforma controla quem entra).

## O que muda quando a IA de imagem entrar
1. Uma Edge Function recebe o upload, **recomprime no servidor** (remove EXIF mesmo de cliente adulterado) e classifica.
2. Foto aprovada pela IA publica direto; só o duvidoso cai na fila da diretoria (o status `em_analise` continua).
3. A política de Storage de envio passa a aceitar só o caminho gravado pela função (o cliente deixa de subir direto).

## Pendente / depende do dono
- Contratar IA de imagem (e decidir o limiar de "duvidoso").
- Termos de uso da Comunidade e texto do consentimento dos pais (revisão jurídica, ECA Digital / LGPD art. 14).
- Horário do feed (ex.: bloquear à noite para menores) — não implementado.
- Alcance nacional/regional (hoje: todos os clubes com o recurso ligado).
- Retenção de `comunidade_bloqueios` (sugestão: 90 dias via cron) e GC dos arquivos de fotos removidas.
- Números escritos por extenso ("nove nove...") e disfarces como "pu-ta" não são pegos pela triagem de texto.
