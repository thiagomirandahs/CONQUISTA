-- Cantinho da unidade (migration 260) na LIXEIRA de membros inativos (migration 221): o que é da
-- PESSOA no cantinho (ajuda aos pais, justificativa de falta e — principalmente — os pedidos de oração
-- da criança) sai junto com ela quando o vínculo inativo vai para a lixeira, e volta se for recuperado.
-- Caixa, reuniões e planejamento são da UNIDADE (lancado_por/criado_por viram nulo se a pessoa sumir).
-- Mesmo catálogo da 221, com três linhas a mais (a ajuda vem antes de pontos: ela aponta para o ponto).
create or replace function public._lixeira_catalogo()
returns table (ordem int, tabela text, filtro text, imutavel boolean)
language sql immutable set search_path = '' as $$
  values
    (10,  'requirement_approvals', 'club_id = $1 and (member_requirement_id in (select id from public.member_requirements where club_id = $1 and usuario_id = $2) or member_specialty_requirement_id in (select id from public.member_specialty_requirements where club_id = $1 and usuario_id = $2) or submission_id in (select id from public.requirement_submissions where club_id = $1 and usuario_id = $2))', false),
    (20,  'requirement_submissions', 'club_id = $1 and usuario_id = $2', true),
    (30,  'member_requirement_options', 'club_id = $1 and usuario_id = $2', false),
    (40,  'member_requirements', 'club_id = $1 and usuario_id = $2', false),
    (50,  'member_specialty_requirements', 'club_id = $1 and usuario_id = $2', false),
    (60,  'member_specialties', 'club_id = $1 and usuario_id = $2', false),
    (70,  'class_completion_events', 'club_id = $1 and usuario_id = $2', true),
    (80,  'class_investitures', 'club_id = $1 and usuario_id = $2', true),
    (90,  'investiture_reviews', 'club_id = $1 and usuario_id = $2', false),
    (100, 'member_classes', 'club_id = $1 and usuario_id = $2', false),
    (110, 'experience_rewards', 'club_id = $1 and participation_id in (select id from public.experience_participations where club_id = $1 and usuario_id = $2)', false),
    (120, 'experience_submissions', 'club_id = $1 and usuario_id = $2', false),
    (130, 'experience_participations', 'club_id = $1 and usuario_id = $2', false),
    (140, 'experience_audiences', 'club_id = $1 and usuario_id = $2', false),
    (150, 'member_badges', 'club_id = $1 and usuario_id = $2', false),
    (155, 'unidade_ajuda_pais', 'club_id = $1 and usuario_id = $2', false),
    (156, 'unidade_justificativas', 'club_id = $1 and usuario_id = $2', false),
    (157, 'unidade_mural', 'club_id = $1 and autor_id = $2', false),
    (160, 'pontos', 'club_id = $1 and usuario_id = $2', false),
    (170, 'entregas', 'club_id = $1 and usuario_id = $2', false),
    (180, 'recordes', 'club_id = $1 and usuario_id = $2', false),
    (190, 'partidas', 'club_id = $1 and usuario_id = $2', false),
    (200, 'trilha_jogos', 'club_id = $1 and usuario_id = $2', false),
    (210, 'chefao_golpes', 'club_id = $1 and usuario_id = $2', false),
    (220, 'missoes_feitas', 'club_id = $1 and usuario_id = $2', false),
    (230, 'devocional', 'club_id = $1 and usuario_id = $2', false),
    (240, 'biblia_leituras', 'club_id = $1 and usuario_id = $2', false),
    (250, 'biblia_leitura_atual', 'club_id = $1 and usuario_id = $2', false),
    (260, 'bichinhos', 'club_id = $1 and usuario_id = $2', false),
    (270, 'ajudas', 'club_id = $1 and (de_id = $2 or para_id = $2)', false),
    (280, 'chat_mensagens_apagadas', 'club_id = $1 and mensagem_id in (select id from public.chat_mensagens where club_id = $1 and autor_id = $2)', false),
    (290, 'chat_mensagens', 'club_id = $1 and autor_id = $2', false),
    (300, 'chat_participantes', 'club_id = $1 and usuario_id = $2', false),
    (310, 'notificacoes', 'club_id = $1 and para_usuario = $2', false),
    (320, 'mensalidades', 'club_id = $1 and desbravador_id = $2', false),
    (330, 'responsavel_consentimentos', 'club_id = $1 and (desbravador_id = $2 or responsavel_id = $2)', true),
    (340, 'responsaveis', 'club_id = $1 and (desbravador_id = $2 or responsavel_id = $2)', false),
    (1000, 'organization_memberships', 'organizational_unit_id = $1 and user_id = $2', false)
$$;
revoke all on function public._lixeira_catalogo() from public, anon, authenticated;
