# HM-049 Arte com Barbante — rascunho de ESTRUTURA (sem texto de requisito)

**Rascunho de trabalho. Não é manifesto, não foi importado, não substitui a fonte oficial.** Os rótulos abaixo são descrições genéricas minhas do *tipo* de exigência observado na wiki mda.wiki.br em 2026-10-01 (extração automática, conferir com humano). O texto de cada requisito só entra depois que o dono resolver direitos e fonte (ver `ESPECIALIDADE-PILOTO-FONTE-E-PROVENIENCIA.md`). Status: **PARADO — depende do dono**.

| Ordem | Tipo observado | `tipo_evidencia` sugerido | Modelo (de `modelos-de-requisito.json`) | Grupo / meta | Avaliador |
|---|---|---|---|---|---|
| 1 | conceitos escritos | `resposta` | `resposta` (texto longo) | — | instrutor |
| 2 | prática com 3 subitens (ângulos) | `foto` ou `atividade` | foto/atividade com anexos (até 3) | — | instrutor |
| 3 | resposta curta com 3 itens | `resposta` | `resposta_lista` (3 itens) | — | instrutor |
| 4 | confecção, escolher 4 de 8 | `foto` | foto/atividade com anexos | `grupos: [{chave: tecnicas, minimo: 4}]`; 8 opções = campo `escolha` do modelo, ou 8 requisitos no grupo (**decisão de modelagem a tomar com o texto oficial**) | instrutor |
| 5 | exposição de trabalho original | `validacao` (+ foto opcional) | `validacao` | — | instrutor/diretoria |
| 6 | lista com no mínimo 5 itens | `resposta` | `resposta_lista` (min 5) | — | instrutor |

Sem dependência, sem prazo, sem meta: a fonte não traz nenhum; não se inventa.
Pendências de modelagem: como representar "4 de 8" (grupo entre requisitos exige 8 requisitos, e `depende_de` não pode apontar para requisito de grupo; o campo `escolha` dentro de um requisito é a alternativa mais simples); se o req. 5 exige foto; aviso de segurança se houver ferramentas.
