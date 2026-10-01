// Registro da entrega de atividade, com limpeza do arquivo recém-enviado se o registro falhar.
// Extraído de Atividades.jsx para poder ser testado. (O ENVIO do arquivo continua em Atividades.jsx, com
// subirComprovacao com vídeo liberado: é o único ponto de vídeo declarado em uploadsMidia.contract.test.js.)
//
// Por que existe a limpeza: a investigação dos órfãos de 01/10/2026 achou 13 arquivos de `comprovacoes/<uid>/atividades/`
// sem nenhuma linha apontando para eles — o mesmo vídeo/foto enviado 2 a 3 vezes em segundos pela mesma pessoa e, no dia 04/09,
// fotos de 6 pessoas sem entrega registrada. É o padrão "o upload passou, o registro falhou, a pessoa tocou de novo": cada
// toque sobe uma cópia nova (o nome tem Date.now()) e a anterior fica sem dono. Aqui, se o registro da entrega falhar, o arquivo
// que ACABOU de subir é descartado antes de o erro voltar para a pessoa (o servidor só deixa o dono apagar o que ninguém
// referencia — migration 173; falha da limpeza nunca esconde o erro real).
import { supabase } from '../lib/supabase.js'
import { comComprovacao } from '../lib/upload.js'

export async function registrarEntregaAtividade({ atividadeId, userId, texto, fotoUrl }) {
  const registrar = async () => {
    // upsert: primeira entrega = insere; reenvio (após reprovar) = volta pra 'pendente'
    const { error } = await supabase.from('entregas').upsert({
      atividade_id: atividadeId, usuario_id: userId,
      texto: texto || null, foto_url: fotoUrl || null, status: 'pendente', feedback: null,
    }, { onConflict: 'atividade_id,usuario_id' })
    if (error) throw new Error(error.message)
  }
  return fotoUrl ? comComprovacao(fotoUrl, registrar) : registrar()
}
