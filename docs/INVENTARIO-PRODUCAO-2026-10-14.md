# Inventário de produção recebido em 14/10/2026

Fonte: exportação CSV da consulta somente leitura executada pelo proprietário no SQL Editor. Não se publicou o CSV bruto nem se acessou produção diretamente. O resultado é uma fotografia da configuração; não comprova autorização de todos os caminhos nem resistência a ataques.

## Configuração observada

- 206 tabelas (198 em public e 8 em storage), todas com RLS habilitada; uma view, chat_mensagens_visiveis, com acesso autenticado e nenhum acesso anônimo direto.
- Nenhuma tabela/view de public concede os privilégios diretos consultados a anon, incluindo acesso por coluna. Privilégios de Storage não significam acesso irrestrito: todas as 33 políticas de storage.objects retornadas são para authenticated, e não há policies para anon/PUBLIC no inventário.
- 179 políticas no total. Políticas SELECT irrestritas retornadas referem-se a catálogos, termos e definições globais; não são, por si, evidência de vazamento de dados pessoais.
- Nove RPCs executáveis sem login: convite_hierarquia_abrir, documento_verificar, entrada_abrir_publico, manutencao_estado, metrica_registrar, parceiros_publico, planos_disponiveis, vitrine_clube_publico e vitrine_clubes_publico. Todas são SECURITY DEFINER com search_path fixado vazio. Esta permissão não demonstra o conteúdo que cada função retorna.
- 463 funções privilegiadas executáveis por authenticated, todas com search_path configurado. Isso reduz uma classe de ataque, mas não comprova checagens internas de clube/cargo/validade.
- anon e authenticated não podem criar objetos no schema public.
- Buckets privados: assinaturas-desenhadas, comprovacoes, comunidade, documentos-emitidos, imagens, suporte-anexos. Buckets públicos: publico e parceiros; ambos restringem MIME a imagens raster. Ser privado não substitui a revisão de policies e URLs assinadas.
- Nenhum match das assinaturas de JWT, sb_secret ou chave privada nas definições de função/gatilho examinadas. Isso NÃO confirma revogação de chaves antigas, nem cobre Vault, histórico, backups, logs ou todos os formatos de segredo.

## Pendências confirmadas ou ainda sem prova

1. Nenhuma das duas entradas esperadas de migrations 548/549 está no ledger retornado. Portanto a aplicação dessas correções NÃO está confirmada em produção; alterações manuais não seriam detectadas por esse indicador. Frontend/Edge/headers também precisam implantação e validação.
2. Existe um administrador ativo, sem fator MFA verificado. Cadastro e exigência no servidor são pendências distintas. Não bloquear o administrador antes de configurar o fator e recuperação.
3. A view do chat não tem RLS próprio, como é esperado para views. O código versionado usa security_invoker=true, mas a consulta recebida não incluiu reloptions/definição da view. Ainda é preciso confirmar essa opção em produção; não classificar a view como brecha somente por relrowsecurity=false.
4. Revogação de JWT, permissões de coluna sensíveis, conteúdo retornado por RPCs públicas, testes REST/Storage/Edge, restauração de backups e rotação de credenciais continuam exigindo evidência específica. MFA cadastrado não comprovaria exigência de AAL2.

## Evidência de testes do PR

No commit 0da134536fff4e99d04fd1c3739ca07b585d4acf, GitHub Actions Segurança executou os 13 testes Node com sucesso. O banco descartável iniciou e aplicou as migrations: 140 arquivos SQL passaram, inclusive 148/149; um falhou (20_matriz_de_auditoria), porque a nova tabela global anon_rpc_cotas não havia sido declarada na lista de exceções. Esta revisão declara a exceção com seu motivo; o controle de isolamento para as demais tabelas permanece. A nova execução precisa confirmar o resultado.

O npm audit reportou 10 vulnerabilidades (3 moderadas, 6 altas, 1 crítica): brace-expansion, sharp e cadeia @capacitor/assets, source-map-js, tar/cadeia Capacitor CLI, undici e uuid/cadeia xcode/@trapezedev/project. Alguns alertas não têm correção automática disponível. A instalação/atualização local permanece indisponível (EPERM); nenhum alerta foi ignorado nem o limiar do workflow foi reduzido. Os alertas continuam bloqueando a aprovação de segurança e precisam correção ou avaliação documentada de alcance/mitigação.

Nenhuma configuração de produção foi alterada ao analisar este inventário. A revisão de segurança continua aberta.
