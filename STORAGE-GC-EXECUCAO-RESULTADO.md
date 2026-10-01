# GC do Storage e prevenção de órfãos — execução (01/10/2026)

## Prevenção (migration 532 + Edge Function `storage-excluir`)
- Migration 532 aplicada (ledger 532; Tenant 001 e Storage idênticos; 0 linhas na fila). Seis gatilhos AFTER (fotos, entregas, missoes_feitas, devocional, profiles.foto, unidades) enfileiram o caminho ANTIGO guardado no banco, com carência de 7 dias; lote máximo 8 (política); cron `storage-excluir` a cada 15 min, ligado em 01/10 depois das provas.
- Função publicada (verify_jwt desligado, segredo `x-storage-excluir-secret`, falha fechada); secret e Vault configurados sem imprimir valores.
- Prova em produção (`scripts/storage-exclusao-teste-controlado-producao.mjs`, 30/30): decisões do processador em transações com ROLLBACK (referenciado recusado; dentro da carência recusado; vencida e sem referência elegível; caminho forjado e buckets protegidos recusados; confirmar idempotente; apagar ATIVIDADE, apagar foto do MURAL e trocar AVATAR enfileiram só o caminho ANTIGO, nunca o novo) + Edge Function real só com objetos sintéticos (exclui o sintético elegível, idempotente, falha registrada com 5 tentativas → `falhou` + `infra_falhas` sem caminho). Limpeza: 0 objetos e 0 linhas de teste restantes.

## Exclusão dos órfãos seguros
- Manifesto antes (`scripts/storage-gc-manifesto.mjs`): 88 candidatos → **86 seguros (A, 80,9 MB)** e **2 indeterminados (C, 1,0 MB) preservados**; cópia de recuperação dos 86 (sha256) e os 86 também no backup anterior.
- Revalidação imediata (`scripts/storage-gc-excluir-lote.mjs --fase revalidar`): 86 continuam seguros, 0 retirados.
- Exclusão em 11 lotes (10 de 8 + 1 de 6), cada um re-checado item a item (categoria órfã, nenhuma coluna cita, sha256 igual) e verificado depois (removidos = esperado, nada fora do manifesto, 0 referências quebradas, sem app_erros novos). Resultado: objetos 448 → 362, 650,6 → 569,7 MB (−80,9 MB); `club_storage_objetos` acompanhou (362).
- Observação: os 86 incluíam 3 vídeos e 1 HEIC (+1 HEIC de perfil) que eram órfãos; por isso HEIC 5→4 e vídeos 33→30. Não houve tratamento de HEIC/vídeo, só exclusão de órfãos da lista autorizada.
- Os 2 indeterminados (atividade existente, sem entrega do par e sem explicação) continuam no Storage.
