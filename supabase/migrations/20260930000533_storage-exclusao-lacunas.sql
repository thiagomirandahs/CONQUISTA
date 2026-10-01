-- =============================================================================
-- 533 — FECHAR AS LACUNAS DE ÓRFÃOS DE STORAGE QUE A 532 NÃO COBRE
-- =============================================================================
-- A 532 cobre fotos, entregas, missoes_feitas, devocional, profiles e unidades. Auditoria do schema + RPCs + front (documentada em
-- STORAGE-ORFAOS-PREVENCAO.md, seção 533) provou mais cinco pontos em que uma LINHA é trocada/apagada e o ARQUIVO fica para trás:
--
--   A) member_requirements.evidencia_path / rascunho_anexos        requisito_salvar troca o caminho (coalesce(p_evidencia_path, ...));
--      requisito_rascunho_salvar regrava a lista inteira (rascunho_anexos = p_anexos); o arquivo anterior fica órfão. DELETE: cascata
--      de member_classes/usuário/clube.
--   B) member_specialty_requirements.evidencia_path / rascunho_anexos   idem (especialidade_requisito_salvar / rascunho).
--   C) experiences.imagem_path                                       experiencia_salvar troca o caminho; DELETE por cascata/limpeza.
--   D) experience_submissions.arquivo_path                           experiencia_etapa_enviar faz UPSERT (on conflict do update set
--      arquivo_path = excluded.arquivo_path): reenviar a etapa troca o arquivo e o anterior fica órfão. (A análise anterior achou
--      "nenhum update"; o upsert escapou da busca por UPDATE. Corrigido aqui, com evidência.)
--   E) suporte_mensagens.anexo_path                                  suporte_rotina() apaga chamados fechados há 2 anos (cron
--      'suporte-rotina' ativo) e as mensagens vão em cascata: o anexo (bucket suporte-anexos) fica órfão. Só DELETE.
--
-- Esta migration é ADITIVA e reutiliza TUDO da 532: a fila public.storage_exclusao_fila, a política (carência de 7 dias, lote máximo 8,
-- 4 buckets elegíveis), _storage_exclusao_enfileirar (normaliza URL/caminho, recusa bucket protegido, upsert que não encurta a carência
-- nem duplica), _storage_exclusao_processar (REVERIFICA tudo: catálogo da 531 [histórico imutável de tentativas incluso], idade do
-- objeto, bucket, dono do caminho = dono da linha) e _storage_exclusao_confirmar. A exclusão física continua SÓ na Edge Function
-- `storage-excluir`. Nenhuma tabela nova (logo nenhum guarda de manutenção a instalar), nenhum backfill, nenhuma função da 532
-- alterada, nenhuma RPC do app alterada, nenhum arquivo/linha apagado.
--
-- O que é novo:
--   1. _storage_exclusao_valores(jsonb, boolean): extrai os valores guardados em uma coluna (texto) ou em um array jsonb de
--      objetos {path,...}. Assim o MESMO gatilho cobre coluna simples e lista de anexos.
--   2. _storage_exclusao_gatilho_jsonb(): gatilho AFTER ... FOR EACH ROW. TG_ARGV[0] = coluna do dono da linha; TG_ARGV[1..] =
--      'coluna:bucket-padrão' (texto) ou 'coluna[]:bucket-padrão' (array jsonb de {path}). Enfileira SÓ o que estava no valor OLD e
--      não está em NENHUMA coluna vigiada da linha NOVA (comparação por bucket/caminho normalizado: URL e caminho puro do mesmo
--      arquivo são o mesmo arquivo); no DELETE, tudo que estava no OLD. O caminho vem SEMPRE do que estava guardado no banco.
--      Nunca falha a operação do usuário (erro engolido + infra_falhas, igual à 532).
--   3. Gatilhos com WHEN (old.col is distinct from new.col): o save de rascunho que regrava o MESMO valor não executa a função
--      (custo ~zero na tabela quente). Nomes zz_storage_lacuna_* (não colidem com o contador zz_storage_exclusao_% do teste 137).
--
-- Dono da linha: member_requirements/member_specialty_requirements/experience_submissions = usuario_id; experiences = criado_por;
-- suporte_mensagens = autor_id. Se o dono for nulo ou o caminho não pertencer a ele, dono_confere fica false e o processador MANTÉM
-- o arquivo (dono_diferente): falha para o lado seguro (deixa órfão, nunca apaga o que não é do dono).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Valores guardados em uma coluna: texto simples ou array jsonb de {path} (aceita também array de strings).
-- ---------------------------------------------------------------------------
create or replace function public._storage_exclusao_valores(p_valor jsonb, p_lista boolean) returns setof text
language sql immutable set search_path = '' as $$
  select v from (
    select nullif(btrim(case
             when jsonb_typeof(e) = 'object' then e ->> 'path'
             when jsonb_typeof(e) = 'string' then e #>> '{}'
           end), '') as v
      from jsonb_array_elements(case when p_lista and jsonb_typeof(p_valor) = 'array' then p_valor else '[]'::jsonb end) e
    union all
    select nullif(btrim(p_valor #>> '{}'), '')
     where not p_lista and jsonb_typeof(p_valor) = 'string'
  ) x where v is not null;
$$;
revoke all on function public._storage_exclusao_valores(jsonb, boolean) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Gatilho genérico para coluna de texto E para lista jsonb de anexos.
-- ---------------------------------------------------------------------------
create or replace function public._storage_exclusao_gatilho_jsonb() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_old jsonb := to_jsonb(old);
  v_new jsonb := case when tg_op = 'UPDATE' then to_jsonb(new) else null end;
  v_dono uuid;
  v_novas text[] := '{}';      -- chaves bucket/caminho que a linha NOVA ainda usa (qualquer coluna vigiada)
  v_ja text[] := '{}';         -- chaves já tratadas neste disparo (o mesmo arquivo em 2 colunas não duplica)
  v_spec text; v_col text; v_lista boolean; v_bucket text; v_val text; v_k text;
begin
  begin
    begin v_dono := nullif(v_old ->> tg_argv[0], '')::uuid; exception when others then v_dono := null; end;
    if tg_op = 'UPDATE' then
      for i in 1 .. coalesce(array_length(tg_argv, 1), 1) - 1 loop
        v_spec := tg_argv[i]; v_bucket := nullif(split_part(v_spec, ':', 2), '');
        v_col := replace(split_part(v_spec, ':', 1), '[]', '');
        for v_val in select * from public._storage_exclusao_valores(v_new -> v_col, v_spec like '%[]:%') loop
          v_k := public._storage_ref_chave(v_val, v_bucket);
          if v_k is not null then v_novas := v_novas || v_k; end if;
        end loop;
      end loop;
    end if;
    for i in 1 .. coalesce(array_length(tg_argv, 1), 1) - 1 loop
      v_spec := tg_argv[i]; v_bucket := nullif(split_part(v_spec, ':', 2), '');
      v_lista := split_part(v_spec, ':', 1) like '%[]';
      v_col := replace(split_part(v_spec, ':', 1), '[]', '');
      for v_val in select * from public._storage_exclusao_valores(v_old -> v_col, v_lista) loop
        v_k := public._storage_ref_chave(v_val, v_bucket);
        if v_k is null or v_k = any (v_novas) or v_k = any (v_ja) then continue; end if;
        v_ja := v_ja || v_k;
        perform public._storage_exclusao_enfileirar(v_val, v_bucket, tg_table_name || '.' || v_col,
          case when tg_op = 'DELETE' then 'apagado' else 'trocado' end, v_dono);
      end loop;
    end loop;
  exception when others then
    begin
      insert into public.infra_falhas (origem, detalhe) values ('storage/exclusao-gatilho', left('gatilho ' || tg_table_name || ': ' || sqlstate, 200));
    exception when others then null;
    end;
  end;
  return null;
end $$;
revoke all on function public._storage_exclusao_gatilho_jsonb() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Quem enfileira. UPDATE só dispara a função quando o valor MUDA (WHEN); DELETE sempre.
-- ---------------------------------------------------------------------------
-- A) requisitos de classe: foto/arquivo em andamento e anexos do rascunho
drop trigger if exists zz_storage_lacuna_member_requirements_upd on public.member_requirements;
create trigger zz_storage_lacuna_member_requirements_upd after update of evidencia_path, rascunho_anexos on public.member_requirements
  for each row when (old.evidencia_path is distinct from new.evidencia_path or old.rascunho_anexos is distinct from new.rascunho_anexos)
  execute function public._storage_exclusao_gatilho_jsonb('usuario_id', 'evidencia_path:comprovacoes', 'rascunho_anexos[]:comprovacoes');
drop trigger if exists zz_storage_lacuna_member_requirements_del on public.member_requirements;
create trigger zz_storage_lacuna_member_requirements_del after delete on public.member_requirements
  for each row execute function public._storage_exclusao_gatilho_jsonb('usuario_id', 'evidencia_path:comprovacoes', 'rascunho_anexos[]:comprovacoes');

-- B) requisitos de especialidade
drop trigger if exists zz_storage_lacuna_member_specialty_requirements_upd on public.member_specialty_requirements;
create trigger zz_storage_lacuna_member_specialty_requirements_upd after update of evidencia_path, rascunho_anexos on public.member_specialty_requirements
  for each row when (old.evidencia_path is distinct from new.evidencia_path or old.rascunho_anexos is distinct from new.rascunho_anexos)
  execute function public._storage_exclusao_gatilho_jsonb('usuario_id', 'evidencia_path:comprovacoes', 'rascunho_anexos[]:comprovacoes');
