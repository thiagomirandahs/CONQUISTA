// @vitest-environment node
// AndroidManifest: permissões que o app declara. A câmera é para os stories da Rede (input capture) e NUNCA obrigatória para instalar.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const xml = readFileSync(join(__dirname, '..', '..', 'android', 'app', 'src', 'main', 'AndroidManifest.xml'), 'utf8')

describe('AndroidManifest', () => {
  it('declara CAMERA (stories) e as notificações; câmera e câmera frontal NÃO são obrigatórias', () => {
    expect(xml).toMatch(/uses-permission android:name="android\.permission\.CAMERA"/)
    expect(xml).toMatch(/uses-permission android:name="android\.permission\.POST_NOTIFICATIONS"/)
    expect(xml).toMatch(/uses-feature android:name="android\.hardware\.camera" android:required="false"/)
    expect(xml).toMatch(/uses-feature android:name="android\.hardware\.camera\.front" android:required="false"/)
  })
  it('não pede permissões que o produto não usa (microfone, localização, contatos, armazenamento amplo)', () => {
    for (const p of ['RECORD_AUDIO', 'ACCESS_FINE_LOCATION', 'ACCESS_COARSE_LOCATION', 'READ_CONTACTS', 'READ_EXTERNAL_STORAGE', 'WRITE_EXTERNAL_STORAGE', 'MANAGE_EXTERNAL_STORAGE']) {
      expect(xml, p).not.toContain(`android.permission.${p}`)
    }
  })
})
