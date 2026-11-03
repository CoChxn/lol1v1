// 클라이언트 진입점: 렌더링, 입력 수집, 서버 통신을 담당한다.
import { io } from 'socket.io-client';
import { TICK_RATE } from '@lol1v1/shared';

console.log('[shared] TICK_RATE =', TICK_RATE);

const socket = io();

socket.on('connect', () => {
  console.log('Connected to server', socket.id);
});

socket.on('disconnect', (reason) => {
  console.log('Disconnected from server:', reason);
});
