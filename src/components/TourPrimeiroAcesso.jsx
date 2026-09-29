import TourDaArea from './TourDaArea.jsx'

// Compatibilidade: o tour de primeiro acesso agora é o mini-tour 'primeiros-passos' (ver TourDaArea).
export default function TourPrimeiroAcesso({ uid, forcar = false, aoFechar }) {
  return <TourDaArea id="primeiros-passos" uid={uid} forcar={forcar} aoFechar={aoFechar} />
}
