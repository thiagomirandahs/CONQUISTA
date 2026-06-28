import { Routes, Route, Navigate } from 'react-router-dom'
import AppLayout from './components/AppLayout.jsx'
import Login from './pages/Login.jsx'
import Cadastro from './pages/Cadastro.jsx'
import Ranking from './pages/Ranking.jsx'
import Atividades from './pages/Atividades.jsx'
import Unidades from './pages/Unidades.jsx'
import Mural from './pages/Mural.jsx'

// Mapa de rotas (telas) do app
export default function App() {
  return (
    <Routes>
      {/* Telas sem menu (entrada) */}
      <Route path="/login" element={<Login />} />
      <Route path="/cadastro" element={<Cadastro />} />

      {/* Telas com menu inferior */}
      <Route element={<AppLayout />}>
        <Route path="/" element={<Navigate to="/ranking" replace />} />
        <Route path="/ranking" element={<Ranking />} />
        <Route path="/atividades" element={<Atividades />} />
        <Route path="/unidades" element={<Unidades />} />
        <Route path="/mural" element={<Mural />} />
      </Route>
    </Routes>
  )
}
