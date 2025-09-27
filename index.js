const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

let rooms = {};

io.on("connection", (socket) => {
  console.log("connected:", socket.id);

  socket.on("join", (room) => {
    socket.join(room);
    if (!rooms[room]) rooms[room] = [];
    socket.emit("sync", rooms[room]);
  });

  socket.on("stroke", ({ room, stroke }) => {
    if (!rooms[room]) rooms[room] = [];
    rooms[room].push(stroke);
    io.to(room).emit("stroke", stroke);
  });

  socket.on("clear", (room) => {
    rooms[room] = [];
    io.to(room).emit("clear");
  });
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => console.log(`Server running on ${PORT}`));