drop trigger if exists zz_storage_lacuna_member_specialty_requirements_del on public.member_specialty_requirements;
create trigger zz_storage_lacuna_member_specialty_requirements_del after delete on public.member_specialty_requirements
  for each row execute function public._storage_exclusao_gatilho_jsonb('usuario_id', 'evidencia_path:comprovacoes', 'rascunho_anexos[]:comprovacoes');

-- C) imagem da experiência (dono = quem criou a experiência; sem criador => o processador mantém o arquivo)
drop trigger if exists zz_storage_lacuna_experiences_upd on public.experiences;
create trigger zz_storage_lacuna_experiences_upd after update of imagem_path on public.experiences
  for each row when (old.imagem_path is distinct from new.imagem_path)
  execute function public._storage_exclusao_gatilho_jsonb('criado_por', 'imagem_path:imagens');
drop trigger if exists zz_storage_lacuna_experiences_del on public.experiences;
create trigger zz_storage_lacuna_experiences_del after delete on public.experiences
  for each row execute function public._storage_exclusao_gatilho_jsonb('criado_por', 'imagem_path:imagens');

-- D) arquivo da etapa de experiência (reenvio = upsert; apagar experiência/participação = cascata)
drop trigger if exists zz_storage_lacuna_experience_submissions_upd on public.experience_submissions;
create trigger zz_storage_lacuna_experience_submissions_upd after update of arquivo_path on public.experience_submissions
  for each row when (old.arquivo_path is distinct from new.arquivo_path)
  execute function public._storage_exclusao_gatilho_jsonb('usuario_id', 'arquivo_path:comprovacoes');
drop trigger if exists zz_storage_lacuna_experience_submissions_del on public.experience_submissions;
create trigger zz_storage_lacuna_experience_submissions_del after delete on public.experience_submissions
  for each row execute function public._storage_exclusao_gatilho_jsonb('usuario_id', 'arquivo_path:comprovacoes');

-- E) anexo de mensagem do suporte (só existe DELETE: expurgo de chamado fechado há 2 anos; mensagem nunca é editada)
drop trigger if exists zz_storage_lacuna_suporte_mensagens_del on public.suporte_mensagens;
create trigger zz_storage_lacuna_suporte_mensagens_del after delete on public.suporte_mensagens
  for each row execute function public._storage_exclusao_gatilho_jsonb('autor_id', 'anexo_path:suporte-anexos');

notify pgrst, 'reload schema';
