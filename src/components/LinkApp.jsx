import { Link } from 'react-router-dom'
import { urlDoApp } from '../lib/dominios.js'

// Link para uma rota do APLICATIVO. No domínio do site vira navegação para app.<domínio> (outra
// origem: <a href>); onde site e app moram juntos continua sendo o <Link> do roteador.
export default function LinkApp({ to, ...resto }) {
  const destino = urlDoApp(to)
  return destino === to ? <Link to={to} {...resto} /> : <a href={destino} {...resto} />
}
