// Serviço: convite de EQUIPE — como uma pessoa que já tem conta entra num SEGUNDO clube.
//
// Este é o caminho que faltava no produto até a fase 8.4. O DesbravaClube é vendido como
// multi-clube, o banco modela isso certo e a RLS trata certo — mas só três funções inseriam em
// `organization_memberships` (o cadastro, o onboarding do fundador e um espelho interno), e a
// tabela não tem policy de INSERT. Nenhuma pessoa já cadastrada conseguia entrar num segundo
// clube: o fundador de um clube novo não conseguia trazer um instrutor que já tivesse conta.
//
// A etapa "equipe" do onboarding já gravava convites, e a tabela já tinha as colunas `aceito_por` e
// `aceito_em` — a aceitação foi desenhada e nunca implementada. As RPCs nasceram na migration 61 e
// ganharam prazo na 66; estas funções são a ponta da interface.
import { supabase } from '../lib/supabase.js'

// Quem a liderança convidou para a equipe DESTE clube (inclui vencidos e cancelados, com a
// situação já resolvida pelo servidor — "vencido" é um estado, não um status guardado).
export async function convitesDoClube() {
  const { data, error } = await supabase.rpc('convites_do_clube')
  if (error) throw error
  return data || []
}

// Os convites pendentes DIRIGIDOS A MIM, casados pelo e-mail da minha conta. Um convite é nominal:
// saber o id de um convite alheio não dá acesso a nada.
export async function meusConvites() {
  const { data, error } = await supabase.rpc('convites_da_equipe')
  if (error) throw error
  return data || []
}

// `cargo` (Capelão, Secretária, Diretor Associado…) decide o nível de acesso NO SERVIDOR; `papel` é o
// jeito antigo (sem cargo) e continua aceito.
export async function convidarParaEquipe(email, papel, cargo = null) {
  const args = { p_email: email, p_papel: papel }
  if (cargo) args.p_cargo = cargo
  const { data, error } = await supabase.rpc('convite_equipe_criar', args)
  if (error) throw error
  return data
}

// Aceitar cria o vínculo no clube DO CONVITE — nunca no clube que esta aba está usando. Quem clica
// num link que chegou por e-mail costuma estar com outra aba aberta.
export async function aceitarConvite(id) {
  const { data, error } = await supabase.rpc('convite_equipe_aceitar', { p_id: id })
  if (error) throw error
  return data
}

export async function revogarConvite(id) {
  const { data, error } = await supabase.rpc('convite_equipe_revogar', { p_id: id })
  if (error) throw error
  return data
}
