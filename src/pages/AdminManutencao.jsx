import { useCallback, useEffect, useState } from 'react'
import { Card, Botao, Aviso, Campo } from '../ui/index.jsx'
import { avisar } from '../ui/avisos.jsx'
import { Chip, Esqueleto, Nota } from '../components/admin/AdminUI.jsx'
import { lerEstadoManutencao, adminDefinirManutencao } from '../services/manutencao.js'
import { horaCurta } from '../lib/manutencao.js'

// /admin › Manutenção (migration 400). Toda mudança é auditada no servidor (aba Auditoria).
//  1) Aviso prévio: horário + mensagem → faixa em todas as telas ("vai entrar em manutenção às HH:MM").
//  2) Ligar/desligar agora: ligada, o app mostra a tela de manutenção e o servidor RECUSA escrita de
//     quem não é admin da plataforma (nada fica pela metade). Você continua entrando para testar.

// "2026-09-28T22:00" (datetime-local, hora do aparelho) ⇄ Date
const paraCampo = (d) => {
  if (!d) return ''
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}

export default function AdminManutencao() {
  const [estado, setEstado] = useState(null)
  const [erro, setErro] = useState('')
  const [mensagem, setMensagem] = useState('')
  const [inicio, setInicio] = useState('')
  const [avisoMsg, setAvisoMsg] = useState('')
  const [ocupado, setOcupado] = useState(false)

  const carregar = useCallback(() => {
    lerEstadoManutencao().then((e) => {
      setErro(''); setEstado(e)
      setMensagem(e.mensagem || '')
      setInicio(paraCampo(e.avisoInicio)); setAvisoMsg(e.avisoMensagem || '')
    }).catch((e) => setErro(e?.message || String(e)))
  }, [])
  useEffect(() => { carregar() }, [carregar])

  async function aplicar(dados, sucesso) {
    setOcupado(true)
    try {
      const e = await adminDefinirManutencao(dados)
      setEstado(e); setInicio(paraCampo(e.avisoInicio)); setAvisoMsg(e.avisoMensagem || '')
      avisar.sucesso(sucesso)
    } catch (e) { avisar.erro(e) } finally { setOcupado(false) }
  }

  async function agendar() {
    const d = inicio ? new Date(inicio) : null
    if (!d || Number.isNaN(d.getTime())) { avisar.erro(null, 'Escolha o horário de início.'); return }
    await aplicar({ ativo: false, mensagem, avisoInicio: d, avisoMensagem: avisoMsg }, `Aviso publicado: manutenção às ${horaCurta(d)}.`)
  }

  async function ligar() {
    const ok = await avisar.confirmar({ titulo: 'Ligar a manutenção agora?',
      descricao: 'Todo mundo (menos a equipe da plataforma) passa a ver a tela de manutenção e nada pode ser salvo até você desligar.',
      rotulo: 'Ligar manutenção' })
    if (ok) await aplicar({ ativo: true, mensagem }, 'Manutenção LIGADA.')
  }

  if (erro) return <Aviso tom="erro" titulo="Não deu pra carregar">{erro}</Aviso>
  if (!estado) return <Esqueleto avatar={false} />

  return (
    <div className="space-y-3" data-testid="admin-manutencao">
      <Nota icone="🛠️"><strong className="text-ink">Modo manutenção.</strong>{' '}
        Ligada, o app mostra “Estamos em manutenção” e o servidor recusa qualquer gravação de usuário — ninguém salva
        pela metade. Textos em andamento (resposta de requisito, chat, chamado) e resultados de jogo ficam guardados no
        aparelho. Você (admin da plataforma) continua entrando para testar.
      </Nota>

      <Card>
        <div className="flex items-center gap-2">
          <p className="flex-1 font-bold text-ink">Situação agora</p>
          <Chip tom={estado.ativo ? 'perigo' : estado.avisoInicio ? 'atencao' : 'ok'} ponto data-testid="manutencao-situacao">
            {estado.ativo ? 'Em manutenção' : estado.avisoInicio ? `Aviso: ${horaCurta(estado.avisoInicio)}` : 'Normal'}
          </Chip>
        </div>
        <Campo id="manut-mensagem" rotulo="Mensagem da tela de manutenção" linhas={2} maxLength={300} value={mensagem}
          onChange={(e) => setMensagem(e.target.value)} ajuda="Ex.: Voltamos até as 22h." />
        {estado.ativo
          ? <Botao className="w-full" carregando={ocupado} desabilitado={ocupado}
              aoTocar={() => aplicar({ ativo: false }, 'Manutenção desligada. O app voltou ao normal.')}>Desligar manutenção</Botao>
          : <Botao className="w-full" variacao="perigo" carregando={ocupado} desabilitado={ocupado} aoTocar={ligar} data-testid="manutencao-ligar">Ligar manutenção agora</Botao>}
      </Card>

      {!estado.ativo && (
        <Card>
          <p className="font-bold text-ink mb-1">Aviso prévio</p>
          <p className="text-xs text-muted mb-3">Todos veem uma faixa: “O app vai entrar em manutenção às HH:MM. Termine o que está fazendo.” O aviso não liga nada sozinho — na hora, toque em “Ligar manutenção agora”.</p>
          <Campo id="manut-inicio" rotulo="Horário de início" tipo="datetime-local" value={inicio} onChange={(e) => setInicio(e.target.value)} />
          <Campo id="manut-aviso" rotulo="Texto extra da faixa (opcional)" maxLength={300} value={avisoMsg} onChange={(e) => setAvisoMsg(e.target.value)} />
          <div className="grid grid-cols-2 gap-2">
            <Botao carregando={ocupado} desabilitado={ocupado} aoTocar={agendar}>Publicar aviso</Botao>
            <Botao variacao="secundario" desabilitado={ocupado || !estado.avisoInicio}
              aoTocar={() => aplicar({ ativo: false, mensagem }, 'Aviso retirado.')}>Retirar aviso</Botao>
          </div>
        </Card>
      )}
    </div>
  )
}
