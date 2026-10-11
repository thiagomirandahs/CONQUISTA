-- 546 — Reativa os audiolivros de Pioneiro e Excursionista.
-- Em 11/10/2026, o dono confirmou nesta conversa que os links são válidos.
-- Usa as playlists e os capítulos já cadastrados pela migration 370;
-- resolve a pendência que motivou a desativação na migration 516.
begin;

update public.audiolivros
   set ativo = true, updated_at = now()
 where titulo in ('Expedição Galápagos', 'O Fim do Começo')
   and not ativo;

update public.leitura_materiais m
   set audio_confirmado = true,
       audio_fonte = 'Playlist do canal Hora do Clube indicada e confirmada pelo dono em 11/10/2026: https://www.youtube.com/playlist?list=' || a.playlist_id,
       revisado = true,
       observacao = case
         when m.observacao = 'Áudio a confirmar: a playlist existe no catálogo de audiolivros, mas a fonte ainda não foi confirmada.'
         then null
         else m.observacao
       end,
       atualizado_em = now()
  from public.audiolivros a
 where m.audiolivro_id = a.id
   and a.ativo
   and (
     (m.chave = 'expedicao-galapagos' and a.titulo = 'Expedição Galápagos'
      and a.playlist_id = 'PLZzUHCA4d0QxHUB46W_0rzAm46XijMVda')
     or
     (m.chave = 'o-fim-do-comeco' and a.titulo = 'O Fim do Começo'
      and a.playlist_id = 'PLZzUHCA4d0QyjX0cXBPeeWMVi1vkC7uhi')
   );

commit;
