import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 5173,
    // 소켓 통신은 Vite 개발 서버를 거쳐 게임 서버(3000)로 전달한다.
    proxy: {
      '/socket.io': {
        target: 'http://localhost:3000',
        ws: true,
      },
    },
  },
});
