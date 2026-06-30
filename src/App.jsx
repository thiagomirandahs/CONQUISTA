import { lazy, Suspense } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from './context/Auth.jsx'
import AppLayout from './components/AppLayout.jsx'
import Logo from './components/Logo.jsx'

// Cada tela é carregada só quando necessária (deixa o app mais leve/rápido)
const Login = lazy(() => import('./pages/Login.jsx'))
const Cadastro = lazy(() => import('./pages/Cadastro.jsx'))
const Ranking = lazy(() => import('./pages/Ranking.jsx'))
const Atividades = lazy(() => import('./pages/Atividades.jsx'))
const Unidades = lazy(() => import('./pages/Unidades.jsx'))
const Mural = lazy(() => import('./pages/Mural.jsx'))
const Aprovacoes = lazy(() => import('./pages/Aprovacoes.jsx'))
const Apontamentos = lazy(() => import('./pages/Apontamentos.jsx'))
const Gestao = lazy(() => import('./pages/Gestao.jsx'))
const Mensalidades = lazy(() => import('./pages/Mensalidades.jsx'))
const Usuarios = lazy(() => import('./pages/Usuarios.jsx'))

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

function Protegido({ children }) {
  const { session, carregando } = useAuth()
  if (carregando) return <Carregando />
  if (!session) return <Navigate to="/login" replace />
  return children
}

export default function App() {
  return (
    <Suspense fallback={<Carregando />}>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/cadastro" element={<Cadastro />} />

        <Route element={<Protegido><AppLayout /></Protegido>}>
          <Route path="/" element={<Navigate to="/ranking" replace />} />
          <Route path="/ranking" element={<Ranking />} />
          <Route path="/atividades" element={<Atividades />} />
          <Route path="/unidades" element={<Unidades />} />
          <Route path="/mural" element={<Mural />} />
          <Route path="/gestao" element={<Gestao />} />
          <Route path="/aprovacoes" element={<Aprovacoes />} />
          <Route path="/apontamentos" element={<Apontamentos />} />
          <Route path="/mensalidades" element={<Mensalidades />} />
          <Route path="/usuarios" element={<Usuarios />} />
        </Route>
      </Routes>
    </Suspense>
  )
}
