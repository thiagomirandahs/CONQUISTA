# Fase 9 — privacidade de mídia, backups, chaves e órfãos (análise, 01/10/2026)

Somente leitura em produção (a única escrita foi o `pg_dump` da referência limpa, que lê). Nenhum arquivo de usuário foi alterado. HEIC e vídeo: ver `HEIC-SANEAMENTO-DESENHO.md` e `VIDEO-SANEAMENTO-DESENHO.md`.

## 1. Divergência formato real × extensão × mimetype (`scripts/storage-divergencias-formato.mjs`)
Hoje: 362 objetos, **0 divergências** (extensão e mimetype coerentes com os bytes). Antes do GC havia 1 (arquivo de perfil `.png` com bytes JPEG, órfão, já removido). Nada foi corrigido automaticamente.

## 2. Pontos de upload de mídia (pipeline)
| Mídia | Onde entra | Tela | Bucket | Limites/validação | O cliente remove metadados? | Servidor sanea? | Envia o ORIGINAL? |
|---|---|---|---|---|---|---|---|
| **Vídeo** | `subirComprovacao({ permitirVideo: true })` | **só `pages/Atividades.jsx`** (`accept image/*,video/*`) | `comprovacoes/<uid>/atividades/` | assinatura mágica; **60 MB**; imagem 15 MB | **NÃO** | **NÃO** (a função `sanear-imagens` classifica como `ignorado`; não trata vídeo) | **SIM — único caminho que sobe o arquivo original** |
| **HEIC** | qualquer envio de foto passa por `validarImagem` (aceita a assinatura HEIC) e depois por `comprimirImagem({ semMetadados: true })` (canvas) | todas as telas de foto | imagens/comprovacoes/comunidade/suporte-anexos | 15 MB (5 MB logos) | **SIM, se o navegador decodifica HEIC** (Safari/iPhone sim → vira JPEG); **se não decodifica (Android Chrome) o envio FALHA** com mensagem (nunca sobe o original) | HEIC = `ignorado` | **NÃO** desde a Fase 9 (antes do `semMetadados` o original subia; por isso existem 4 HEIC antigos) |
- `Experiencias.jsx` aceita `*/*` no seletor, mas `subirComprovacao` sem `permitirVideo` valida imagem pelo tipo REAL e recusa o resto.
- **Contrato novo** (`src/lib/uploadsMidia.contract.test.js`, 6 testes): vídeo só em `Atividades.jsx`; `accept` com `video/` só nele; `*/*` só em Atividades/Experiencias; o vídeo é o único caminho que sobe o original; HEIC só mencionado nos arquivos declarados; a lista não apodrece. Junto do contrato de EXIF (`uploadsSemOriginalComExif.contract.test.js`) cobre todos os `.upload(` do app.

## 3. Backups locais (auditoria; `scripts/seguranca/auditar-backups.mjs`)
Sem imprimir coordenadas, JWT, senha, token nem hash.
| Pasta | Data | MB | Imagens com GPS / metadados | HEIC / vídeo | `service_role` legacy | `auth.users` (hashes) | Grupo |
|---|---|---|---|---|---|---|---|
| `pre-fase9-janela` (dump) | 01/10 | 7 | — | — | **SIM** (antes da 528) | SIM | **A** (último dump antes da 528; restauração provada) |
| `referencia-limpa-2026-10-01` (dump + manifesto Storage) | 01/10 | 7 | — | — | **NÃO** | SIM | **A** (referência atual; restauração provada) |
| `storage-2026-10-01` (cópia de arquivos) | 01/10 | 672 | **16 / 75** | 5 / 33 | NÃO | NÃO | **A temporário** (única cópia dos originais e dos 86 excluídos; vira B depois de uma cópia limpa criptografada) |
| `backfill-2026-10-01/recuperacao` | 01/10 | 147 | **16 / 62** (originais dos 78 regravados) | 0 / 0 | NÃO | NÃO | B (já estão em `storage-2026-10-01`) |
| `gc-recuperacao-2026-10-01` (86 excluídos) | 01/10 | 81 | 0 / 0 | 1 / 3 | NÃO | NÃO | A temporário (recuperação dos 86) |
| `pre-fase8-janela` (dump) | 01/10 | 7 | — | — | SIM | SIM | B (substituído pelo pre-fase9) |
| `backup-conquista-pre-fase7-2026-09-30` / `pre-fase6-…` (dumps) | 30/09 | 6+6 | — | — | SIM | SIM | B/C (antigos) |
| `backup-conquista-2026-09-24`, `…janela-real-final`, `…migracao-2026-09-24` | 24/09 | 676+672+672 | **16 / 52** cada | 5 / 33 cada | **SIM** (2/1/1) | SIM | **C** (pré-migrations; ~2 GB; GPS + chave + hashes) |
| `staging/backups` | 24/09 | 16 | — | — | NÃO | SIM | C (staging antigo) |
Resumo: **12 pastas auditadas**; **com GPS antigo: 5** (as 3 de 24/09, `storage-2026-10-01` e `backfill-2026-10-01/recuperacao`); **com `service_role` legacy: 7** (pre-fase9, pre-fase8, pre-fase7, pre-fase6 e as 3 de 24/09); **com `auth.users` (hashes): 9 dumps**; nenhum com token `sbp_` ou senha em texto. Nada foi apagado ou movido.

