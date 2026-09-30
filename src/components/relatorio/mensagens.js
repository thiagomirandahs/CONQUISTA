import { mensagemDeErro } from '../../ui/index.jsx'

// Mensagens que JÁ SÃO escritas para a criança (validação do formulário no servidor: "Formulário incompleto: …";
// validação de foto no upload: "Esse arquivo não é uma foto válida…"). Essas passam como estão — dizem o que
// falta. Qualquer outra falha (rede, permissão, sessão) segue pela tradução padrão do app.
const JA_HUMANA = /^(Formulário( incompleto)?:|Esse arquivo |Essa foto |Aqui só aceitamos|Escolha uma foto|Arquivo muito pesado|Envie a foto)/

export function textoDoErro(erro, contexto) {
  const bruto = typeof erro === 'string' ? erro : (erro?.message || '')
  if (JA_HUMANA.test(bruto)) return bruto
  return mensagemDeErro(erro, contexto)
}
