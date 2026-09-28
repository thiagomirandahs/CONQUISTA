import { useEffect, useState } from 'react'
import { autorizacoesDosFilhos, autorizar, responsavelImagem } from '../services/comunidade.js'
import { avisar } from '../ui/avisos.jsx'
import { Botao, Card } from '../ui/index.jsx'

// Autorização do RESPONSÁVEL para o filho usar a Comunidade (migration 432). Sem ela o servidor não deixa
// o desbravador ver, publicar nem comentar. O responsável pode revogar a qualquer momento: o que o filho
// publicou naquele clube sai da Comunidade na hora. Só aparece quando a plataforma ligou a Comunidade.
export default function AutorizacaoComunidade() {
  const [dados, setDados] = useState(null)
  const [ocupado, setOcupado] = useState(null)

  const carregar = () => autorizacoesDosFilhos().then(setDados).catch(() => setDados(null))
  useEffect(() => { carregar() }, [])

  if (!dados?.recurso_ligado || !dados.filhos?.length) return null

  async function alternar(f) {
    const novo = !f.autorizado
    if (!novo && !(await avisar.confirmar({ titulo: `Revogar a Comunidade de ${f.nome}?`,
      descricao: 'O que foi publicado ou comentado sai da Comunidade agora.', rotulo: 'Revogar' }))) return
    setOcupado(f.desbravador_id)
    try {
      await autorizar(f.desbravador_id, novo)
      avisar.sucesso(novo ? 'Autorizado! 🙂' : 'Autorização revogada.')
      await carregar()
    } catch (e) { avisar.erro(e, 'Não consegui salvar a autorização.') }
    setOcupado(null)
  }

  async function alternarImagem(f) {
    const desligar = !f.imagem_desligada
    if (desligar && !(await avisar.confirmar({ titulo: `Desligar a foto de ${f.nome} na Rede DBV?`,
      descricao: 'O perfil passa a mostrar só as iniciais, em todos os clubes.', rotulo: 'Desligar' }))) return
    setOcupado(`img-${f.desbravador_id}`)
    try {
      await responsavelImagem(f.desbravador_id, desligar)
      avisar.sucesso(desligar ? 'Foto desligada na rede.' : 'Pronto: vale de novo o que a diretoria arquivou.')
      await carregar()
    } catch (e) { avisar.erro(e, 'Não consegui salvar.') }
    setOcupado(null)
  }

  return (
    <Card className="mb-3" aria-labelledby="titulo-autorizacao-comunidade">
      <h3 id="titulo-autorizacao-comunidade" className="font-extrabold text-ink">🌎 Rede DBV (entre clubes)</h3>
      <p className="text-xs text-muted mt-1 mb-3">
        Um feed com publicações de desbravadores de outros clubes. Tudo passa por triagem automática, não existe mensagem
        privada e a diretoria do clube modera. Seu filho só participa com a sua autorização.
      </p>
      <ul className="space-y-2">
        {dados.filhos.map((f) => (
          <li key={f.desbravador_id} className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="font-bold text-ink truncate">{f.nome}</p>
              <p className="text-xs text-muted">{f.autorizado ? 'Autorizado' : 'Não autorizado'}</p>
            </div>
            <Botao variacao={f.autorizado ? 'secundario' : 'primario'} carregando={ocupado === f.desbravador_id}
              aoTocar={() => alternar(f)}>{f.autorizado ? 'Revogar' : 'Autorizar'}</Botao>
          </li>
        ))}
      </ul>
      <h4 className="font-bold text-ink text-sm mt-4">📷 Foto de rosto no perfil da rede</h4>
      <p className="text-xs text-muted mt-1 mb-2">
        A foto só aparece quando a diretoria arquivou o termo de uso de imagem que você assinou. Você pode desligar quando quiser.
      </p>
      <ul className="space-y-2">
        {dados.filhos.map((f) => (
          <li key={`img-${f.desbravador_id}`} className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="font-bold text-ink truncate">{f.nome}</p>
              <p className="text-xs text-muted">
                {f.imagem_desligada ? 'Desligada por você' : f.imagem_autorizada ? 'Foto aparece na rede' : f.imagem_arquivada ? 'Arquivada' : 'Diretoria ainda não arquivou (só iniciais)'}
              </p>
            </div>
            <Botao variacao="secundario" carregando={ocupado === `img-${f.desbravador_id}`}
              aoTocar={() => alternarImagem(f)}>{f.imagem_desligada ? 'Religar foto' : 'Desligar foto'}</Botao>
          </li>
        ))}
      </ul>
    </Card>
  )
}
