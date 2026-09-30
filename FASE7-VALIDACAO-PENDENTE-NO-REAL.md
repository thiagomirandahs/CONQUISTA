# Fase 7 — validações pendentes em ambiente real (nada aqui está encerrado)

## Abertura do app (correção `d8829c4`, mantida; sem novas mudanças)
Validar em **aparelho Android físico** (APK/OTA e PWA):
- [ ] primeira abertura (instalação limpa)
- [ ] sessão expirada
- [ ] internet lenta
- [ ] sem internet (a sessão salva deve continuar no aparelho)
- [ ] retorno da internet (o app deve continuar sozinho ou pelo "Tentar de novo")
- [ ] fechar e abrir novamente

Hoje só há prova em testes automatizados; a causa no aparelho do dono não foi comprovada.
Depois da instalação, conferir se chegam registros `BOOT:*` em `app_erros` (telemetria de estágios).

## Rede e Trilha (correções `1b30578`, `259d842`, mantidas)
Não considerar encerrados até haver evidência no ambiente real:
- [ ] `/rede/publicar` com foto (post e story) por um membro real
- [ ] `/trilha` com internet ruim: aparece "Tentar de novo" e não há erro `promessa` novo em `app_erros`