## 4. Backup limpo pós-GC (criado e validado)
- `~/.desbravaclube-backups/referencia-limpa-2026-10-01/conquista-prod-referencia-limpa.dump` (7 MB, sha256 em `SHA256.txt`): `pg_dump -Fc` de `public`, `auth`, `storage` (só metadados) e `supabase_migrations`, **sem JWT literal** (a 528 removeu a chave do banco) — confirmado por varredura do arquivo e das definições restauradas.
- **Restauração provada** em banco descartável: ledger 532 (192 registros), 58 vínculos, 37 mensalidades, 362 objetos, tabela da 532 presente, 0 gatilho legado, 0 JWT literal (1 aviso benigno do `pg_restore`: schema `public` já existe).
- `MANIFESTO-STORAGE-ATUAL.tsv` (362 objetos, 569,7 MB, sha256 de cada; hash dos 30 vídeos/HEIC vem do backup de 01/10 por tamanho igual, os demais do inventário de produção de hoje). **Os arquivos em si não foram copiados de novo** (continuam em produção); uma cópia física limpa fica para a decisão de criptografia.
- Ainda contém `auth.users` (hashes de senha, inerente a um dump de Auth): **tratar como segredo; criptografar antes de sair do computador.**

## 5. Criptografia (procedimento, não executado)
`scripts/seguranca/backups-com-segredo-plano.sh` + passos: `tar` → `gpg --symmetric --cipher-algo AES256 --s2k-mode 3 --s2k-count 65011712` (senha digitada por você no prompt, guardada no gerenciador de senhas, nunca no chat) → provar a volta (`gpg --decrypt | sha256sum` igual ao do `.tar`) → só então (com sua confirmação) remover o texto claro. Nada vai para nuvem sem criptografia e sem a sua autorização.

