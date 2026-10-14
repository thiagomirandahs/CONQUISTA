# Proteção de dados e ameaças — revisão ampliada, 14/10/2026

**Situação: INCOMPLETA PARA PRODUÇÃO.** Implementação e testes abaixo não certificam que o ambiente implantado esteja protegido. Não liberar cobrança nem declarar a auditoria encerrada enquanto os bloqueios externos não tiverem evidências atuais. Este documento complementa a auditoria anônima; nenhuma configuração de produção foi alterada nesta sessão.

## Cobertura e limites

Revisão das 284 migrations (inclusive alterações dinâmicas de definições nas 210/310), nove RPCs públicas, oito Edge Functions, serviços/contextos de frontend, fluxo de saída, arquivos privados, pagamentos e lockfile (849 pacotes). Busca por credenciais literais em SQL/Edge inspecionados sem imprimir valores. Não foi auditoria completa de histórico Git/artefatos nem pentest de produção.

O ambiente atual não tem credenciais/identidades conectadas de Supabase, Vercel, backup ou provedor. A instalação de ferramentas foi recusada pelo sandbox (EPERM). Não se buscou senha em arquivo nem se tentou contornar essa restrição. O GitHub recebe workflow para executar verificações isoladas; o resultado precisa ser conferido antes do merge.

## Falhas confirmadas e correções adicionais

| Situação no código | Risco | Correção |
|---|---|---|
| excluir_usuario consultava role/status de diretoria sem starts_at/ends_at. Outro papel ativo mantinha clube_atual_id válido. | Autoridade expirada podia excluir dados pessoais. | Wrapper exige pode_administrar_clube, preservando as restrições de histórico/inativação da implementação viva. |
| rejeitar_vinculo usava só role/status e clube do alvo, sem exigir a aba atual. | Diretoria expirada ou ação no clube errado alterava vínculo de responsável. | Vínculo vigente e clube do alvo igual ao clube da requisição. |
| Conta de administrador da plataforma podia ter perfil excluído por diretoria de um único clube, se sem outros vínculos/histórico bloqueador. | Exclusão indevida de identidade global e perda de dados. | Impede excluir a conta global; desativação do vínculo continua disponível. Checagem de pertencimento ocorre antes, evitando sonda de UUID. |
| Público de push verificava status ativo, sem validade temporal. | Notificação destinada a vínculo expirado/futuro. | starts_at/ends_at na seleção dos destinatários. |
| Limite de cinco chamados usava COUNT antes do INSERT sem serializar. Prioridade sugerida aceitava diretoria vencida. | Corrida paralela atravessava limite; prioridade indevida. | Lock por usuário antes de contar; validade da diretoria para prioridade. |
| Logout dependia de chamadas remotas antes de limpar rascunhos. | Falha de rede mantinha conteúdo privado no aparelho. | Limpeza independente no finally, com prazos, remoção de credencial/retorno/cache e rascunhos. Não apaga preferências não relacionadas. |
| Cache inicial sem sessão retornava cedo quando dono já era null. | Cache persistido anterior podia permanecer em aparelho compartilhado. | Limpa também na abertura sem sessão. |
| URLs de imagens privadas duravam 24 h; comprovações de missão, 1 h. | Link copiado funcionava sem login após logout/revogação até expirar. | Novas URLs de 10 min e cache compatível; caches antigos de 24 h rejeitados no app. URLs já emitidas NÃO são invalidadas por mudar o frontend e fotos já baixadas não podem ser recolhidas. |
| PDF e foto administrativa dependiam do header/gateway e RPC, lendo corpo antes de confirmar usuário. | Header Bearer público/serviço não é necessariamente sessão de pessoa; custo de parse sem necessidade. Não foi comprovado vazamento pela RPC. | getUser explícito antes do parse, mantendo autorização do banco; parser limitado a 16 KiB/5 s em todos esses endpoints. |
| Parser inválido podia propagar detalhe de SyntaxError com trecho do corpo. | Resposta podia refletir conteúdo sensível recebido. | Erro de JSON genérico, sem trecho do corpo. |
| Clientes podem herdar CREATE no schema public dependendo do bootstrap real. | Criação de objetos/overloads na superfície da API. Não foi demonstrado privilégio efetivo em produção. | Revoga CREATE de PUBLIC/anon/authenticated; operadores preservados. |

A primeira suspeita sobre vinculo_gerir NÃO foi tratada como brecha confirmada: a migration 210 já troca sua checagem por pode_administrar_clube, que valida datas. A 310 acrescenta motivo/histórico. Não se substitui a definição antiga apagando essas proteções.

## Cenários obrigatórios de ataque e falha

