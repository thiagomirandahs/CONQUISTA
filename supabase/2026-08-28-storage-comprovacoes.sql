-- =====================================================================
--  Filhos da Conquista — HARDENING etapa 2A/2B: bucket PRIVADO de
--  comprovações + limites de arquivo no Storage (2026-08-28)
--
--  COMO APLICAR: Supabase -> SQL Editor -> New query -> cole -> Run. Idempotente.
--
--  RISCO CORRIGIDO: fotos de MISSÕES e comprovações de ATIVIDADES (imagens de
--  crianças) iam pro bucket PÚBLICO 'imagens' — qualquer pessoa com o link
--  abria, sem login. Agora esse conteúdo vai pro bucket PRIVADO 'comprovacoes':
--   * o banco guarda o CAMINHO do arquivo (não uma URL pública eterna);
--   * quem pode ver (o DONO ou a LIDERANÇA) gera uma signed URL temporária
--     de 1 hora na hora de exibir — o Storage só assina pra quem a política
--     abaixo autoriza;
--   * TRANSIÇÃO SEGURA: registros antigos (URL pública completa) continuam
--     abrindo normalmente; nada é migrado nem quebrado. Mural, avatar e
--     emblemas de unidade NÃO mudam nesta etapa (continuam públicos).
--  Limites no próprio Storage (defesa além da validação do app):
--   * máx. 60 MB por arquivo;
--   * só imagens (jpg/png/webp/gif/heic) e vídeos (mp4/mov/webm) — SVG/HTML
--     não entram nem por upload direto na API.
-- =====================================================================

-- 1) O bucket privado (se já existir, garante que está PRIVADO e com limites)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'comprovacoes', 'comprovacoes', false, 62914560,
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif',
        'video/mp4', 'video/quicktime', 'video/webm']
)
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- 2) Políticas do Storage (a "fechadura" de verdade):
--    * ENVIAR: só o próprio usuário, e só dentro da pasta dele —
--      o caminho é sempre "<auth.uid()>/missoes/..." ou "<auth.uid()>/atividades/..."
--    * VER (e assinar URL): o dono do arquivo OU a liderança (pode_gerir)
--    * sem update/delete: comprovação não se apaga por engano (auditoria)
drop policy if exists "comprovacao dono envia" on storage.objects;
create policy "comprovacao dono envia" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'comprovacoes'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "comprovacao dono ou lideranca le" on storage.objects;
create policy "comprovacao dono ou lideranca le" on storage.objects for select to authenticated
  using (
    bucket_id = 'comprovacoes'
    and ((storage.foldername(name))[1] = auth.uid()::text or public.pode_gerir())
  );

notify pgrst, 'reload schema';
