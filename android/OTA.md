# Atualização do APK sem reinstalar (OTA)

## Como funciona
- O APK leva as telas **embutidas** (`webDir: dist`, sem `server.url`): abre rápido e abre mesmo sem internet.
  Dentro do APK o endereço é `https://localhost` → `dominios.js` trata como modo `unico` (app completo).
- Plugin **@capgo/capacitor-updater** em modo **manual**, open source, **sem conta Capgo**
  (`autoUpdate:false`; `updateUrl`/`statsUrl`/`channelUrl` vazios = não fala com a Capgo).
- `src/lib/atualizacaoOta.js` (só roda no APK): ao abrir e ao voltar do segundo plano (no máx. 1x/30 min)
  lê `https://app.desbravaclube.com.br/ota/versao.json` (pedido nativo, fora da CSP/CORS da WebView):
  `{ versao, url, sha256, minimoNativo }`.
  - versão igual à do APK/pacote atual → nada;
  - `minimoNativo` maior que a versão do APK instalado → nada (precisa APK novo);
  - senão baixa o zip, o plugin e o app conferem o **sha256**; errado → apaga e ignora;
  - certo → `next()` + atraso `kill`: vale na **próxima abertura** do app (nunca recarrega no meio do uso).
  - Sem internet / erro → silêncio, segue com o que tem.
- No início o app chama `notifyAppReady()`. Se um pacote novo não chegar a chamar isso em 10 s
  (tela quebrada), o plugin **volta sozinho ao pacote anterior** e descarta o com defeito.
- Instalar um APK novo (`resetWhenUpdate`) apaga os pacotes OTA e volta às telas embutidas nele.

## Publicar uma atualização
**Automático**: todo push na `main` → Vercel roda `npm run build:vercel` (= `build` do site + `build:ota`),
que gera `dist/ota/bundle-<versao>.zip` e `dist/ota/versao.json`. Versão = data do commit + hash curto.
`/ota/*` vai com `Cache-Control: no-cache` (vercel.json) e fica fora do service worker.

## Quando é preciso APK novo
Mudou código nativo, plugin Capacitor, ícone/splash, permissões ou `capacitor.config.json`:
1. suba `desbravaclube.otaMinimoNativo` no `package.json` para a versão do APK novo (ex.: `1.4.0`),
   para os APKs velhos não receberem telas que dependem do nativo novo;
2. empurre a tag `v1.4.0` (o workflow `android.yml` monta e assina). A tag tem de ser ≥ `otaMinimoNativo`.
O primeiro APK com OTA é o **v1.3.0** (APKs 1.2.x carregam o site direto e não precisam disso).

## Armadilhas e diagnóstico (aprendido em 02/10/2026)
- **versionName do APK tem de ser numérico.** O workflow `android.yml` usa a tag (`v1.3.8`) ou, no "Run workflow", `<otaMinimoNativo>-ci<execução>`
  (ex.: `1.3.0-ci21`). Antes saía "main" e o app recusava toda atualização (`nativo-antigo`). `decidir()` também não trava por versão ilegível.
- **Não use `setMultiDelay([{kind:'kill'}])`** nem baixe de novo uma versão que já está `pending`: a condição era rearmada a cada abertura
  e a troca nunca valia. O app só chama `next()`; se o plugin já tem o bundle da versão (`pending`), apenas reafirma o `next`.
- **Diagnóstico no aparelho:** Ajuda → fim da tela mostra "Versão das telas", "APK x.y.z" e "Última checagem de atualização"
  (`mesma-versao`, `ja-baixada`, `versao-nova`, `rede`, `nativo-antigo`, `sha-errado`…). Um APK recém-montado diz `mesma-versao` até haver publicação nova.
- **Entregar um APK:** `gh workflow run android.yml --ref main` → `gh run download <id>` → conferir `aapt2 dump badging` (versionName/versionCode) → enviar. Não commitar o `.apk`.
- Efeito no uso: fechar o app por completo e abrir (1–2 vezes) aplica a versão nova.

## Reverter
- Telas com defeito que abrem: reverta o commit na `main` → a Vercel publica versão nova (com o código antigo)
  e os aparelhos pegam na próxima abertura.
- Telas que nem abrem: o plugin já volta sozinho ao pacote anterior (ver acima).
- Último recurso: reinstalar o APK zera tudo para as telas embutidas.
