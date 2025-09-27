const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

const rooms = {}; // roomName -> array of strokes

io.on('connection', socket => {
  console.log('New client:', socket.id);

  socket.on('join', ({ room }) => {
    socket.join(room);
    console.log(`${socket.id} joined room ${room}`);

    if (!rooms[room]) rooms[room] = [];
    socket.emit('sync', rooms[room]);
  });

  socket.on('stroke', ({ room, stroke }) => {
    if (!rooms[room]) rooms[room] = [];
    rooms[room].push(stroke);
    socket.to(room).emit('stroke', stroke);
  });

  socket.on('clear', (room) => {
    rooms[room] = [];
    io.to(room).emit('clear');
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