## 6. `service_role` legacy — matriz de dependências
| Dependência | Publishable | Legacy anon | Legacy service_role | Nova secret key | Não determinado |
|---|---|---|---|---|---|
| Front web / PWA / OTA | ✔ | | | | |
| APKs 1.3.0 · 1.3.3 · 1.3.6 · 1.3.8 · teste Fase 8 (embutem o bundle) | ✔ | | | | |
| APK 1.2.x (carrega o site) | ✔ (a do site) | | | | |
| GitHub Actions (6 secrets: keystore ×4, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`) | ✔ (valor é a publicável) | | | | |
| **Vercel (variáveis do painel)** | | | | | **? (CLI sem login)** |
| Edge Function `enviar-push` | | | ✔ (injetada) | | |
| `limpar-fotos-rede`, `sanear-imagens`, `storage-excluir` | | | ✔ (injetada) | | |
| `gerar-documento-pdf`, `gerar-documento-pdf-final`, `admin-comunidade-foto` | | **✔** (cliente com o JWT do usuário) | ✔ (injetada) | | |
| pg_cron / pg_net / Vault (`push_*`, `saneamento_*`, `storage_excluir_*`, `rede_limpeza_*`) | não usam chave de API (segredos próprios do Vault) | | | | |
| Scripts locais (13: backups, GC, backfill, janelas) | | | ✔ (buscam `service_role` pela Management API) | possível trocar | |
| Webhooks do painel | legado removido (528) | | | | |
| Integrações externas | nenhuma conhecida (FCM/VAPID não são chaves do Supabase) | | | | **confirmar com o dono** |
**Conclusão:** **não desativar.** As 7 Edge Functions leem `SUPABASE_SERVICE_ROLE_KEY` (e 3 também `SUPABASE_ANON_KEY`) **injetadas**; o comportamento da injeção com as chaves legacy desativadas não está provado, e a Vercel é desconhecida. Caminho: (1) migrar as funções e os scripts para a nova secret key, (2) verificar a Vercel, (3) testar num ambiente descartável, (4) só então desativar. Enquanto isso a chave legacy segue nos dumps antigos (grupo C acima).

## 7. Management API token
- **Usado por** 11 scripts (`scripts/auth/*`, `scripts/janela-fase8/backup-storage.mjs`, `scripts/storage-*`, `scripts/seguranca/rotacionar-senha-banco.mjs`, `verificar-*`) e citado em 2 docs de infra. **Nunca versionado** (varredura do repositório: 0), **ausente dos backups** (0 `sbp_`), **fora de logs**, presente só em `~/.desbravaclube-prod.env`. **Exposição conhecida: nenhuma** (o PLANO só tinha prefixos truncados e foi removido). **Ainda necessário:** sim, para as próximas janelas. **Ação:** ao terminar as janelas, revogar no painel (a API pública não revoga) e criar outro de escopo mínimo.

## 8. Os 2 indeterminados (somente leitura, restaurando dumps antigos)
| # | Arquivo | Evidência nova | Resultado |
|---|---|---|---|
| 1 | JPG de atividade (82 dias) | No dump de 24/09 o par (atividade, pessoa) tinha **1 entrega aprovada** apontando para esse arquivo; hoje **a pessoa não existe mais** e a entrega sumiu junto (a atividade passou de 13 para 12 entregas). | **Explicado: pessoa excluída depois de 24/09 → candidato a "seguro"** (não excluído; segue preservado até autorização) |
| 2 | HEIC de atividade (62 dias; enviado em 01/08) | O par (atividade, pessoa) **nunca teve entrega** em nenhum dump (24/09, 30/09, 01/10); a pessoa existe; a atividade tem 9 entregas (mesmas nos dumps). | **Continua INDETERMINADO** (upload sem registro; plausível mas não provado) — **PRESERVADO** |
Nenhum foi apagado.

## 9. Gatilhos de órfãos — todas as tabelas com caminho de Storage (catálogo `_storage_referencias()`, 47 referências)
| Tabela.coluna | Proteção | Classe |
|---|---|---|
| `fotos.url/.thumb`, `entregas.foto_url`, `missoes_feitas.foto_url`, `devocional.foto_url`, `profiles.foto`, `unidades.emblema/.bandeira` | viva | **COBERTO PELA 532** (6 gatilhos) |
| `comunidade_posts.foto_path`, `rede_stories.foto_path`, `rede_fotos_para_apagar` | viva/fila | **NÃO PRECISA** (a rotina `limpar-fotos-rede` apaga; 472) |
| `comprovacoes_documento.evidencia_path` | viva | **NÃO PRECISA** (a foto é apagada pela API depois da aprovação; o caminho vira null) |
| `class_*`, `requirement_submissions.*`, `specialty_requirement_submissions.*`, `requirement_approvals`, `document_*`, `curriculum_achievements.comprovante_path`, `clube_exclusoes`, `lixeira_*`, `class_prior_completion_log` | histórico imutável | **NÃO PRECISA** (o arquivo é prova; nunca é órfão) |
| `organizational_units.metadata` (logo do clube), `site_partners.logo_url` | bucket protegido (`publico`/`parceiros`) | **NÃO PRECISA** (logos nunca são alteradas; o GC só relata) |
| `leitura_materiais.*` | externas | **NÃO PRECISA** (URLs externas) |
| **`member_requirements.evidencia_path` / `rascunho_anexos`, `member_specialty_requirements.evidencia_path` / `rascunho_anexos`** | viva (rascunho) | **PODE GERAR ÓRFÃO** (trocar a foto antes de enviar deixa a anterior; o histórico só guarda o que foi ENVIADO) |
| **`experiences.imagem_path`** | viva | **PODE GERAR ÓRFÃO** (troca de imagem; só admin/liderança grava) |
| **`experience_submissions.arquivo_path`** | viva | **PODE GERAR ÓRFÃO** (corrigido na 533: `experiencia_etapa_enviar` faz UPSERT que troca `arquivo_path`; apagar a experiência apaga em cascata) |
| **`suporte_mensagens.anexo_path`** | viva | **PODE GERAR ÓRFÃO** (corrigido na 533: `suporte_rotina()` apaga chamado fechado há 2+ anos e as mensagens vão em cascata) |
| expurgo de clube (280) e arquivo "plantado" sem linha (ex.: upload sem registro, como o HEIC #2) | — | **não é evento de linha**: continua com o GC |
**Lacuna real:** os rascunhos de requisito/especialidade e `experiences.imagem_path`. **Migration 533 (criada só local, ver `STORAGE-ORFAOS-PREVENCAO.md` §9; esta análise inicial errou ao dar `arquivo_path`/`anexo_path` como sem fluxo):** gatilhos `AFTER UPDATE OF evidencia_path` em `member_requirements` e `member_specialty_requirements`, `AFTER UPDATE OF imagem_path` em `experiences` (e, para `rascunho_anexos` jsonb, comparar o array antigo × novo e enfileirar só os caminhos removidos) — o processador da 532 já recusa o que ainda está no histórico imutável. Exige revisar testes e impacto (tabelas quentes) antes de aplicar.
