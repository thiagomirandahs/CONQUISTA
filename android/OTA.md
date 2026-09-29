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

## Reverter
- Telas com defeito que abrem: reverta o commit na `main` → a Vercel publica versão nova (com o código antigo)
  e os aparelhos pegam na próxima abertura.
- Telas que nem abrem: o plugin já volta sozinho ao pacote anterior (ver acima).
- Último recurso: reinstalar o APK zera tudo para as telas embutidas.
