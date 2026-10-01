import { useEffect } from 'react'
import { URL_IMAGEM_COMPARTILHAR, urlPublicaDoSite } from './dominios.js'

// Título, descrição, canonical, Open Graph e Twitter Card por rota PÚBLICA.
// Cada tag é criada se não existir e restaurada ao sair da página (SPA: não vaza para a próxima rota).
// Obs.: o WhatsApp NÃO executa JS — a prévia dele lê só o index.html estático (que já traz a imagem e o texto
// da página inicial). OG por rota exigiria renderização no servidor/edge, fora do escopo deste SPA.
function meta(atributo, chave, valor) {
  let el = document.head.querySelector(`meta[${atributo}="${chave}"]`)
  const criado = !el
  if (criado) { el = document.createElement('meta'); el.setAttribute(atributo, chave); document.head.appendChild(el) }
  const antes = el.getAttribute('content')
  el.setAttribute('content', valor)
  return () => { if (criado) el.remove(); else el.setAttribute('content', antes ?? '') }
}

function canonico(href) {
  let el = document.head.querySelector('link[rel="canonical"]')
  const criado = !el
  if (criado) { el = document.createElement('link'); el.setAttribute('rel', 'canonical'); document.head.appendChild(el) }
  const antes = el.getAttribute('href')
  el.setAttribute('href', href)
  return () => { if (criado) el.remove(); else el.setAttribute('href', antes ?? '') }
}

// `caminho`: rota pública canônica (ex.: '/conheca'). Sem ele, só título e descrição são atualizados
// (páginas da vitrine com caminho dinâmico mantêm o canonical do index.html).
export function useMetaDaPagina(titulo, descricao, caminho) {
  useEffect(() => {
    const tituloAntes = document.title
    document.title = titulo
    const desfazer = [
      meta('name', 'description', descricao),
      meta('property', 'og:title', titulo),
      meta('property', 'og:description', descricao),
      meta('name', 'twitter:title', titulo),
      meta('name', 'twitter:description', descricao),
    ]
    if (caminho) {
      const url = urlPublicaDoSite(caminho)
      desfazer.push(canonico(url), meta('property', 'og:url', url))
      desfazer.push(meta('property', 'og:image', URL_IMAGEM_COMPARTILHAR), meta('name', 'twitter:image', URL_IMAGEM_COMPARTILHAR))
    }
    return () => { document.title = tituloAntes; desfazer.forEach((f) => f()) }
  }, [titulo, descricao, caminho])
}
