// 서버 진입점: 매치룸 관리, 게임 루프 실행, 상태 브로드캐스트를 담당한다.
import { createServer } from 'node:http';
import express from 'express';
import { Server } from 'socket.io';

const PORT = process.env.PORT || 3000;

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer);

app.get('/health', (req, res) => res.json({ ok: true }));

httpServer.listen(PORT, () => {
  console.log(`[server] listening on http://localhost:${PORT}`);
});
