# Implantação das correções de segurança

Este roteiro prepara a execução pelo administrador. Nada deste documento configura ou acessa produção automaticamente. Conferir os checks do commit final do PR antes de aplicar.

## Alterações das dependências

Removido @capacitor/assets, ausente dos scripts, da CI Android e dos usos encontrados na busca do repositório. Os ícones/splashes já gerados permanecem versionados em android/app/src/main/res; build e cap sync continuam disponíveis. Para gerar novos ícones no futuro, escolher uma ferramenta revisada antes de instalar; não reinstalar a cadeia vulnerável antiga.

Capacitor CLI atualizado para 8.5.3; xcode usa uuid 11.1.1 por override escopado, mantendo suporte CommonJS. Lockfile gerado com npm no runner descartável, sem scripts de instalação na geração. brace-expansion 1.1.21/2.1.7, source-map-js 1.2.2 e undici 8.12.1 incluem as atualizações apontadas pela auditoria. tar 7.5.22 permanece na cadeia atual; a versão 6 da ferramenta removida sai do lockfile. O npm audit da proposta retornou zero alertas em 14/10/2026; repetir no commit final, pois a base de avisos muda.

CI normal verifica lint, React e builds por ambiente. Segurança verifica os 13 testes Node, auditoria, migrations e suite SQL em banco descartável. O job ferramentas-android verifica o UUID do consumidor xcode, carrega esse parser e faz build:cap + cap sync android. Isso não é compilação de APK, teste de iOS ou teste físico de Android.

## Banco, frontend e Edge

1. Confirmar um backup recuperável do banco e os arquivos do Storage; o backup do banco não contém necessariamente os arquivos. Usar a janela de manutenção da aplicação para o conjunto da implantação.
2. No SQL Editor executar scripts/seguranca/aplicar-correcoes-548-549.sql. É a união das migrations 548/549 em UMA transação. Se uma instrução falhar, interromper, executar ROLLBACK se necessário e enviar somente a mensagem de erro. Não marcar o passo como aplicado antes de COMMIT. Em fluxo de migrations via CLI, aplicar as migrations originais em vez de duplicar os mecanismos de implantação.
3. Publicar o frontend e os headers de vercel.json do mesmo commit e as Edge Functions alteradas: licenca-infinitepay, gerar-documento-pdf, gerar-documento-pdf-final e admin-comunidade-foto. Não habilitar cobrança neste procedimento; depende da homologação do provedor.
4. Executar scripts/seguranca/verificar-pos-implantacao.sql. Esperado: duas migrations; view_chat=true; criar_objetos=false para ambos os papéis; nenhuma linha acesso_anonimo_direto/helper_privado_exposto. Repetir também o inventário completo fornecido anteriormente.
5. Com contas de teste, conferir acesso cruzado entre clubes, diretoria expirada, verificação pública com código válido/inválido, logout com falha de rede, troca de conta e renovação de imagem privada após dez minutos. Não usar dados reais de menores para testes adversariais.

## MFA administrativo: configuração ainda pendente

O CSV mostrou um administrador ativo sem fator verificado. Há duas proteções diferentes: 2FA da conta que administra o painel Supabase e MFA do administrador dentro do aplicativo. Ativar uma não substitui a outra.

No painel do projeto, conferir Authentication/Multi-Factor Authentication e habilitar o fator pretendido (ex.: TOTP). O app ainda precisa de uma tela de enrollment/challenge usando enroll, challenge e verify do Supabase Auth; configurar recuperação antes de impor a exigência. Cadastrar e validar o fator do administrador primeiro. Depois exigir aal2 nas operações administrativas no servidor e testar token aal1 diretamente contra RPC/REST/Edge. Um redirect no frontend ou um fator cadastrado não comprova bloqueio no servidor. Essa implantação de MFA ainda NÃO faz parte das migrations 548/549: não executar uma policy indiscriminada que bloqueie o administrador antes desse fluxo estar pronto.

Revogação imediata de access JWT, rotação de chaves antigas, configuração de WAF/CAPTCHA e restauração de backup continuam exigindo evidência própria e acesso de administração. Não declarar essas proteções concluídas com base no npm audit ou no RLS habilitado.
