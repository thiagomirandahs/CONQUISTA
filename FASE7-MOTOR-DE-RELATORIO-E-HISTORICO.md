# Fase 7 — Motor de relatório estruturado, histórico de tentativas e Especialidades ampliado

**Nada aqui foi para produção.** Migrations novas (510, 511, 512) só foram aplicadas em banco local isolado.

## 1. Como funciona (uma engrenagem só, para Classes e Especialidades)
- O requisito **não tem tela própria**: ele traz um **modelo** (`{ versao: 1, campos: [...] }`) e a interface monta o formulário.
  Regras puras no cliente: `src/lib/relatorio/modelo.js`; **o servidor decide** (`_relatorio_validar`, migration 510) — o cliente só avisa cedo.
- **Tipos de campo:** texto curto/longo, número (mín./máx./inteiro — é assim que se faz *meta/quantidade*), data (não futura), seleção,
  checklist (mín./máx. marcados), lista (mín./máx. itens), **entradas repetíveis** (diário de 7 dias), **escolha** (o membro escolhe UMA forma
  e cada forma tem seus campos; opção `pendente` aparece desativada), confirmação e **anexos** (vários; obrigatório ou opcional conforme o modelo).
- **Rascunho** (`requisito_relatorio_salvar` / `especialidade_requisito_relatorio_salvar`): valida só a forma; pode estar incompleto.
- **Envio** (`requisito_enviar` / `especialidade_requisito_enviar`): valida tudo no servidor e **congela conteúdo + anexos em uma tentativa imutável**.
  Requisito **sem** modelo segue exatamente como antes (comprovações antigas não mudam). Requisito com modelo grava também um **resumo em texto**
  em `evidencia_texto`, para telas/PDF antigos continuarem legíveis.

## 2. Histórico completo (Classes e Especialidades)
| Camada | Tabela | Garantia |
|---|---|---|
| Tentativa (conteúdo + anexos + versão do modelo) | `requirement_submissions` (Classes) / `specialty_requirement_submissions` (Especialidades, novo) | append-only: gatilho `_proteger_registro_imutavel` bloqueia update/delete, inclusive para o dono do banco |
| Decisão (quem, papel, quando, comentário) | `requirement_approvals`, ligada à tentativa (`submission_id` / `specialty_submission_id`, única por tentativa) | uma decisão por tentativa; a 2ª é recusada ("já foi avaliada") |
| Fila do avaliador | `classe_avaliacoes_pendentes` / `especialidade_avaliacoes_pendentes` | traz `conteudo`, `anexos`, `modelo`, `submission_id` |
| Histórico | `requisito_historico` / `especialidade_historico` | todas as tentativas com conteúdo, anexos, decisão, avaliador (papel) e comentário |

Fluxo: `Tentativa 1 → conteúdo → anexos → data → avaliador → devolvido → comentário → Tentativa 2 → novo conteúdo → novos anexos → aprovado`.
A tentativa nova **nunca** sobrescreve a antiga (teste 118 e 119).

## 3. Modelos das Classes (71 requisitos de texto)
Manifesto: `supabase/curriculo-manifesto/modelos-de-relatorio/classes.json` (fonte de verdade) → `npm run curriculo:modelos:gerar` →
migration **512** (aditiva e idempotente; tabela `requisito_modelos` imutável, versionada, ligada ao requisito pelo `manifesto_id`).
**Não exigiu versão nova do currículo** (a publicada é imutável). Classificação e regras: `CLASSES-RELATORIOS-CLASSIFICACAO.md`.
Totais: 28 resposta simples · 9 relatório estruturado · 0 foto · 11 atividade/validação · 17 leitura · 6 outro (escolha de forma).
Exceção pendente (regra 10): `guia.V.2` 4ª opção — aparece desativada.

## 4. Especialidades — o que o motor passou a suportar (migration 511)
leitura · resposta · relatório · foto · arquivo · atividade prática · validação do instrutor · meta/quantidade · dependência (`depende_de`) ·
escolha N de M entre requisitos (`specialty_requirement_groups` + `grupo`) · prazo (`prazo_dias`, só na 1ª entrega) · vários anexos ·
proveniência da fonte (url, data da consulta, revisão, status, hash do manifesto). Progresso e conclusão contam o grupo N de M pelo mínimo.
Manifesto/validador/gerador: `supabase/especialidades-manifesto/` (README).

## 5. Piloto LOCAL (nunca produção)
`teste/especialidade-teste.json` → `_fixture_especialidade_teste.sql` (só no teste 119, dentro de transação com ROLLBACK): especialidade
fictícia `TE-001` com 14 requisitos cobrindo todos os tipos. O teste 119 executa o fluxo inteiro: iniciar → rascunho → enviar → avaliar → devolver
→ corrigir → reenviar → aprovar → progresso (75% → 83% → 92%) → conclusão automática → histórico.

