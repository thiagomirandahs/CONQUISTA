import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from './context/Auth.jsx'
import AppLayout from './components/AppLayout.jsx'
import Logo from './components/Logo.jsx'
import Login from './pages/Login.jsx'
import Cadastro from './pages/Cadastro.jsx'
import Ranking from './pages/Ranking.jsx'
import Atividades from './pages/Atividades.jsx'
import Unidades from './pages/Unidades.jsx'
import Mural from './pages/Mural.jsx'
import Aprovacoes from './pages/Aprovacoes.jsx'

// Tela de carregamento enquanto verifica o login
function Carregando() {
  return (
    <div className="min-h-full grid place-items-center bg-azul text-white">
      <div className="text-center">
        <Logo className="w-16 h-16 mx-auto mb-3" />
        <p className="text-blue-100 text-sm">Carregando...</p>
      </div>
    </div>
  )
}

// Só deixa entrar quem está logado
function Protegido({ children }) {
  const { session, carregando } = useAuth()
  if (carregando) return <Carregando />
  if (!session) return <Navigate to="/login" replace />
  return children
}

export default function App() {
  return (
    <Routes>
      {/* Telas de entrada */}
      <Route path="/login" element={<Login />} />
      <Route path="/cadastro" element={<Cadastro />} />

      {/* Telas internas (exigem login) */}
      <Route element={<Protegido><AppLayout /></Protegido>}>
        <Route path="/" element={<Navigate to="/ranking" replace />} />
        <Route path="/ranking" element={<Ranking />} />
        <Route path="/atividades" element={<Atividades />} />
        <Route path="/unidades" element={<Unidades />} />
        <Route path="/mural" element={<Mural />} />
        <Route path="/aprovacoes" element={<Aprovacoes />} />
      </Route>
    </Routes>
  )
}
