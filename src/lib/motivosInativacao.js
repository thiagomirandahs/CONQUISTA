// Motivos de inativação de membro (migration 310). O servidor (vinculo_inativar) confere a mesma
// lista; "outro" exige texto. Módulo puro: sem Supabase, pode ser importado em qualquer tela/teste.
export const MOTIVOS_INATIVACAO = [
  { valor: 'mudou_cidade_igreja', rotulo: 'Mudou de cidade ou de igreja' },
  { valor: 'saiu_do_clube', rotulo: 'Saiu do clube' },
  { valor: 'idade_transferencia', rotulo: 'Idade / transferência (outra classe ou clube)' },
  { valor: 'faltas', rotulo: 'Faltas' },
  { valor: 'disciplina', rotulo: 'Disciplina' },
  { valor: 'pedido_familia', rotulo: 'A pedido da família' },
  { valor: 'outro', rotulo: 'Outro' },
]
export const ROTULO_MOTIVO = {
  ...Object.fromEntries(MOTIVOS_INATIVACAO.map((m) => [m.valor, m.rotulo])),
  voltou_ao_clube: 'Voltou ao clube', nao_informado: 'Motivo não informado',
}
export const ROTULO_ACAO = { inativado: 'Desativado', suspenso: 'Suspenso', encerrado: 'Encerrado', reativado: 'Reativado' }
export const MOTIVO_TEXTO_MAX = 280
