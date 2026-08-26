import { montarAvatarSvg } from '../lib/avatarPecas.js'

// Renderiza o avatar customizado (SVG em camadas: roupa, corpo, cabelo, acessório).
export default function AvatarPersonagem({ avatar, size = 'w-12 h-12' }) {
  return (
    <div className={`${size} rounded-full shadow ring-2 ring-white overflow-hidden bg-blue-50 shrink-0`}>
      <svg viewBox="0 0 100 120" xmlns="http://www.w3.org/2000/svg" className="w-full h-full"
        dangerouslySetInnerHTML={{ __html: montarAvatarSvg(avatar) }} />
    </div>
  )
}
