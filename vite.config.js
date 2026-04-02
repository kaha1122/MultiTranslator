import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
// [참고] vite-plugin-mkcert는 Vercel 빌드 서버에 mkcert 바이너리가 없어서 빌드 실패를 유발합니다.
// 로컬 HTTPS(마이크 권한 테스트)가 필요한 경우, npm run dev 실행 시 별도 설정을 사용하세요.
// Vercel 배포 환경에서는 HTTPS가 자동으로 적용됩니다.
export default defineConfig({
  plugins: [react()],
  define: {
    // CAPGO_CHANNEL 환경변수가 없으면 'production' 기본값
    __CAPGO_CHANNEL__: JSON.stringify(process.env.CAPGO_CHANNEL || 'production'),
  },
})
