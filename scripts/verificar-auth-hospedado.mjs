#!/usr/bin/env node
// =============================================================================
//  Fase 9.1, item 5 — o AUTH do projeto hospedado do piloto, conferido pelo que ele RESPONDE.
//
//  Por que existe: o config.toml só vale para o Supabase local. O projeto hospedado tem a sua
//  própria cópia de cada opção (confirmação de e-mail, limites por IP, templates, SMTP, redirects),
//  editada no painel, e nada garante que ela bata com o repositório. O Go/No-Go da fase 9 deixou
//  isso como P2: no staging local o limite de login nem existe (40 senhas erradas em 2,4 s) e a
//  confirmação chega em inglês. Este script lê os valores EFETIVOS e compara com critérios escritos.
//
//  SOMENTE LEITURA (GET), em duas camadas:
//    pública     GET <SUPABASE_URL>/auth/v1/health e /auth/v1/settings, com a chave anon
//                → confirmação de e-mail, métodos de entrada, cadastro aberto
//    gestão      GET https://api.supabase.com/v1/projects/<ref>/config/auth, com SUPABASE_ACCESS_TOKEN
//                → limites, senha, JWT, refresh, sessões, site_url e redirects, SMTP, templates
//                Sem token (ou com alvo local), os critérios dessa camada ficam NAO-VERIFICAVEL.
//
//  Uso:
//    SUPABASE_URL=https://<ref>.supabase.co SUPABASE_ANON_KEY=<anon> \
//    SUPABASE_ACCESS_TOKEN=<token-pessoal> PROJECT_REF=<ref> PILOTO_DOMINIO=https://<dominio-do-app> \
//      node scripts/verificar-auth-hospedado.mjs [--saida arquivo.json] [--json]
//
//    node scripts/verificar-auth-hospedado.mjs --env-arquivo .env.staging   # prova contra o staging local
//    node scripts/verificar-auth-hospedado.mjs --autoteste                  # heurísticas e guarda, sem rede
//
//  Parâmetros de critério (opcionais): AUTH_LOGINS_POR_IP (padrão 60), AUTH_EMAILS_POR_HORA (60),
//  AUTH_REDIRECT_EXTRA (lista de prefixos de redirect aceitos além do domínio do piloto, ex.: o
//  esquema do APK). Guarda: AUTH_VERIFICAR_BLOQUEAR (URLs/refs de produção além do .env).
//
//  Saída: 0 = VERDE (todos os obrigatórios PASS) · 1 = algum FAIL · 2 = nenhum FAIL, mas algum
//  obrigatório NAO-VERIFICAVEL · 3 = recusado (produção, parâmetro faltando).
//  Critérios explicados em supabase/infra/AUTH-HOSPEDADO.md.
// =============================================================================
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  Recusa, conferirAlvo, normalizar, ehLocal, obterJson, gestao, lerEnv, lerArgs,
  novoRelatorio, resumir, imprimirCriterios, PASS, FAIL, NV,
} from './lib/hospedado.mjs'

// -----------------------------------------------------------------------------
//  Heurísticas (puras — cobertas pelo --autoteste)
// -----------------------------------------------------------------------------

// Idioma de um assunto/corpo de e-mail. Simples de propósito: conta palavras-marca das duas línguas
// e acentos do português. Não é tradutor; é o suficiente para distinguir "Confirm Your Signup"
// (o padrão do Supabase) de "Confirme seu cadastro". Na dúvida responde 'indefinido', e o critério
// vira NAO-VERIFICAVEL — melhor mandar ler o template no painel do que chutar.
const MARCAS_PT = new Set(['você', 'voce', 'seu', 'sua', 'senha', 'confirme', 'confirmar', 'confirmação', 'confirmacao',
  'cadastro', 'clique', 'conta', 'acesso', 'para', 'recuperar', 'redefinir', 'nova', 'não', 'nao', 'convite', 'convidado',
  'convidada', 'entrar', 'aqui', 'abaixo', 'olá', 'ola', 'obrigado', 'equipe', 'troca', 'trocar', 'alterar', 'endereço',
  'endereco', 'e-mail', 'seguinte', 'recebeu', 'pediu', 'ignore', 'mágico', 'magico', 'acessar', 'criar'])
const MARCAS_EN = new Set(['your', 'you', 'the', 'confirm', 'signup', 'sign', 'click', 'follow', 'this', 'password', 'reset',
  'invite', 'invited', 'magic', 'change', 'address', 'login', 'log', 'here', 'below', 'have', 'been', 'user', 'to', 'of',
  'please', 'account', 'received', 'requested', 'new', 'from', 'email'])
export function idiomaDe(texto) {
  const limpo = String(texto || '')
    .replace(/\{\{[^}]*\}\}/g, ' ')          // variáveis do template ({{ .ConfirmationURL }})
    .replace(/<[^>]*>/g, ' ')                // HTML
    .replace(/&[a-z]+;/gi, ' ')
    .toLowerCase()
  const palavras = limpo.split(/[^a-zà-ÿ-]+/).filter(Boolean)
  let pt = 0; let en = 0
  for (const p of palavras) { if (MARCAS_PT.has(p)) pt++; if (MARCAS_EN.has(p)) en++ }
  if (/[ãõçáéíóúâêô]/.test(limpo)) pt += 2
  if (pt >= 2 && pt > en * 1.2) return 'pt'
  if (en >= 2 && en > pt * 1.2) return 'en'
  return 'indefinido'
}

