-- D9 (Fase 8): Expedição Galápagos e O Fim do Começo ficam SEM ÁUDIO enquanto a fonte não for confirmada.
-- Só liga o interruptor que o administrador já tem (ativo=false): nada é apagado, o playlist_id e os capítulos
-- continuam guardados e o administrador pode religar quando a fonte for documentada. Não inventa link algum.
update public.audiolivros
   set ativo = false, updated_at = now()
 where titulo in ('Expedição Galápagos', 'O Fim do Começo') and ativo;

-- e o catálogo de leitura (514) também não pode oferecer áudio desses dois
update public.leitura_materiais m
   set audio_confirmado = false
  from public.audiolivros a
 where m.audiolivro_id = a.id and a.ativo = false and m.audio_confirmado;
