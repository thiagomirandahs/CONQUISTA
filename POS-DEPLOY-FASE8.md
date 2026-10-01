# Pós-deploy da Fase 8 — auditoria, pendências e proposta da Fase 9 (01/10/2026)

Somente leitura em produção (a única escrita simulada foi a de transações terminadas em ROLLBACK). main = Vercel = `62c3665`, banco = migration 527.

## 1. Auditoria da produção
| Item | Resultado |
|---|---|
| Ledger | 527 (187 registros; 514–527 presentes) |
| Contagens (vínculos 55 ativos/2 pendentes/1 encerrado, 29 matrículas em andamento + 4 canceladas, 37 mensalidades, 4 subscriptions, 4 clubes, 0 conquistas de classe) | idênticas ao pós-527; nenhuma mudança indevida |
| Tenant 001 | impressão digital idêntica ao backup pré-Fase 8 |
| Storage | 447 → 448 objetos (+1 em `comprovacoes`: envio **real** de um usuário depois do deploy; não foi nosso) |
| RLS | 0 tabelas sem RLS. 79 com RLS e sem policy = acesso só por RPC (padrão do projeto); as 7 novas da Fase 8 seguem o mesmo padrão |
| Grants | `anon` sem INSERT/UPDATE/DELETE; `anon` executa só 8 RPCs públicas (convite, documento_verificar, entrada, manutenção, parceiros, planos, vitrine ×2) |
| SECURITY DEFINER | 0 sem `search_path` fixo |
| Gatilho de manutenção | as mesmas 7 tabelas de log/infra sem guarda de antes; as tabelas novas têm |
| RPCs do front | 337 chamadas pelo código; todas existem em produção |
| Erros do app | 0 em `app_erros` desde o deploy (3 no dia, todos antes) |
| Modo manutenção | desligado; 0 transações longas |
| Regressões da Fase 8 | **nenhuma encontrada** |
| Buckets | públicos só `publico` e `parceiros`; os outros 6 privados; 33 policies de Storage |

## 2. Admin SaaS (sem senha, sem contornar autenticação)
- 72 RPCs `admin_*`: **0** executáveis por `anon`, **72** com guarda de admin no corpo.
- Teste de contrato (identidade simulada pelo servidor, transação com ROLLBACK, `scripts/janela-fase8/auditoria-admin-permissoes.sql`): 20 RPCs de leitura × 4 papéis → **platform_admin PERMITIDO (20/20); diretoria, desbravador e conta sem vínculo NEGADO (60/60)**.
- Coordenação: coberta pelos testes SQL 71/73/76/109 (não repeti em produção).
- Seções Visão Geral, Clubes, Detalhe, Planos, Assinaturas, Armazenamento, Onboarding, Suporte, Auditoria: contrato/permissão OK pelas RPCs; **visual autenticado: PENDENTE — TESTE AUTENTICADO** (precisa de sessão sua).

## 3. Achado novo de segurança (classe A)
O gatilho legado `push-notificacoes` (webhook criado pelo painel) tem **a chave `service_role` escrita na própria definição**. Consequência: ela aparece em qualquer dump/backup do banco e apareceu num log desta sessão (saída do `pg_restore`). Não há vazamento para fora do seu computador nem do repositório (verifiquei: nada versionado). Recomendação: tratar os backups como segredo (criptografar), e, quando decidir, trocar o webhook por uma chamada que leia a chave do Vault e **rotacionar a chave** (decisão sua; rotacionar exige atualizar as Edge Functions).

## 4. APK
Não gerei outro. APK atual = `62c3665`. Melhoria futura: versionName "main" → oficial **v1.3.9** (tag só com sua autorização; `versionCode` 16 > 15 instalado). Observação: o OTA já entrega o front novo ao 1.3.8 instalado, pois não houve mudança nativa.

## 5. Matriz de pendências (Fases 6, 7 e 8)
Legenda: **Agora?** = posso resolver já · **Dono?** = depende de você · **And.?** = depende do aparelho Android.

