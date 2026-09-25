# Matriz de acesso — DesbravaClube

Versão: 1 (gerada na rodada de fechamento, HEAD `19e39df`). Fonte de verdade real é sempre o código
— este documento é uma **consolidação de leitura**, não uma nova camada de autorização. Se divergir
do código no futuro, o código vence; atualize este arquivo.

**Por que este documento existe**: hoje a autorização vive espalhada em `src/lib/permissoes.js`
(só front, defesa em profundidade) + dezenas de policies RLS + checagens dentro de cada RPC
`security definer` (a autoridade real). Não existia um lugar único pra ver "quem pode o quê" de
relance. Este arquivo não substitui nada disso — só reúne.

## Papéis reais (não inventados — lidos do CHECK de `organization_memberships.role`)

| Papel | Domínio | Observação |
|---|---|---|
| `desbravador` | clube | membro comum |
| `conselheiro` | clube | lidera uma unidade |
| `instrutor` | clube | liderança pedagógica |
| `diretoria` | clube | liderança máxima do clube |
| `tesoureiro` | clube | financeiro do clube |
| `pais` | clube | responsável, vínculo com filho(s) |
| `coordenador_distrital` | institucional | só em unidade `type='distrito'` (gatilho valida) |
| `coordenador_regional` | institucional | só em unidade `type='regiao'` |
| `coordenador_geral` | institucional | só em unidade `type='campo'` |
| `diretor_mda` | institucional | só em unidade `type='campo'` |

**Fora desta tabela, em domínio próprio, nunca hierarquia eclesiástica**: `platform_admins.papel`
(`suporte`/`operacao`/`owner`) — administração da plataforma. Um admin de plataforma nunca vira
automaticamente nenhum papel acima, e nenhum papel acima vira admin de plataforma — são tabelas
diferentes (`platform_admins` vs. `organization_memberships`), nunca cruzadas.

**Ainda sem papel modelado** (schema pronto, gatilho recusa vínculo): unidades `type` = `igreja`,
`uniao`, `divisao`.

## Níveis organizacionais reais

```
divisao → uniao → campo → regiao → distrito → clube
```
(`organizational_units.type`, `parent_id` auto-referente e opcional — um clube pode pular direto
pra `campo` sem `distrito`/`regiao` no meio.)

## Papel × Módulo × Ação

Convenção: ✅ = tela/RPC existe e é usada por esse papel hoje. ⚠️ = existe mas parcial/indireto.
❌ = não existe hoje. "Institucional" cobre os 4 papéis fora do clube juntos (o portal trata os 3
nomeados igual; `diretor_mda` é tratado como `coordenador_geral` na tela).

| Módulo | desbravador | conselheiro | instrutor | diretoria | tesoureiro | pais | institucional | admin plataforma |
|---|---|---|---|---|---|---|---|---|
| Perfil próprio | ✅ ver/editar | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | — (domínio próprio) |
| Membros (listar/aprovar) | ❌ | ❌ | ✅ | ✅ | ❌ | ❌ (só filhos) | ⚠️ só agregado | ❌ (nunca vê membro individual) |
| Unidades | ✅ ver a própria | ✅ gere a própria | ✅ | ✅ | ❌ | ❌ | ⚠️ só agregado | ❌ |
| Presença/apontamentos | ❌ | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| Classes (Minha Classe) | ✅ | ❌ | ✅ avalia | ✅ avalia | ❌ | ⚠️ acompanha filho | ❌ | ❌ |
| Especialidades | ✅ (fora do piloto) | ❌ | ✅ avalia | ✅ avalia | ❌ | ❌ | ❌ | ❌ |
| Experiências | ✅ joga | ❌ | ✅ monta | ✅ monta | ❌ | ❌ | ❌ | ❌ |
| Documentos (Central) | ❌ | ❌ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| Assinatura de documento | ❌ | ❌ | ⚠️ só se decidiu a etapa | ⚠️ só se decidiu a etapa | ❌ | ❌ | ❌ (workflow ativo não exige) | ❌ |
| Mural | ✅ | ✅ | ✅ | ✅ moderação | ❌ | ❌ | ❌ | ❌ |
| Chat | ✅ | ✅ | ✅ moderação | ✅ moderação | ❌ | ❌ | ❌ | ❌ (nunca lê conteúdo) |
| Mensalidades | ❌ | ❌ | ❌ | ✅ | ✅ | ⚠️ só a própria | ❌ | ❌ (nunca vê valor individual) |
| Configurações do clube | ❌ | ❌ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| Inscrições (código/QR) | ❌ | ❌ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| Relatórios/radar de faltas | ❌ | ❌ | ✅ | ✅ | ❌ | ❌ | ⚠️ só agregado | ❌ |
| Portal institucional | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ |
| Admin da plataforma (`/admin`) | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |

## Regra fundamental (já implementada, não uma aspiração)

**Hierarquia não é acesso automático.** Confirmado por leitura direta das policies/RPCs
institucionais (`escopo_painel()`, `escopo_investiduras_pendentes()`,
`supabase/migrations/20260921000047_escopo-institucional-e-portal.sql:130-163`): um coordenador
distrital/regional/de campo só recebe **agregados** (contagens) dos clubes descendentes e **decisões
de workflow que exigem explicitamente o papel dele** — nunca chat, foto, evidência, mensalidade
individual ou documento privado de um clube descendente. O mesmo vale, por domínio separado, pro
admin da plataforma: RPCs administrativas (`admin_contas_listar` etc.) nunca leem `mensalidades`,
`chat_mensagens` ou tabelas de evidência — confirmado por auditoria desta rodada, nenhuma policy das
tabelas sensíveis menciona `eh_admin_plataforma()`.

## O que falta (não escondido)

- Workflow institucional ativo hoje não exige nenhuma etapa fora do clube (decisão deliberada,
  documentada na migration 46 — falta de fonte oficial pra Amigo–Guia). Quando houver fonte pra
  Classes de Liderança ou outro nível, a coluna "institucional" acima ganha linhas reais sem
  precisar de migration de schema nova (`investiture_workflow_stages` já suporta `escopo_tipo`
  `distrito`/`regiao`/`campo`).
- Papéis para `igreja`/`uniao`/`divisao` não existem — ninguém pediu ainda.
- Esta matriz cobre os módulos citados no pedido de fechamento; não é exaustiva de toda rota do
  app (haveria dezenas de linhas a mais para jogos/bíblia/bichinho/etc., que seguem o mesmo padrão
  de `permissoes.js`).
