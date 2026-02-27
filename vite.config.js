import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import mkcert from 'vite-plugin-mkcert'

// https://vite.dev/config/
// 초보자 설명(주석): 
// 핸드폰 브라우저는 'https://' 안전한 주소가 아니면 마이크 권한을 주지 않습니다.
// mkcert 플러그인은 우리 컴퓨터에 가상의 인증서를 만들어서 강제로 https를 열어주는 착한 도구입니다!
export default defineConfig({
  server: {
    https: true // 이제 npm run dev를 하면 https 로 시작하는 주소가 열립니다.
  },
  plugins: [react(), mkcert()],
})