### A — Segurança / dados
| # | Problema | Impacto | Estado | Agora? | Dono? | And.? |
|---|---|---|---|---|---|---|
| A1 | Chave `service_role` dentro do gatilho `push-notificacoes` | Segredo em todo dump/backup | Aberto (novo) | Preparar troca para Vault; rotação é decisão | Sim (rotacionar) | Não |
| A2 | Credenciais de produção em `~/.desbravaclube-prod.env` e senha em texto em `PLANO-JANELA-MIGRACAO-REAL.md` (não versionado) | Quem pegar o PC acessa a produção | Aberto | Não | **Sim** (trocar senha do banco, revogar token, apagar arquivos) | Não |
| A3 | 2FA do platform_admin; revisar admins (há 1); senha vazada | Conta-chave da plataforma | Aberto | Não | **Sim** (painel) | Não |
| A4 | Pipeline de imagens/EXIF no servidor | Cliente adulterado sobe foto com GPS | Proposta pronta (`IMAGENS-PROPOSTA-PROXIMA-MIGRATION.md`) | Sim (Fase 9) | Decisão D5 | Não |
| A5 | Log de leitura do platform_admin no Storage registra a mais | Auditoria ruidosa (lado seguro) | Aberto | Sim (RPC de assinatura) | Não | Não |
| A6 | Expurgo de clube deixa arquivo físico órfão; membro pode plantar arquivo em `conclusao-anterior` | Custo/cota, não vazamento | Desenho em `STORAGE-GC-DESENHO.md` | Parcial | 3 decisões suas | Não |
| A7 | Backup só no computador, sem criptografia | Perda total se o PC falhar | Plano em `CHECKLIST-SMTP-E-BACKUP.md` | Preparar | Sim (autorizar envio) | Não |
| A8 | Termos/Privacidade (LGPD) não publicados (branch `termos`) | Risco jurídico | Aguarda dados do titular + advogado | Não | **Sim** | Não |
| A9 | Plano Supabase sem backup automático/PITR | Sem retorno em desastre | Mitigado com backup manual | Não | Sim (custo) | Não |

### B — Bugs / validação
| # | Problema | Impacto | Estado | Agora? | Dono? | And.? |
|---|---|---|---|---|---|---|
| B1 | Abertura do APK travada na 1ª abertura | Primeira impressão | Corrigido na Fase 7 (prazos, "Tentar de novo", telemetria `BOOT:*`); **não provado no aparelho** | Não | Não | **Sim** |
| B2 | `/rede/publicar` com foto e `/trilha` ruim: validar sem erro novo | Rede/Trilha | Só testes automáticos | Não | Não | **Sim** |
| B3 | Interruptor de som do Perfil (animação) | Visual | Suspeita de artefato de teste | Não | Não | **Sim** |
| B4 | 3 membros ativos sem nascimento; 1 matrícula Guia 2026.2 em versão arquivada (Tenant 001) | Não iniciam classe nova até preencher a data | Esperado | Orientar | Sim (avisar o membro) | Não |
| B5 | Gatilho legado do push gerava 401 (webhook do painel) | Ruído em logs | Verificar se persiste após FCM (1.3.8) | Sim | Não | Não |
| B6 | Domínio antigo da Vercel responde 200 na raiz (redireciona nas demais rotas) | Confusão/SEO | Aberto, baixo | Sim | Autorizar | Não |
| B7 | Diretoria única não aprova a própria classe | Clube de 1 pessoa trava | Regra sem exceção, por decisão | Não | **Decisão** | Não |
| B8 | Prévia do WhatsApp igual em todas as rotas | Marketing | Aberto, baixo | Fase própria | Não | Não |

### C — Infraestrutura
| # | Problema | Estado | Agora? | Dono? |
|---|---|---|---|---|
| C1 | SMTP próprio + SPF/DKIM/DMARC; templates; confirmação de e-mail | Scripts e checklist prontos, nada ativado | Preparado | **Sim** (provedor, DNS, senha) |
| C2 | APK com versionName "main" → v1.3.9 | Aberto | Sim | Autorizar tag |
| C3 | Backups externos/automáticos | Recomendação pronta | Sim (script agendado) | Autorizar destino |
| C4 | `FCM_SERVICE_ACCOUNT` nos Secrets | Push FCM já funciona no 1.3.8 (confirmado antes) | — | — |

