/* Vigia da abertura (fase 7). Roda ANTES do app: se depois de 15 s o app ainda não iniciou (o JavaScript
   não carregou — rede ruim no PWA, arquivo que não veio), a abertura deixa de "girar para sempre" e
   mostra o aviso com "Tentar de novo". O app marca `window.__cqIniciou = true` assim que começa; a partir
   daí este vigia não faz nada. Se o app iniciar DEPOIS do aviso, a abertura inteira (aviso incluso) sai
   normalmente. JavaScript antigo de propósito (ES5): precisa funcionar no WebView mais simples. */
(function () {
  var LIMITE_MS = 15000
  function mostrar() {
    if (window.__cqIniciou) return
    var el = document.getElementById('abertura')
    if (!el || el.querySelector('.ab-problema')) return
    var barra = el.querySelector('.ab-barra')
    if (barra) barra.style.display = 'none'
    var caixa = document.createElement('div')
    caixa.className = 'ab-problema'
    caixa.setAttribute('data-testid', 'vigia-abertura')
    var t = document.createElement('p'); t.className = 'ab-problema-titulo'; t.appendChild(document.createTextNode('Não deu para abrir agora'))
    var x = document.createElement('p'); x.className = 'ab-problema-texto'; x.appendChild(document.createTextNode('Confira a internet e tente de novo. Nada foi perdido.'))
    var b = document.createElement('button'); b.type = 'button'; b.className = 'ab-botao'; b.appendChild(document.createTextNode('Tentar de novo'))
    b.onclick = function () { window.location.reload() }
    caixa.appendChild(t); caixa.appendChild(x); caixa.appendChild(b)
    el.appendChild(caixa)
  }
  window.setTimeout(mostrar, LIMITE_MS)
})()
