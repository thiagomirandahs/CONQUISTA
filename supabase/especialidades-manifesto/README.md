# Manifesto de Especialidades (fase 7)

**Estado:** só a ESTRUTURA. Nenhum requisito de especialidade foi importado ou inventado.

## O que existe hoje
- Catálogo de nomes (552 especialidades em 8 áreas + mestrados): migration 460, fonte `mda.wiki.br`. Só nome/área/nível/ano/origem.
- Motor no banco (migration 37): `specialties`, `specialty_requirements`, ofertas, `member_specialties`, avaliação. Tem só 1 especialidade de teste.
- Tela `/catalogo-especialidades` (só leitura do catálogo).

## O que esta pasta adiciona
- `areas/<AREA>.json` — um arquivo por área (`AA.json`, `EN.json`…), formato `conquista.especialidades/1`. `exemplo.json` mostra o formato (fictício).
- `validar.mjs` — recusa requisito sem fonte https de domínio reconhecido, sem `status_fonte: "conferido"`, código repetido, etc.
  Especialidade `catalogo` (só nome) nunca chega ao membro; só `publicavel` (com requisitos conferidos).
- `gerar-importacao.mjs` — gera `importacao-especialidades.sql` determinístico (sha256) chamando `curriculo_importar_especialidades(pacote, hash)`.
  **Essa função de banco ainda NÃO existe**: será uma migration futura, com teste SQL, depois da aprovação abaixo.
- Testes: `src/lib/especialidadesManifesto.test.js` (entra no `npm run check`).

## Fontes (para decisão do dono — nada foi importado)
| Fonte | O que dá | Situação |
|---|---|---|
| mda.wiki.br (Manual de Desbravadores Adventistas) | nomes, área, nível, ano, origem; página por especialidade | já é a fonte do catálogo (460); wiki comunitária — requisitos precisam de conferência humana |
| adventistas.org/pt/desbravadores/especialidades | páginas oficiais da DSA | oficial; precisa checar se o texto de cada requisito está disponível e se a reprodução é permitida |
| Livro/Manual de Especialidades (CPB) | texto oficial impresso | direitos autorais: usar paráfrase própria + citar a fonte, como nas Classes |
| Cartões/PDF da DSA-SGC | resumo por área | só como referência de conteúdo (mesma regra das Classes) |

## Estratégia de importação proposta (aguarda aprovação)
1. Começar por **1 área piloto** (sugestão: AA, Atividades Agrícolas) — o dono manda/aprova a fonte e o texto.
2. Cada requisito entra em **paráfrase própria**, com `fonte_url` e `status_fonte: "conferido"` só depois de alguém comparar com a fonte.
3. `tipo_evidencia` definido por requisito (texto/foto/presença/atividade…), como nas Classes.
4. Migration `curriculo_importar_especialidades` (idempotente, hash, versão publicada imutável, guarda de manutenção) + teste SQL.
5. Só depois: liberar a área para os clubes (recurso da plataforma, nasce desligado).