// password_required_characters da Management API → o nome usado no config.toml
export function exigenciaDeSenha(s) {
  const v = String(s ?? '')
  if (!v) return 'nenhuma'
  const grupos = v.split(':').filter(Boolean)
  if (grupos.length === 2 && /[a-z]/.test(grupos[0]) && /[A-Z]/.test(grupos[0]) && /^[0-9]+$/.test(grupos[1])) return 'letters_digits'
  if (grupos.length === 3) return 'lower_upper_letters_digits'
  if (grupos.length >= 4) return 'lower_upper_letters_digits_symbols'
  return `desconhecida (${grupos.length} grupos)`
}

// e-mail do remetente: o domínio basta para conferir; o nome de usuário pode ser de uma pessoa
const mascararEmail = (e) => { const [u, d] = String(e || '').split('@'); return d ? `${u.slice(0, 1)}***@${d}` : (e ? '***' : '') }

const hostDe = (s) => { const m = String(s || '').match(/^([a-z][a-z0-9+.-]*):\/\/([^/?#]*)/i); return m ? { esquema: m[1].toLowerCase(), host: m[2].toLowerCase().replace(/:\d+$/, '') } : null }

// Os critérios que dependem da Management API. Puro: recebe a config e o contexto, devolve pelo add.
// ctx: { pilotoHost, extras[], loginsPorIp, emailsPorHora, frontEnviaCaptcha }
export function avaliarGestao(cfg, ctx, add) {
  const tem = (k) => cfg && Object.prototype.hasOwnProperty.call(cfg, k)
  const nv = (id, titulo, campos, obrigatorio = true) =>
    add({ id, titulo, obrigatorio, resultado: NV, nota: `campo(s) ausente(s) na resposta da API: ${campos.join(', ')}` })

  // --- senha ---
  if (tem('password_min_length') && tem('password_required_characters')) {
    const exig = exigenciaDeSenha(cfg.password_required_characters)
    const ok = cfg.password_min_length >= 8 && exig === 'letters_digits'
    add({ id: 'senha-politica', titulo: 'política de senha = a do app (8+, letras e números)', resultado: ok ? PASS : FAIL,
      valor: { minimo: cfg.password_min_length, exigencia: exig }, esperado: 'mínimo ≥ 8 e letters_digits',
      nota: ok ? '' : exig.startsWith('lower_upper') ? 'mais forte que o app: o gerador de senha da liderança e a validação do front (8, letras e números) passam a produzir senhas que o Auth recusa' : 'mais fraca que a política da fase 8.1' })
  } else nv('senha-politica', 'política de senha', ['password_min_length', 'password_required_characters'])

  if (tem('security_update_password_require_reauthentication')) {
    add({ id: 'troca-de-senha-segura', titulo: 'troca de senha exige sessão recente', resultado: cfg.security_update_password_require_reauthentication === true ? PASS : FAIL,
      valor: cfg.security_update_password_require_reauthentication, esperado: 'true (secure_password_change)' })
  } else nv('troca-de-senha-segura', 'troca de senha exige sessão recente', ['security_update_password_require_reauthentication'])

  if (tem('mailer_secure_email_change_enabled')) {
    add({ id: 'troca-de-email-dupla', titulo: 'troca de e-mail confirmada nos dois endereços', obrigatorio: false,
      resultado: cfg.mailer_secure_email_change_enabled === true ? PASS : FAIL, valor: cfg.mailer_secure_email_change_enabled, esperado: 'true' })
  }

  // --- limites por IP ---
  // Mapeamento conferido no container do staging: sign_in_sign_ups (config.toml) = GOTRUE_RATE_LIMIT_OTP
  // = rate_limit_otp na API; token_verifications = rate_limit_verify.
  if (tem('rate_limit_otp') && tem('rate_limit_token_refresh')) {
    const otp = cfg.rate_limit_otp; const ref = cfg.rate_limit_token_refresh
    const ativo = Number.isFinite(otp) && otp >= 1 && otp <= 300 && Number.isFinite(ref) && ref >= 1
    add({ id: 'limite-login-ativo', titulo: 'limite de cadastro+login por IP ativo (força bruta)', resultado: ativo ? PASS : FAIL,
      valor: { sign_in_sign_ups_5min: otp, token_refresh_5min: ref }, esperado: 'sign_in_sign_ups entre 1 e 300 por 5 min por IP; token_refresh ≥ 1',
      nota: ativo ? 'prova empírica (senhas erradas até o 429) no AUTH-HOSPEDADO.md §4 — o valor configurado não é a prova de que o limite morde' : 'acima de 300/5 min por IP o limite existe só no papel' })
    const cabe = Number.isFinite(otp) && otp >= ctx.loginsPorIp
    add({ id: 'limite-comporta-reuniao', titulo: `limite comporta ${ctx.loginsPorIp} entradas no mesmo Wi-Fi em 5 min`, resultado: cabe ? PASS : FAIL,
      valor: otp, esperado: `≥ AUTH_LOGINS_POR_IP (${ctx.loginsPorIp})`,
      nota: cabe ? '' : 'numa reunião, as crianças saem pelo MESMO IP público: acima do limite o cadastro e o login respondem "Muitas tentativas"' })
  } else nv('limite-login-ativo', 'limite de cadastro+login por IP', ['rate_limit_otp', 'rate_limit_token_refresh'])

  if (tem('rate_limit_verify')) {
    add({ id: 'limite-verificacao', titulo: 'limite de verificação (clique no link) por IP', obrigatorio: false,
      resultado: cfg.rate_limit_verify >= 1 ? PASS : FAIL, valor: cfg.rate_limit_verify, esperado: '≥ 1 por 5 min por IP' })
  }

  // --- SMTP e cota de e-mail ---
  const smtpOk = Boolean(cfg && cfg.smtp_host && cfg.smtp_admin_email)
  if (tem('smtp_host')) {
    add({ id: 'smtp-proprio', titulo: 'SMTP próprio configurado', resultado: smtpOk ? PASS : FAIL,
      valor: smtpOk ? { host: cfg.smtp_host, porta: cfg.smtp_port ?? null, remetente: mascararEmail(cfg.smtp_admin_email), nome: cfg.smtp_sender_name || '', usuario: cfg.smtp_user ? 'definido' : 'ausente', senha: cfg.smtp_pass ? 'definida' : 'ausente' } : 'e-mail embutido do Supabase',
      esperado: 'smtp_host e remetente definidos',
      nota: smtpOk ? '' : 'o e-mail embutido tem cota fixa e baixa por hora para o projeto inteiro e pode entregar só para a equipe do projeto (confira no painel): no dia do cadastro a confirmação não chega' })
  } else nv('smtp-proprio', 'SMTP próprio', ['smtp_host'])

  if (tem('rate_limit_email_sent')) {
    const cota = cfg.rate_limit_email_sent
    const ok = smtpOk && Number.isFinite(cota) && cota >= ctx.emailsPorHora
    add({ id: 'limite-emails', titulo: `cota de e-mail comporta ${ctx.emailsPorHora}/hora (cadastro + recuperação)`, resultado: ok ? PASS : FAIL,
      valor: { por_hora: cota, smtp_proprio: smtpOk }, esperado: `SMTP próprio e ≥ AUTH_EMAILS_POR_HORA (${ctx.emailsPorHora})`,
      nota: ok ? '' : 'confirmação e recuperação dividem a MESMA cota: estourou, ninguém confirma nem recupera até a hora virar' })
  } else nv('limite-emails', 'cota de e-mail', ['rate_limit_email_sent'])

  // --- captcha ---
  if (tem('security_captcha_enabled')) {
    const lig = cfg.security_captcha_enabled === true
    const ok = lig === ctx.frontEnviaCaptcha
    add({ id: 'captcha-coerente', titulo: 'captcha coerente com o app', resultado: ok ? PASS : FAIL,
      valor: { no_projeto: lig ? (cfg.security_captcha_provider || 'ligado') : 'desligado', app_envia_captchaToken: ctx.frontEnviaCaptcha },
      esperado: 'ligado só se o app enviar captchaToken',
      nota: !ok && lig ? 'captcha ligado e o app não envia o token: cadastro, login e recuperação passam a ser recusados — ninguém entra'
        : !lig ? 'força bruta fica só com o limite por IP (limite-login-ativo); captcha exige mudança no app — decisão, ver AUTH-HOSPEDADO.md' : '' })
  } else nv('captcha-coerente', 'captcha', ['security_captcha_enabled'])

  if (tem('password_hibp_enabled')) {
    add({ id: 'senha-vazada', titulo: 'recusa senha que já vazou (HaveIBeenPwned)', obrigatorio: false,
      resultado: cfg.password_hibp_enabled === true ? PASS : FAIL, valor: cfg.password_hibp_enabled, esperado: 'true (recurso do plano Pro)' })
  }

  // --- tokens e sessões ---
  if (tem('jwt_exp')) {
    add({ id: 'jwt-expiracao', titulo: 'access token expira em até 1 h', resultado: cfg.jwt_exp > 0 && cfg.jwt_exp <= 3600 ? PASS : FAIL,
      valor: cfg.jwt_exp, esperado: '≤ 3600 s', nota: cfg.jwt_exp > 3600 ? 'o token continua valendo depois do logout até expirar (Go/No-Go, BAIXO): mais tempo, janela maior' : '' })
  } else nv('jwt-expiracao', 'expiração do access token', ['jwt_exp'])

  if (tem('refresh_token_rotation_enabled')) {
    const reuso = cfg.security_refresh_token_reuse_interval
    const ok = cfg.refresh_token_rotation_enabled === true && Number.isFinite(reuso) && reuso <= 10
    add({ id: 'refresh-rotacao', titulo: 'refresh token com rotação (reuso ≤ 10 s)', resultado: ok ? PASS : FAIL,
      valor: { rotacao: cfg.refresh_token_rotation_enabled, reuso_s: reuso ?? null }, esperado: 'rotação ligada, reuso ≤ 10 s' })
  } else nv('refresh-rotacao', 'rotação do refresh token', ['refresh_token_rotation_enabled'])

  // --- site_url e redirects ---
  if (tem('site_url')) {
    const h = hostDe(cfg.site_url)
    const problemas = []
    if (!h) problemas.push('não é URL')
    else {
      if (ehLocal(h.host)) problemas.push('aponta para localhost: o link do e-mail abre na máquina da pessoa')
      if (h.esquema !== 'https') problemas.push('não é https')
      if (ctx.pilotoHost && h.host !== ctx.pilotoHost) problemas.push(`host ${h.host} ≠ domínio do piloto`)
    }
    add({ id: 'site-url', titulo: 'site_url = domínio do piloto (monta os links de confirmação e recuperação)',
      resultado: problemas.length ? FAIL : ctx.pilotoHost ? PASS : NV, valor: cfg.site_url,
      esperado: ctx.pilotoHost ? `https://${ctx.pilotoHost}` : 'informe PILOTO_DOMINIO para decidir',
      nota: problemas.join('; ') })
  } else nv('site-url', 'site_url', ['site_url'])

  if (tem('uri_allow_list')) {
    const lista = String(cfg.uri_allow_list || '').split(',').map((s) => s.trim()).filter(Boolean)
    const problemas = []
    for (const e of lista) {
      if (ctx.extras.some((x) => e === x || e.startsWith(x))) continue
      const h = hostDe(e)
      if (!h) { problemas.push(`"${e}" não é URL`); continue }
      if (h.host.includes('*')) problemas.push(`"${e}" tem curinga no host (qualquer subdomínio recebe o token)`)
      else if (ehLocal(h.host)) problemas.push(`"${e}" aponta para localhost`)
      else if (h.esquema !== 'https') problemas.push(`"${e}" não é https`)
      else if (ctx.pilotoHost && h.host !== ctx.pilotoHost) problemas.push(`"${e}" é de outro domínio`)
    }
    const sh = hostDe(cfg.site_url || '')
    const novaSenha = (sh && ctx.pilotoHost && sh.host === ctx.pilotoHost) || lista.some((e) => /\/nova-senha\/?$/.test(e) || e.endsWith('/**'))
    add({ id: 'redirects-so-piloto', titulo: 'redirects só para o domínio do piloto', resultado: problemas.length ? FAIL : ctx.pilotoHost ? PASS : NV,
      valor: { lista, nova_senha_coberto: Boolean(novaSenha) }, esperado: ctx.pilotoHost ? `só https://${ctx.pilotoHost}/…` + (ctx.extras.length ? ` e ${ctx.extras.join(', ')}` : '') : 'informe PILOTO_DOMINIO para decidir',
      nota: problemas.join('; ') })
  } else nv('redirects-so-piloto', 'redirects', ['uri_allow_list'])

  // --- templates ---
  // O app não tem rota de verifyOtp: confirmação e recuperação só funcionam com o link pronto do
  // GoTrue ({{ .ConfirmationURL }}). Um template "caprichado" que monte o link com {{ .TokenHash }}
  // manda a pessoa para uma tela que não existe.
  const TIPOS = [
    ['confirmation', 'template-confirmacao-pt', 'e-mail de confirmação de cadastro em pt-BR', true, /\{\{\s*\.ConfirmationURL\s*\}\}/],
    ['recovery', 'template-recuperacao-pt', 'e-mail de recuperação de senha em pt-BR', true, /\{\{\s*\.ConfirmationURL\s*\}\}/],
    ['invite', 'template-convite-pt', 'e-mail de convite (Auth) em pt-BR', false, /\{\{\s*\.(ConfirmationURL|TokenHash|Token)\s*\}\}/],
    ['magic_link', 'template-magic-link-pt', 'e-mail de link mágico em pt-BR', false, /\{\{\s*\.(ConfirmationURL|TokenHash|Token)\s*\}\}/],
    ['email_change', 'template-troca-email-pt', 'e-mail de troca de endereço em pt-BR', false, /\{\{\s*\.(ConfirmationURL|TokenHash|Token)\s*\}\}/],
  ]
  for (const [tipo, id, titulo, obrigatorio, reLink] of TIPOS) {
    const kAss = `mailer_subjects_${tipo}`; const kCorpo = `mailer_templates_${tipo}_content`
    if (!tem(kAss) && !tem(kCorpo)) { nv(id, titulo, [kAss, kCorpo], obrigatorio); continue }
    const assunto = cfg[kAss] || ''; const corpo = cfg[kCorpo] || ''
    const iAss = assunto ? idiomaDe(assunto) : 'en'           // vazio = o padrão do Supabase, em inglês
    const iCorpo = corpo ? idiomaDe(corpo) : 'en'
    const linkOk = corpo ? reLink.test(corpo) : true
    const indef = iAss === 'indefinido' || iCorpo === 'indefinido'
    const ok = iAss === 'pt' && iCorpo === 'pt' && linkOk
    add({ id, titulo, obrigatorio, resultado: ok ? PASS : !linkOk ? FAIL : indef ? NV : FAIL,
      valor: { assunto: assunto || '(padrão do Supabase)', idioma_assunto: iAss, idioma_corpo: corpo ? iCorpo : 'en (padrão)', personalizado: Boolean(corpo), link_ok: linkOk },
      esperado: 'assunto e corpo em português, com {{ .ConfirmationURL }}',
      nota: !linkOk ? 'o corpo não tem o link que o app sabe receber' : indef ? 'a heurística não decidiu o idioma: leia o template no painel' : '' })
  }
}

// Os critérios da camada pública (/auth/v1/settings), com o cruzamento com a gestão quando houver.
export function avaliarPublico(saude, conf, cfg, add) {
  const respondeu = saude.status === 200 && conf.status === 200 && conf.json
  add({ id: 'auth-responde', titulo: 'Auth do projeto responde (/auth/v1/health e /settings)', resultado: respondeu ? PASS : FAIL,
    valor: respondeu ? `GoTrue ${saude.json?.version || '?'}` : `health ${saude.status} · settings ${conf.status}`,
    nota: respondeu ? '' : (conf.erro || saude.erro || '') })
  const s = respondeu ? conf.json : null
  const temG = (k) => cfg && Object.prototype.hasOwnProperty.call(cfg, k)

  // confirmação: as duas fontes, e elas têm de concordar
  const pub = s ? s.mailer_autoconfirm : undefined
  const ges = temG('mailer_autoconfirm') ? cfg.mailer_autoconfirm : undefined
  if (pub === undefined && ges === undefined) add({ id: 'confirmacao-email', titulo: 'confirmação de e-mail obrigatória', resultado: NV, nota: 'nem /settings nem a API de gestão responderam' })
  else {
    const valores = [pub, ges].filter((v) => v !== undefined)
    const ok = valores.every((v) => v === false)
    add({ id: 'confirmacao-email', titulo: 'confirmação de e-mail obrigatória', resultado: ok ? PASS : FAIL,
      valor: { mailer_autoconfirm_publico: pub ?? null, mailer_autoconfirm_gestao: ges ?? null }, esperado: 'mailer_autoconfirm = false',
      nota: ok ? 'ligada: sem ela o e-mail de qualquer terceiro vira conta ativa (B5). Efeito sobre crianças sem e-mail: MENORES-E-EMAIL.md'
        : 'desligada: reabre o B5 — decisão que precisa estar registrada (MENORES-E-EMAIL.md)' })
  }

  if (s) {
    const ext = s.external || {}
    const ligados = Object.entries(ext).filter(([k, v]) => v === true && k !== 'email').map(([k]) => k)
    if (s.saml_enabled) ligados.push('saml')
    if (s.passkeys_enabled) ligados.push('passkeys')
    const ok = ext.email === true && ligados.length === 0
    add({ id: 'metodos-de-entrada', titulo: 'só e-mail + senha (o único método que o app usa)', resultado: ok ? PASS : FAIL,
      valor: { email: ext.email === true, outros_ligados: ligados }, esperado: 'email ligado; anônimo, telefone, OAuth e SAML desligados',
      nota: ok ? '' : ext.email !== true ? 'e-mail desligado: ninguém entra' : 'método ligado que o app não usa é superfície de ataque sem dono' })
    add({ id: 'cadastro-aberto', titulo: 'cadastro público aberto (a criança cria a própria conta)', resultado: s.disable_signup === false ? PASS : FAIL,
      valor: { disable_signup: s.disable_signup }, esperado: 'disable_signup = false' })
  } else {
    add({ id: 'metodos-de-entrada', titulo: 'só e-mail + senha', resultado: NV, nota: '/auth/v1/settings não respondeu' })
    add({ id: 'cadastro-aberto', titulo: 'cadastro público aberto', resultado: NV, nota: '/auth/v1/settings não respondeu' })
  }
}

// O que é só REGISTRO (sem critério): valores efetivos que o dono precisa ver, mas cuja escolha é
// de produto. Lista branca — nada fora dela sai da resposta da API.
function registroDaGestao(cfg) {
  const k = ['site_url', 'uri_allow_list', 'jwt_exp', 'disable_signup', 'mailer_autoconfirm', 'mailer_otp_exp', 'mailer_otp_length',
    'mailer_secure_email_change_enabled', 'password_min_length', 'password_hibp_enabled', 'security_update_password_require_reauthentication',
    'refresh_token_rotation_enabled', 'security_refresh_token_reuse_interval', 'sessions_timebox', 'sessions_inactivity_timeout',
    'sessions_single_per_user', 'rate_limit_email_sent', 'rate_limit_sms_sent', 'rate_limit_otp', 'rate_limit_verify',
    'rate_limit_token_refresh', 'rate_limit_anonymous_users', 'rate_limit_web3', 'security_captcha_enabled', 'security_captcha_provider',
    'smtp_host', 'smtp_port', 'smtp_sender_name', 'smtp_max_frequency', 'external_email_enabled', 'external_phone_enabled',
    'external_anonymous_users_enabled', 'sms_autoconfirm', 'security_manual_linking_enabled',
    'mailer_subjects_confirmation', 'mailer_subjects_recovery', 'mailer_subjects_invite', 'mailer_subjects_magic_link',
    'mailer_subjects_email_change', 'mailer_subjects_reauthentication']
  const r = {}
  for (const c of k) if (cfg && Object.prototype.hasOwnProperty.call(cfg, c)) r[c] = cfg[c]
  if (cfg && Object.prototype.hasOwnProperty.call(cfg, 'password_required_characters')) r.password_required_characters = exigenciaDeSenha(cfg.password_required_characters)
  if (cfg && Object.prototype.hasOwnProperty.call(cfg, 'smtp_admin_email')) r.smtp_admin_email = mascararEmail(cfg.smtp_admin_email)
  for (const t of ['confirmation', 'recovery', 'invite', 'magic_link', 'email_change', 'reauthentication']) {
    const c = `mailer_templates_${t}_content`
    if (cfg && Object.prototype.hasOwnProperty.call(cfg, c)) r[`${c}_idioma`] = cfg[c] ? idiomaDe(cfg[c]) : 'en (padrão)'
  }
  return r
}

// Os critérios da camada de gestão, para as linhas NAO-VERIFICAVEL quando ela não responde.
const CRITERIOS_DE_GESTAO = [
  ['senha-politica', 'política de senha = a do app (8+, letras e números)', true],
  ['troca-de-senha-segura', 'troca de senha exige sessão recente', true],
  ['limite-login-ativo', 'limite de cadastro+login por IP ativo (força bruta)', true],
  ['limite-comporta-reuniao', 'limite comporta uma reunião no mesmo Wi-Fi em 5 min', true],
  ['smtp-proprio', 'SMTP próprio configurado', true],
  ['limite-emails', 'cota de e-mail comporta o dia do cadastro', true],
  ['captcha-coerente', 'captcha coerente com o app', true],
  ['jwt-expiracao', 'access token expira em até 1 h', true],
  ['refresh-rotacao', 'refresh token com rotação (reuso ≤ 10 s)', true],
  ['site-url', 'site_url = domínio do piloto', true],
  ['redirects-so-piloto', 'redirects só para o domínio do piloto', true],
  ['template-confirmacao-pt', 'e-mail de confirmação de cadastro em pt-BR', true],
  ['template-recuperacao-pt', 'e-mail de recuperação de senha em pt-BR', true],
  ['troca-de-email-dupla', 'troca de e-mail confirmada nos dois endereços', false],
  ['limite-verificacao', 'limite de verificação (clique no link) por IP', false],
  ['senha-vazada', 'recusa senha que já vazou (HaveIBeenPwned)', false],
  ['template-convite-pt', 'e-mail de convite (Auth) em pt-BR', false],
  ['template-magic-link-pt', 'e-mail de link mágico em pt-BR', false],
  ['template-troca-email-pt', 'e-mail de troca de endereço em pt-BR', false],
]

// O app envia captchaToken em algum lugar? (varre src/ — é o que decide se ligar o captcha quebra o login)
function appEnviaCaptcha(raiz = 'src') {
  const varrer = (dir) => {
    for (const nome of readdirSync(dir)) {
      const p = join(dir, nome)
      if (statSync(p).isDirectory()) { if (varrer(p)) return true; continue }
      if (/\.(jsx?|tsx?|mjs)$/.test(nome) && !/\.test\./.test(nome) && readFileSync(p, 'utf8').includes('captchaToken')) return true
    }
    return false
  }
  try { return varrer(raiz) } catch { return false }
}

// -----------------------------------------------------------------------------
//  principal
// -----------------------------------------------------------------------------
async function principal(args) {
  let url = process.env.SUPABASE_URL || ''
  let anon = process.env.SUPABASE_ANON_KEY || process.env.ANON_KEY || ''
  if (args['env-arquivo']) {
    const v = lerEnv(args['env-arquivo'])
    url = v.VITE_SUPABASE_URL || v.SUPABASE_URL || ''
    anon = v.VITE_SUPABASE_ANON_KEY || v.SUPABASE_ANON_KEY || ''
    if (!url) { console.error(`${args['env-arquivo']}: sem VITE_SUPABASE_URL`); return 3 }
  }
  if (!url || !anon) {
    console.error('Faltou SUPABASE_URL e SUPABASE_ANON_KEY (ou --env-arquivo <arquivo>). Ver o cabeçalho deste script.')
    return 3
  }
  const token = process.env.SUPABASE_ACCESS_TOKEN || ''
  let ref = process.env.PROJECT_REF || ''

  // A GUARDA vem antes de qualquer rede.
  let guarda
  try { guarda = conferirAlvo(url, { ref }) } catch (e) {
    if (e instanceof Recusa) { console.error(e.message); return 3 }
    throw e
  }
  ref = ref || guarda.alvo.ref || ''
  const piloto = normalizar(args.dominio || process.env.PILOTO_DOMINIO || '')
  const ctx = {
    pilotoHost: piloto?.host || '',
    extras: String(process.env.AUTH_REDIRECT_EXTRA || '').split(/[\s,]+/).filter(Boolean),
    loginsPorIp: Number(process.env.AUTH_LOGINS_POR_IP || 60),
    emailsPorHora: Number(process.env.AUTH_EMAILS_POR_HORA || 60),
    frontEnviaCaptcha: appEnviaCaptcha(),
  }
  const soJson = Boolean(args.json)
  const log = soJson ? () => {} : (...a) => console.log(...a)
  const base = guarda.alvo.origin
  log(`\n== Auth hospedado — ${base}${guarda.local ? '  (LOCAL: a camada de gestão não se aplica)' : ''}`)
  log(`   guarda: ${guarda.bloqueios.length} endereço(s) de produção conhecido(s) — alvo não é nenhum deles`)

  // --- camada pública ---
  const cab = { apikey: anon, Authorization: `Bearer ${anon}` }
  const saude = await obterJson(`${base}/auth/v1/health`, cab)
  const conf = await obterJson(`${base}/auth/v1/settings`, cab)

  // --- camada de gestão ---
  let cfg = null
  let gestaoInfo
  if (guarda.local) gestaoInfo = { status: 'nao-se-aplica', motivo: 'alvo local: não existe Management API para o Supabase do Docker' }
  else if (!token) gestaoInfo = { status: 'sem-token', motivo: 'SUPABASE_ACCESS_TOKEN não informado' }
  else if (!ref) gestaoInfo = { status: 'sem-ref', motivo: 'PROJECT_REF não informado e a URL não é <ref>.supabase.co' }
  else {
    const r = await gestao(ref, '/config/auth', token)
    if (r.status === 200 && r.json) { cfg = r.json; gestaoInfo = { status: 'ok' } }
    else gestaoInfo = { status: `http-${r.status}`, motivo: r.status === 401 ? 'token recusado' : r.status === 403 ? 'token sem acesso a este projeto' : r.status === 404 ? 'projeto não encontrado' : (r.erro || 'falhou') }
  }

  const { criterios, add } = novoRelatorio()
  avaliarPublico(saude, conf, cfg, add)
  if (cfg) avaliarGestao(cfg, ctx, add)
  else {
    // mesmos ids e títulos, para o relatório ter sempre as mesmas linhas com ou sem token
    for (const [id, titulo, obrigatorio] of CRITERIOS_DE_GESTAO) add({ id, titulo, obrigatorio, resultado: NV, nota: gestaoInfo.motivo })
  }
  const resumo = resumir(criterios)

  const s = conf.json || {}
  const saida = {
    ferramenta: 'scripts/verificar-auth-hospedado.mjs', formato: 1, quando: new Date().toISOString(),
    alvo: { origem: base, ref: ref || null, local: guarda.local, piloto_dominio: ctx.pilotoHost || null },
    guarda: { producao_conhecida: guarda.bloqueios.length, recusou: false },
    gotrue: saude.json?.version || null,
    publico: conf.status === 200 ? { external: s.external, disable_signup: s.disable_signup, mailer_autoconfirm: s.mailer_autoconfirm,
      phone_autoconfirm: s.phone_autoconfirm, sms_provider: s.sms_provider, saml_enabled: s.saml_enabled, passkeys_enabled: s.passkeys_enabled }
      : { status: conf.status, erro: conf.erro },
    gestao: { ...gestaoInfo, registro: cfg ? registroDaGestao(cfg) : null },
    parametros: { AUTH_LOGINS_POR_IP: ctx.loginsPorIp, AUTH_EMAILS_POR_HORA: ctx.emailsPorHora, AUTH_REDIRECT_EXTRA: ctx.extras, app_envia_captchaToken: ctx.frontEnviaCaptcha },
    criterios, resumo,
  }

  if (!soJson) {
    log(`   camada pública: health ${saude.status} · settings ${conf.status}${saude.json?.version ? ` · GoTrue ${saude.json.version}` : ''}`)
    log(`   camada de gestão: ${gestaoInfo.status}${gestaoInfo.motivo ? ` (${gestaoInfo.motivo})` : ''}\n`)
    imprimirCriterios(criterios)
    log(`\nobrigatórios: ${resumo.obrigatorios.PASS} PASS · ${resumo.obrigatorios.FAIL} FAIL · ${resumo.obrigatorios[NV]} NAO-VERIFICAVEL`)
    log(`VEREDITO: ${resumo.veredito}${resumo.veredito !== 'VERDE' ? ' — o item 5 só fica verde com todos os obrigatórios em PASS no projeto do piloto' : ''}\n`)
    log('--- JSON ---')
  }
  const texto = JSON.stringify(saida, null, 2)
  // última barreira: nada com cara de chave/token sai daqui, nem na tela nem no arquivo
  if (texto.includes(anon) || (token && texto.includes(token)) || /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/.test(texto) || /sbp_[A-Za-z0-9]{8,}/.test(texto)) {
    console.error('RECUSADO: a saída conteria algo com cara de chave ou token. Nada foi impresso nem gravado.')
    return 3
  }
  console.log(texto)
  if (args.saida) { writeFileSync(args.saida, `${texto}\n`); if (!soJson) console.error(`\n(gravado em ${args.saida})`) }
  return resumo.codigo_saida
}

// -----------------------------------------------------------------------------
//  --autoteste: as heurísticas e a guarda, sem nenhuma requisição
// -----------------------------------------------------------------------------
function autoteste() {
  let falhas = 0
  const ok = (nome, cond) => { console.log(`${cond ? 'OK    ' : 'FALHOU'} ${nome}`); if (!cond) falhas++ }

  ok('idioma: padrão do Supabase (confirmação) é en', idiomaDe('Confirm Your Signup') === 'en')
  ok('idioma: corpo padrão é en', idiomaDe('<h2>Confirm your signup</h2><p>Follow this link to confirm your user:</p><p><a href="{{ .ConfirmationURL }}">Confirm your mail</a></p>') === 'en')
  ok('idioma: assunto pt', idiomaDe('Confirme seu cadastro') === 'pt')
  ok('idioma: recuperação pt', idiomaDe('Redefinir sua senha') === 'pt')
  ok('idioma: corpo pt', idiomaDe('<h2>Olá!</h2><p>Clique no link abaixo para confirmar o seu e-mail:</p><a href="{{ .ConfirmationURL }}">Confirmar</a>') === 'pt')
  ok('idioma: vazio é indefinido', idiomaDe('') === 'indefinido')
  ok('senha: letters_digits', exigenciaDeSenha('abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ:0123456789') === 'letters_digits')
  ok('senha: lower_upper', exigenciaDeSenha('abcdefghijklmnopqrstuvwxyz:ABCDEFGHIJKLMNOPQRSTUVWXYZ:0123456789') === 'lower_upper_letters_digits')
  ok('senha: nenhuma', exigenciaDeSenha('') === 'nenhuma')

  // guarda
  const antes = process.env.AUTH_VERIFICAR_BLOQUEAR
  const prodFalsa = 'https://abcdefghijabcdefghij.supabase.co'
  process.env.AUTH_VERIFICAR_BLOQUEAR = prodFalsa
  const recusa = (f) => { try { f(); return false } catch (e) { return e instanceof Recusa } }
  ok('guarda: recusa a URL de produção', recusa(() => conferirAlvo(prodFalsa)))
  ok('guarda: recusa com barra e maiúsculas', recusa(() => conferirAlvo('HTTPS://ABCDEFGHIJABCDEFGHIJ.supabase.co/')))
  ok('guarda: recusa PROJECT_REF da produção com outra URL', recusa(() => conferirAlvo('https://piloto.exemplo.org', { ref: 'abcdefghijabcdefghij' })))
  ok('guarda: recusa URL e ref de projetos diferentes', recusa(() => conferirAlvo('https://zyxwvutsrqzyxwvutsrq.supabase.co', { ref: 'qqqqqqqqqqqqqqqqqqqq' })))
  ok('guarda: aceita outro projeto', !recusa(() => conferirAlvo('https://zyxwvutsrqzyxwvutsrq.supabase.co')))
  ok('guarda: aceita o staging local', conferirAlvo('http://127.0.0.1:55321').local === true)
  process.env.AUTH_VERIFICAR_BLOQUEAR = 'isto-nao-e-url'
  ok('guarda: item inválido na lista é recusa, não silêncio', recusa(() => conferirAlvo('https://zyxwvutsrqzyxwvutsrq.supabase.co')))
  delete process.env.AUTH_VERIFICAR_BLOQUEAR
  // a produção de verdade, lida do .env deste repositório/checkout principal (sem rede nenhuma)
  let real = []
  try { real = conferirAlvo('http://127.0.0.1:1').bloqueios.filter((b) => b.origem !== 'AUTH_VERIFICAR_BLOQUEAR') } catch { real = [] }
  if (real.length) ok(`guarda: recusa a produção real lida de ${real[0].origem.replace(/^.*[\\/]/, '')}`, recusa(() => conferirAlvo(real[0].origin || real[0].ref)))
  else console.log('·      (nenhum .env de produção nesta máquina: o caso "produção real" não foi exercitado)')
  if (antes !== undefined) process.env.AUTH_VERIFICAR_BLOQUEAR = antes

  // avaliação com uma config boa e uma ruim (formato da Management API)
  const boa = {
    password_min_length: 8, password_required_characters: 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ:0123456789',
    security_update_password_require_reauthentication: true, mailer_secure_email_change_enabled: true,
    rate_limit_otp: 90, rate_limit_token_refresh: 150, rate_limit_verify: 60, rate_limit_email_sent: 100,
    smtp_host: 'smtp.exemplo.org', smtp_port: '587', smtp_admin_email: 'nao-responda@exemplo.org', smtp_sender_name: 'Clube', smtp_pass: 'x',
    security_captcha_enabled: false, password_hibp_enabled: true, jwt_exp: 3600, refresh_token_rotation_enabled: true,
    security_refresh_token_reuse_interval: 10, site_url: 'https://app.exemplo.org', uri_allow_list: 'https://app.exemplo.org/nova-senha',
    mailer_autoconfirm: false,
    mailer_subjects_confirmation: 'Confirme seu cadastro', mailer_templates_confirmation_content: '<p>Olá! Clique no link abaixo para confirmar o seu e-mail: <a href="{{ .ConfirmationURL }}">confirmar</a></p>',
    mailer_subjects_recovery: 'Redefinir sua senha', mailer_templates_recovery_content: '<p>Você pediu uma nova senha. Clique aqui: <a href="{{ .ConfirmationURL }}">criar nova senha</a></p>',
    mailer_subjects_invite: 'Você recebeu um convite', mailer_templates_invite_content: '<p>Olá, você foi convidado. Clique para aceitar: {{ .ConfirmationURL }}</p>',
    mailer_subjects_magic_link: 'Seu link de acesso', mailer_templates_magic_link_content: '<p>Clique no link abaixo para entrar na sua conta: {{ .ConfirmationURL }}</p>',
    mailer_subjects_email_change: 'Confirme a troca de e-mail', mailer_templates_email_change_content: '<p>Clique para confirmar a troca do seu endereço de e-mail: {{ .ConfirmationURL }}</p>',
  }
  const ctx = { pilotoHost: 'app.exemplo.org', extras: [], loginsPorIp: 60, emailsPorHora: 60, frontEnviaCaptcha: false }
  const rb = novoRelatorio(); avaliarGestao(boa, ctx, rb.add)
  const naoPass = rb.criterios.filter((c) => c.resultado !== PASS).map((c) => c.id)
  ok(`config boa: todos PASS${naoPass.length ? ` (não: ${naoPass.join(', ')})` : ''}`, naoPass.length === 0)
  const avaliados = rb.criterios.map((c) => `${c.id}:${c.obrigatorio}`).sort().join()
  ok('as linhas NAO-VERIFICAVEL sem token são os mesmos critérios (e obrigatoriedade) da avaliação', avaliados === CRITERIOS_DE_GESTAO.map(([i, , o]) => `${i}:${o}`).sort().join())

  const ruim = {
    ...boa, password_min_length: 6, password_required_characters: '', rate_limit_otp: 30, smtp_host: '', smtp_admin_email: '',
    security_captcha_enabled: true, jwt_exp: 7200, site_url: 'http://127.0.0.1:3000',
    uri_allow_list: 'https://*.vercel.app/**,http://localhost:4173,https://outro.exemplo.org',
    mailer_subjects_confirmation: 'Confirm Your Signup', mailer_templates_confirmation_content: '',
    mailer_templates_recovery_content: '<p>Clique aqui para criar sua senha: {{ .SiteURL }}/nova-senha?t={{ .TokenHash }}</p>',
  }
  const rr = novoRelatorio(); avaliarGestao(ruim, ctx, rr.add)
  const r = Object.fromEntries(rr.criterios.map((c) => [c.id, c.resultado]))
  for (const id of ['senha-politica', 'limite-comporta-reuniao', 'smtp-proprio', 'limite-emails', 'captcha-coerente', 'jwt-expiracao',
    'site-url', 'redirects-so-piloto', 'template-confirmacao-pt', 'template-recuperacao-pt']) ok(`config ruim: ${id} = FAIL`, r[id] === FAIL)
  ok('config ruim: limite-login-ativo continua PASS (30 é ativo; só não comporta a reunião)', r['limite-login-ativo'] === PASS)

  const semCampos = novoRelatorio(); avaliarGestao({}, ctx, semCampos.add)
  ok('resposta sem os campos: NAO-VERIFICAVEL, nunca PASS', semCampos.criterios.every((c) => c.resultado === NV))

  // camada pública, com a resposta do staging local (formato do GoTrue v2.196)
  const pub = { status: 200, json: { external: { email: true, phone: false, anonymous_users: false, google: false }, disable_signup: false, mailer_autoconfirm: false } }
  const rp = novoRelatorio(); avaliarPublico({ status: 200, json: { version: 'v2' } }, pub, null, rp.add)
  ok('pública: staging-like passa', rp.criterios.every((c) => c.resultado === PASS))
  const rp2 = novoRelatorio(); avaliarPublico({ status: 200, json: {} }, { status: 200, json: { ...pub.json, mailer_autoconfirm: true } }, { mailer_autoconfirm: false }, rp2.add)
  ok('pública: fontes discordando é FAIL', rp2.criterios.find((c) => c.id === 'confirmacao-email').resultado === FAIL)

  console.log(falhas ? `\n${falhas} FALHA(S)` : '\nautoteste OK')
  return falhas ? 1 : 0
}

const args = lerArgs(process.argv.slice(2), ['json', 'autoteste'])
const codigo = args.autoteste ? autoteste() : await principal(args)
process.exit(codigo)
