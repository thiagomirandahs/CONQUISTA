import { Suspense, useRef } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { especieInfo } from '../lib/bichinhoPecas.js'

// Um bichinho LOW-POLY feito em código (esferas) — 3D de verdade: gira, tem
// luz e profundidade. É um piloto: cute, leve e roda no celular. Pra ficar
// fotorrealista mesmo, depois entra um modelo 3D feito no Blender.
function Corpo({ cor, cor2 }) {
  const g = useRef()
  useFrame((state) => {
    const t = state.clock.elapsedTime
    if (g.current) {
      g.current.position.y = Math.sin(t * 1.7) * 0.09          // flutua
      g.current.rotation.z = Math.sin(t * 1.3) * 0.05          // balança
    }
  })
  const olho = '#20202a'
  return (
    <group ref={g}>
      {/* corpo */}
      <mesh>
        <sphereGeometry args={[1, 48, 48]} />
        <meshStandardMaterial color={cor} roughness={0.55} metalness={0.05} />
      </mesh>
      {/* brilho fofo (bochechas) */}
      <mesh position={[-0.55, -0.1, 0.78]}><sphereGeometry args={[0.16, 16, 16]} /><meshStandardMaterial color="#ff9db0" roughness={0.9} /></mesh>
      <mesh position={[0.55, -0.1, 0.78]}><sphereGeometry args={[0.16, 16, 16]} /><meshStandardMaterial color="#ff9db0" roughness={0.9} /></mesh>
      {/* orelhas */}
      <mesh position={[-0.72, 0.82, 0]} rotation={[0, 0, 0.5]}><sphereGeometry args={[0.3, 24, 24]} /><meshStandardMaterial color={cor2} roughness={0.6} /></mesh>
      <mesh position={[0.72, 0.82, 0]} rotation={[0, 0, -0.5]}><sphereGeometry args={[0.3, 24, 24]} /><meshStandardMaterial color={cor2} roughness={0.6} /></mesh>
      {/* olhos + brilho */}
      <mesh position={[-0.33, 0.22, 0.9]}><sphereGeometry args={[0.12, 20, 20]} /><meshStandardMaterial color={olho} /></mesh>
      <mesh position={[0.33, 0.22, 0.9]}><sphereGeometry args={[0.12, 20, 20]} /><meshStandardMaterial color={olho} /></mesh>
      <mesh position={[-0.29, 0.27, 1.0]}><sphereGeometry args={[0.035, 10, 10]} /><meshStandardMaterial color="#ffffff" /></mesh>
      <mesh position={[0.37, 0.27, 1.0]}><sphereGeometry args={[0.035, 10, 10]} /><meshStandardMaterial color="#ffffff" /></mesh>
      {/* focinho */}
      <mesh position={[0, -0.02, 1.0]}><sphereGeometry args={[0.15, 20, 20]} /><meshStandardMaterial color={cor2} roughness={0.5} /></mesh>
      {/* patinhas */}
      <mesh position={[-0.42, -0.92, 0.35]}><sphereGeometry args={[0.22, 20, 20]} /><meshStandardMaterial color={cor2} roughness={0.6} /></mesh>
      <mesh position={[0.42, -0.92, 0.35]}><sphereGeometry args={[0.22, 20, 20]} /><meshStandardMaterial color={cor2} roughness={0.6} /></mesh>
    </group>
  )
}

export default function Bicho3D({ especie = 'cachorro', size = 280 }) {
  const e = especieInfo(especie)
  return (
    <div style={{ width: '100%', height: size, cursor: 'grab' }}>
      <Canvas camera={{ position: [0, 0.4, 4.2], fov: 45 }} dpr={[1, 2]}>
        <ambientLight intensity={0.75} />
        <directionalLight position={[3, 5, 4]} intensity={1.15} />
        <hemisphereLight args={['#ffffff', '#8493c0', 0.45]} />
        <Suspense fallback={null}>
          <Corpo cor={e.cor} cor2={e.cor2} />
        </Suspense>
        <OrbitControls enablePan={false} enableZoom={false} autoRotate autoRotateSpeed={1.4}
          minPolarAngle={Math.PI / 2.6} maxPolarAngle={Math.PI / 1.75} />
      </Canvas>
    </div>
  )
}
