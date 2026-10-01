// Relato / comprovação complementar (migration 520): regras puras compartilhadas por Classes e Especialidades.
// O relato é OPCIONAL e COMPLEMENTAR: nunca substitui a evidência do requisito nem vira obrigação.
export const LIMITE_RELATO = 2000
export const CAMPOS_RELATO = [{ chave: 'relato', tipo: 'texto_longo' }] // reaproveita limparConteudo/rascunho local

// Banco SEM a 520: a RPC não existe. A tela esconde o bloco e segue como sempre.
export class RelatoIndisponivel extends Error {
  constructor() { super('Relato indisponível neste servidor.'); this.name = 'RelatoIndisponivel' }
}
export const ehRelatoIndisponivel = (error) => !!error && (
  error.code === 'PGRST202' || error.code === '42883' || /could not find the function|schema cache/i.test(error.message || '')
)

// O payload só traz a chave `relato` (mesmo null) quando o banco tem a 520.
export const temRelato = (obj) => !!obj && typeof obj === 'object' && 'relato' in obj
