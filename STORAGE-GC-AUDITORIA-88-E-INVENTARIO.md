# GC do Storage — auditoria dos 88 candidatos + inventário para backfill (01/10/2026)

Somente leitura. **Nenhum arquivo foi apagado nem regravado por esta auditoria.** Todos os 88 existem também na cópia local do Storage feita hoje (recuperáveis). Caminhos não aparecem aqui (só grupos).

## 1. Método
1. Candidatos = `_storage_gc_fatos(null, 30)` categoria `orfao` (nenhuma tabela do catálogo cita o objeto; carência 30 dias): **88 arquivos, 89,6 MB**.
2. `scripts/storage-gc-auditar-orfaos.sql` (READ ONLY): procura o **nome** de cada arquivo em TODAS as colunas texto/json/array do schema `public` e em `auth.users` (inclui metadados, JSON de históricos e snapshots). Resultado: **a única tabela que cita os 88 é `club_storage_objetos.name`** (razão de cota que espelha `storage.objects`; não é referência de uso). Nenhuma outra coluna, nenhuma view e nenhum metadado de usuário cita qualquer um deles.
3. Para cada grupo, uma **explicação positiva** do porquê ficou órfão (arquivo substituído, pai apagado, ou caminho do código que nunca remove o arquivo).
4. Regra do dono: sem prova suficiente = INDETERMINADO.

## 2. Classificação
| Grupo | Arquivos | Prova | Classe |
|---|---|---|---|
| `imagens/perfis` — foto de perfil **substituída** (a pessoa tem hoje outra foto em `profiles.foto`) | 44 (18 pessoas no total do grupo) | `profiles.foto` atual aponta para OUTRO arquivo; nada cita o antigo; 12 dessas pessoas hoje usam o personagem | **A — seguro** |
| `imagens/perfis` — pessoa **não existe mais** | 2 | sem linha em `profiles`; nada cita | **A — seguro** |
| `imagens/atividades` — entrega atual **aponta para outra foto** (reenvio) | 6 | existe `entregas` do mesmo par (atividade, pessoa) com `foto_url` diferente; status aprovada | **A — seguro** |
| `imagens/atividades` — **atividade apagada** | 26 | a atividade (1º UUID do nome) não existe mais; as entregas dela foram junto; nada cita | **A — seguro** |
| `imagens/atividades` — atividade existe, entrega do par **não existe** | 2 | sem entrega e sem explicação positiva (pode ter sido apagada por engano, ou upload cuja gravação falhou) | **C — INDETERMINADO** |
| `imagens/mural` (foto cheia + miniatura) | 6 (4 + 2 miniaturas) | `excluirFoto` (`src/services/mural.js`) apaga **só a linha de `fotos`** e nunca o arquivo; nenhuma linha de `fotos` cita estes; autores ainda existem | **A — seguro** |
| `comprovacoes/<pessoa>/atividades` — **substituída** (entrega do mesmo usuário na mesma hora, com outro arquivo) | 1 | entrega próxima com `foto_url` diferente | **A — seguro** |
| `comprovacoes/<pessoa>/atividades` — pessoa **não existe mais** | 1 | sem linha em `profiles` | **A — seguro** |
| **Total** | **88** | | **A = 86 · B (ainda em uso) = 0 · C = 2** |

Notas e ressalvas (por que "A" não é "apague agora"):
- "A" quer dizer: **nenhuma referência atual ou legada achada e há causa conhecida**. Continua valendo o desenho do GC: exclusão só por lista aprovada pelo dono, em lote pequeno, com backup recente (o de 01/10 cobre todos), e reconferindo as referências **no momento** da exclusão.
- Os arquivos de `imagens/atividades` incluem 2 `.mp4`, 1 `.mov` (≈43 MB no grupo) e 1 `.heic`; `perfis` inclui 1 `.heic` — tipos que o saneador não trata (ver §3).
- A origem das 26 "atividade apagada" é `Atividades` ter sido removida pela liderança: o banco apaga as entregas em cascata, mas o app nunca removeu os arquivos (a mesma lacuna do mural). **Falha de desenho a corrigir** (remover o arquivo junto, ou deixar o GC cuidar) antes de ligar qualquer exclusão automática.
- Classe C (2 arquivos): ficam fora de qualquer lista até haver prova (ex.: perguntar à liderança do clube).
- Dry-run com carência de 7 dias: 118 candidatos (172,1 MB); 30 dias: 88 (89,6 MB). Os 30 a mais (7–30 dias) **não** foram auditados.

## 3. Inventário para backfill do saneamento (cópia local de 01/10, 448 arquivos, 671,8 MB)
`node scripts/storage-inventario-saneamento.mjs --pasta <storage-2026-10-01>` (lê só a cópia local; não toca no Supabase).

| Formato real | Arquivos | Tamanho |
|---|---|---|
| JPEG | 398 | 167,0 MB |
| PNG | 2 | 2,2 MB |
| WebP | 10 | 0,4 MB |
| HEIC | 5 | 10,1 MB |
| GIF | 0 | 0 |
| Vídeo (mp4/mov/webm) | 33 | 492,2 MB |
| Desconhecido/inválido | 0 | 0 |

| Situação (JPEG/PNG/WebP) | Arquivos | Tamanho |
|---|---|---|
| Limpo (sem EXIF/GPS/texto) | 319 | 21,2 MB |
| Com metadados (EXIF/XMP/IPTC/texto) | 75 | 73,9 MB |
| **Com GPS** | **16** | **74,5 MB** |
| **Ainda candidatos ao backfill (JPEG/PNG/WebP com metadados)** | **91** | **148,4 MB** |

Por bucket: imagens 369 (461,2 MB), comprovacoes 65 (209,4 MB), comunidade 10 (1,1 MB), publico 4 (0,2 MB).
Por finalidade: comprovante antigo de atividade 137 (370,1 MB), atividade (comprovações) 45 (207,9 MB), avatar/perfil 95 (27,3 MB), comprovante antigo de missão 58 (25,5 MB), mural 64 (11,6 MB), emblema/bandeira 7 (1,9 MB), missão (comprovações) 19 (1,4 MB), Rede/Comunidade 10 (1,1 MB), logo/marca 4 (0,2 MB), documento da idade 1 (0,1 MB), outros em imagens 8 (24,8 MB).

**Lacunas do saneador (decisões para depois):** (1) **HEIC (5 arquivos)** e **vídeos (33)** não são tratados — vídeo pode carregar localização (QuickTime/MP4) e HEIC carrega EXIF; (2) 16 arquivos com **GPS** são o risco real que o backfill resolveria; (3) `publico` e `assinaturas-desenhadas` ficam de fora de propósito.
**Backfill NÃO executado.** Quando autorizado: `select public.imagem_saneamento_varrer(3650)` (a rotina já passa a processar 8 itens por ciclo de 10 min; os 91 candidatos levariam ~2 h), com observação.
