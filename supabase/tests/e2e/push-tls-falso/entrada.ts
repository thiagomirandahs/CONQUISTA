// Entrypoint do E2E de push: troca o transporte TLS (shim.ts) e só então carrega a Edge Function REAL, sem alterá-la.
import './shim.ts'
import '../supabase/functions/enviar-push/index.ts'