| Cenário | Evidência necessária |
|---|---|
| Anônimo chama RPC privada ou lê tabela direta | Grants/RLS reais + testes SQL 56/148. |
| Membro A envia UUID/header de B | Leituras vazias/recusa, sem mutação; testes multi-tenant 02/05/06 e suíte completa. |
| Usuário sem clube tenta atribuir cargo/clube no metadata | Cadastro não concede autoridade, pedido pendente e validação pelo servidor; testar contra Auth implantado. |
| Instrutor tenta gerir cargos/senhas/finanças/configuração | Capacidade da 210 respeitada, não só rota escondida; testar REST diretamente. |
| Responsável informa criança alheia ou troca UUID | Vínculo aprovado/consentimento e clube conferidos; teste 03/08 + testes de consentimento. |
| Diretoria expirada conserva papel comum válido | Não pode excluir/rejeitar/atribuir prioridade; teste 149 novo. |
| Diretoria de A atua pela aba B | Sem alteração em A; teste 149 e suíte de contexto. |
| Conta global/admin alvo de exclusão de clube | Recusa, sem apagar perfil/assinaturas/conta. |
| Logout com rede caída, troca de conta, cache antigo | Limpeza local e isolamento por UID; testes Node e React novos. |
| Token de foto copiado e autorização revogada | Verificar expiração; TTL curto não substitui revogação de URL já emitida. |
| JWT roubado/reset de senha/logoff global | **Teste real de token antigo contra REST/Storage/Edge até expiração.** Apagar refresh tokens/sessions não comprova invalidação imediata de access JWT. |
| Upload MIME falso, SVG/HTML, arquivo enorme ou EXIF | Restrição de bucket + processamento no servidor habilitado/quarentena; validação do navegador sozinha não prova proteção. |
| Assinatura/foto de outra pessoa em PDF | Caminho exato da assinatura e autorização do documento, testes 88/89/96/160. |
| Webhook falso/replay/valor diferente/NSU de outro pedido | payment_check e vínculo de referência confirmados com o provedor; homologação obrigatória. |
| 50 compras simultâneas/checkout abandonado/renovação | Testar locks e reserva em PostgreSQL real. Sem API de cancelamento, não reciclar links pagáveis. |
| Reembolso/chargeback | Processo de conciliação/revogação documentado e homologado; ainda não automatizado pelo checkout atual. |
| Credencial de serviço antiga ou dump roubado | Chave invalidada, backup criptografado e restauração ensaiada; resultado atual, não só plano. |
| Falha/crash/ransomware ou exclusão acidental | Backup banco + Storage e ensaio de restauração isolado; sem restaurar produção para testar. |
| Dependência vulnerável/supply chain | Workflow de npm audit sobre lockfile, ações por SHA e permissões mínimas; corrigir ou justificar cada alerta antes de merge. |
| Volume distribuído/DDoS | Cotação no banco não basta; gateway/WAF/rate limits, alarmes e resposta a incidente. |

## Pendências de produção que impedem encerrar

1. **Aplicação e validação das migrations 548/549 e publicações de frontend/Edge/Vercel.** Executar suites SQL/React; conferir Actions. Alterações propostas não protegem o código antigo ainda publicado.
2. **Inventário real:** executar scripts/seguranca/inventario-protecao-dados.sql e auditoria-anon.sql, ambos somente leitura e sem registros pessoais. Comparar grants/policies/buckets com o desenho. Não enviar senha, token, connection string ou dump.
3. **Credenciais/backups:** SEGURANCA-ROTACAO-DE-CHAVES.md registra troca da senha em 01/10, mas chaves legacy ainda habilitadas e dumps antigos com service_role/hashes. Essa é evidência histórica, NÃO confirmação do estado atual. Conferir migração 528, migrar consumidores, revogar credenciais necessárias e criptografar backups. Não apagar backups úteis antes de provar restauração.
4. **MFA administrativo:** configuração versionada tem TOTP desabilitado e o app não exige aal2. Habilitar MFA, enrolar administradores, preparar recuperação e validar a exigência no servidor (não só frontend), sem bloquear contas antes do cadastro do fator. Isto ainda NÃO está implementado/publicado nesta rodada.
5. **Revogação de sessão:** provar comportamento do JWT antigo depois de troca de senha/logout/suspensão. Se o requisito for bloqueio imediato, implementar validação server-side de sessão/revogação nas APIs e Storage; não anunciar que logout recolhe URLs/fotos/JWT já emitidos.
6. **Infraestrutura:** permissões/2FA de Supabase/GitHub/Vercel, chaves de CI mínimas, CAPTCHA/rate limits, SMTP/recuperação, headers do gateway, TLS, restrições de origens, logs sem dados sensíveis, políticas de retenção e monitoramento. Exigem painel/acesso autorizado de administração e credenciais não disponíveis nesta sessão.
7. **Backups:** relatório BACKUP-PITR-HOSPEDADO.md descreve mecanismo/ensaios; obter prova atual de backup recuperável do banco e dos arquivos do Storage. Não assumir que backup de banco inclui arquivos.
8. **Pagamento:** homologar Pix/cartão, regras de valor/parcelamento, correlação de pedido/NSU, webhook, idempotência, cancelamento/reembolso antes de INFINITEPAY_HABILITADO=true. Cobrança continua bloqueada sem essa configuração.
9. **Histórico/artefatos:** varredura de segredo e dado pessoal no histórico Git/APKs/dumps/logs. Revogar qualquer segredo exposto; apagar commit não revoga credencial. Revisão atual cobriu fontes selecionadas, não todos esses artefatos.

## Testes e recorrência

Passaram localmente 13 testes Node: 5 de JSON limitado, 4 de sessão real em endpoints e 4 de limpeza/cache. São regressões úteis, não pentest completo. Testes SQL 149 e testes React de logout/cache adicionados, mas não executados localmente sem ferramentas/dependências. O workflow Segurança roda testes sem dependências, npm audit (moderado ou acima bloqueia) e suíte SQL num Supabase/Docker DESCARTÁVEL; não usa credenciais de produção. O CI normal cobre React/lint/build. Conferir resultados: criação do workflow não significa aprovação dos jobs.

URLs antigas persistem até expirar, JWT roubado é bloqueio pendente a validar, MFA precisa implementação/configuração, e backup/credenciais exigem intervenção real. Não há garantia de ataque impossível. A condição de encerramento é evidência atual para cada item, revisada depois de toda implantação e periodicamente.