### D — UX / mobile
| # | Problema | Estado | And.? |
|---|---|---|---|
| D1 | Safe-area (gestos/3 botões), teclado, câmera, seletor de arquivos, compartilhar, QR, OTA, iPhone/PWA | Só simulado; roteiro pronto | **Sim** |
| D2 | Botão primário azul→ciano vs. marinho/dourado da Rede | Decisão de identidade sua | Não |
| D3 | Pontos do `/conheca` com 32×44 px | Baixo | Não |
| D4 | `input type=file` crus em Atividades, Perfil, Suporte, Unidades, ClubeConfig, Cadastro, DocumentoDaIdade | Padronizar ZonaUpload | Não |
| D5 | Telas da liderança sem foto de tentativas antigas (banco já permite) | Funcional, baixo | Não |
| D6 | Anexos offline (só texto fica no aparelho) | Fila segura de upload | Sim (teste) |

### E — Conteúdo
| # | Pendência | Depende |
|---|---|---|
| E1 | Especialidades reais (nenhum requisito importado; HM-049 só candidata) | Dono (fonte/permissão/piloto) |
| E2 | Classes de Liderança (motor só regular/avançada; sem conteúdo oficial) | Dono + conteúdo |
| E3 | `guia.V.2` 4ª opção sem regra de comprovação | Dono |
| E4 | Audiolivros: Galápagos, O Fim do Começo, O Desejado de Todas as Nações, O Maior Discurso de Cristo desligados; 4 ligados sem fonte/licença documentada; Curso de Leitura 2026 sem fonte | Dono |
| E5 | Provas dos 41 requisitos de especialidade nas Classes: obrigatória ou opcional? | Dono |
| E6 | Capas dos livros (nenhuma URL inventada) | Dono |
| E7 | Roteiros de vídeo (Fase 6) para aprovar | Dono |

### F — Melhoria futura
| # | Item |
|---|---|
| F1 | Atualização assistida de matrícula entre versões (hoje permanece; `classe_atualizacao_previa` informativa; equivalências vazias) |
| F2 | Refinamentos da Rede DBV (conferir em uso real; Comunidade só liga clube a clube) |
| F3 | Apresentação/tutorial e experiência mobile |
| F4 | Gateway de pagamento real (hoje sem) |
| F5 | Certificado PDF / insígnia de especialidade (decisões do módulo) |
| F6 | Contagem de investidura por pessoa (hoje por matrícula/clube — decisão tomada) |

## 6. Proposta da Fase 9 (para você priorizar; nada iniciado)
**Bloco 1 — Fechar o que ficou em aberto (curto, alto valor)**
1. Validação Android real (`ROTEIRO-ANDROID-REAL-FASE8.md`) e correções que aparecerem; tag v1.3.9.
2. SMTP + templates + recuperação de senha → só depois confirmação de e-mail.
3. Higiene de segurança: troca de credenciais (A1, A2, A3), backup externo criptografado e rotina semanal.

**Bloco 2 — Segurança de dados de imagens e Storage**
4. Pipeline de imagens/EXIF no servidor (A4) + log de leitura por RPC (A5) + GC não destrutivo de Storage (A6).

**Bloco 3 — Conteúdo (depende de você)**
5. Especialidades reais: escolher fonte/piloto (1 especialidade ponta a ponta) e depois lotes.
6. Audiolivros: religar um a um quando houver fonte.
7. Classes de Liderança: só quando houver conteúdo oficial (importador `tipo_classe='lideranca'`).

**Bloco 4 — Produto**
8. Atualização segura de matrícula entre versões (migração assistida com equivalências).
9. Anexos offline (fila de upload segura).
10. Refinos da Rede, tutorial/apresentação e padronização mobile (D4).

**Recomendação de ordem:** Bloco 1 inteiro → A4/A5 → Especialidades piloto → resto. Os itens do Bloco 1 não dependem de código novo grande; o 1 depende do seu celular e o 2 e o 3 dependem de você.
