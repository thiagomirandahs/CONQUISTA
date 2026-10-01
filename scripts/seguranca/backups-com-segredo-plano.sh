#!/usr/bin/env bash
# PLANO (somente leitura) para os backups locais que contêm a chave `service_role` antiga. NÃO criptografa, NÃO apaga, NÃO move nada.
# Lista, por pasta de backup: tamanho, quantos arquivos têm JWT literal (sem imprimir o valor) e os comandos SUGERIDOS para criptografar.
#   bash scripts/seguranca/backups-com-segredo-plano.sh [pasta-base ...]      (padrão: ~/.desbravaclube-backups e as pastas backup-conquista-* ao lado do repo)
set -uo pipefail
export MSYS_NO_PATHCONV=1
RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BASES=("$@"); [ ${#BASES[@]} -gt 0 ] || BASES=("$HOME/.desbravaclube-backups" "$RAIZ" "$RAIZ/../../..")
echo "== Backups com JWT literal (service_role antiga) — somente leitura"
for base in "${BASES[@]}"; do
  [ -d "$base" ] || continue
  for d in "$base"/backup-conquista-* "$base"/pre-fase* "$base"/staging/backups; do
    [ -d "$d" ] || continue
    n=$(grep -rla -E 'eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.' "$d" 2>/dev/null | wc -l)
    mb=$(du -sm "$d" 2>/dev/null | cut -f1)
    printf '%-70s %6s MB  arquivos_com_JWT=%s\n' "$d" "$mb" "$n"
  done
done
cat <<'TXT'

== Como proteger (comandos SUGERIDOS — rode um por vez, depois de rotacionar a chave; a senha vem do seu gerenciador de senhas, via prompt)
  1. Empacotar:       tar -cf pasta.tar <pasta>
  2. Criptografar:    gpg --symmetric --cipher-algo AES256 --s2k-mode 3 --s2k-count 65011712 pasta.tar      (pede a senha no terminal; gera pasta.tar.gpg)
  3. Provar a volta:  gpg --decrypt pasta.tar.gpg | sha256sum   == sha256sum pasta.tar   (o hash tem de bater)
  4. Só então, com a SUA confirmação por escrito: apagar a pasta e o .tar em texto claro (Remove-Item -Recurse) e esvaziar a Lixeira.
  5. Guardar o .gpg em 2 lugares (este PC + disco externo/nuvem SUA); a senha NUNCA no mesmo lugar do arquivo.
  Observação: criptografar protege o arquivo parado; a chave só deixa de valer quando for ROTACIONADA (SEGURANCA-ROTACAO-DE-CHAVES.md).
TXT
