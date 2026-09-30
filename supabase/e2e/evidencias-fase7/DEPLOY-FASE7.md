# Deploy da Fase 7 (30/09/2026)
- main: ca011ed → eb897ef (fast-forward, sem force). Tag de retorno: pre-fase7-main-ca011ed. Vercel Production success (deployment 6765200688); OTA 202609301343-eb897ef.
- Backup lógico pré-migrations: backup-conquista-pre-fase7-2026-09-30/ (fora do Git; sha256 no SHA256.txt).
- Migrations 510, 511, 512, 513 aplicadas UMA POR VEZ, cada uma em transação (lock_timeout 5s) com o ledger na mesma transação.
- Tenant 001: impressão digital (tenant001-antes.txt × tenant001-depois.txt) IDÊNTICA, também depois do smoke (transação desfeita).
- Smoke em produção: scripts/smoke-fase7-producao.sql (61 verificações, tudo em transação com ROLLBACK; catálogo de especialidades SINTÉTICO desfeito).
- Nenhuma especialidade real/TE-001/HM-049 publicada. guia.V.2 opção 4 desativada (provado no servidor).