## 6. Segurança (todos com teste de ataque)
- Multiclube/RLS: `club_id` derivado no servidor (gatilho de escopo da tentativa); UUID de outro clube → "não encontrado".
- **Ninguém avalia o próprio requisito** (gatilho em `requirement_approvals` + checagem na RPC, Classes e Especialidades).
- **O avaliador não é escolhido pelo cliente**: sai de `auth.uid()`; papel vem de `papel_no_clube`.
- **Anexos**: só do próprio usuário, no clube em uso (formato antigo `<usuário>/…` ou novo `<clube>/<usuário>/…`), existentes no bucket; `..` recusado; máximo do modelo.
  Visíveis só à liderança do clube dono (`lideranca_ve_comprovacao`), nunca a outro clube; não ficam "órfãos" (`_comprovacao_referenciada`).
- Tentativa e modelo **imutáveis**; catálogo novo **sem escrita pela API**; RPCs novas **sem `anon`**.
- **Coordenação institucional** (distrito/região): não lê histórico, fila, tentativas, progresso nem anexos de Classes/Especialidades (a exceção pré-existente das Classes é só a etapa de aprovação de investidura, que não foi tocada).

## 7. Interface (frontend)
- `FormularioRelatorio` (único, montado do modelo: todos os tipos, rascunho com autosave de 1,5 s que **nunca envia**, validação em português perto do campo,
  anexos com mín./máx., somente leitura, comentário de devolução em destaque), `RelatorioLeitura` (o que foi enviado, para avaliador/histórico) e
  `HistoricoTentativas` (Tentativa 1, 2… sem sobrescrever). Integrado em Minha Classe, Avaliar Classe, Minhas Especialidades e Avaliar Especialidades.
- Minha Classe carrega **todos** os formulários da matrícula numa chamada só (`classe_formularios`) — sem "piscar" e sem 1 chamada por requisito em 4G fraco.
- Requisito **sem** formulário mantém a tela antiga. Verificado no navegador em 375 px: sem rolagem lateral; opção "decisão pendente" desativada.

## 8. Ordem de publicação (quando o dono autorizar — nada foi feito)
1. **Publicar o app novo (frontend) ANTES ou JUNTO das migrations 510–512.** Telas antigas em cache continuam funcionando por causa do **modo compatível**
   (requisito com formulário, sem rascunho estruturado → envia texto/foto como sempre), mas só o app novo mostra o formulário.
2. Aplicar 510, 511 e 512 em transação com `lock_timeout` e registrar no ledger; conferir o Tenant 001 antes e depois (regra do CLAUDE.md).
3. Especialidades reais: só depois de aprovar fonte/piloto (nenhuma foi importada).

## 9. Rascunho offline (não perder o texto quando o 4G cai)
digitou → salva no aparelho (300 ms) → sincroniza (1,5 s) → offline mantém local → volta a rede/aba → sincroniza sozinho. **Só rascunho: nunca envia.**
Indicador: "Salvando..." · "Salvo" · "Salvo neste aparelho" · "Erro ao sincronizar" (+ "Tentar de novo").
**Conflito** (o aparelho e o servidor têm rascunhos diferentes): nada é sobrescrito em silêncio — aviso com "Usar o do servidor" / "Usar o deste aparelho"; a versão não escolhida vira cópia recuperável.
Requisito já enviado/aprovado com texto local pendente → cópia de segurança + aviso. Envio bem-sucedido limpa o local; sair da conta limpa `cq.rel.*`.
Limite: arquivo que não subiu offline não é guardado (só o texto).

## 10. Escala das Especialidades (migration 513, dados SINTÉTICOS só em teste)
`especialidades_buscar`: página leve (≤ 50) por cursor, busca (curingas escapados), filtro por área e situação (todas/disponíveis/iniciadas/concluídas), progresso e dependência já resolvidos.
Teste SQL 120 com 552 especialidades / 5.520 requisitos: 12 páginas em ~24 ms, maior página ~15 KB, sem repetir nem pular item. Vitest: 552×10 no validador/gerador.
Tela: `ListaEspecialidades` (busca com atraso, área, abas, "Carregar mais", corrida de respostas descartada). Ainda sem paginar: a tela de **criar turma** (`AvaliarEspecialidades`, só liderança) usa `especialidades_disponiveis`.

## 11. Cadastrar uma especialidade sem SQL manual (depois da aprovação da fonte)
`npm run especialidades:nova -- HM-049 "Arte com Barbante" --nivel 1 --fonte-url <https>` → copiar requisitos de `modelos-de-requisito.json` (todos os tipos prontos) → preencher com o texto CONFERIDO (paráfrase) → `estado: "publicavel"` → `npm run especialidades:validar` → `gerar-importacao.mjs --migration NNN HM`. HM-049 segue só como candidata (não criada).

## 12. Testes desta rodada
E2E local (banco local de trabalho com 510–513 aplicadas): relatório 95/95, fluxo 87, PDF 41, lote 12, storage 48, contexto 42, Rede 55, chamados 36, personas 59, documento 20. Compatibilidade 510–513 sobre dados antigos (`npm run test:db:compat`). Interface auditada em 360/390/430/768/1024/1366.
E2E antigos ajustados aos contratos novos (foto do documento 380; ninguém avalia o próprio requisito; catálogo de 17 recursos). O E2E de autenticação depende do Inbucket local (porta 54324 não publicada nesta máquina) e não foi executado.

## 13. Pendências
- Decisão do dono: `guia.V.2` (4ª opção); fonte/piloto real das Especialidades; quem confirma além de diretoria/instrutor.
- Teste em aparelho real e em produção (nada aplicado em produção).
