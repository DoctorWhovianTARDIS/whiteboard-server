const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

// in-memory storage of strokes per room
let rooms = {};

io.on("connection", (socket) => {
  console.log("✅ Client connected:", socket.id);

  // join a room
  socket.on("join", (room) => {
    socket.join(room);
    if (!rooms[room]) rooms[room] = [];
    // send existing strokes to the new user
    socket.emit("sync", rooms[room]);
    console.log(`${socket.id} joined room ${room}`);
  });

  // handle drawing strokes
  socket.on("stroke", ({ room, stroke }) => {
    if (!rooms[room]) rooms[room] = [];
    rooms[room].push(stroke);
    io.to(room).emit("stroke", stroke);
  });

  // handle clearing a room
  socket.on("clear", (room) => {
    rooms[room] = [];
    io.to(room).emit("clear");
    console.log(`Room ${room} cleared`);
  });

  socket.on("disconnect", () => {
    console.log("❌ Client disconnected:", socket.id);
  });
});

// Render provides PORT automatically
const PORT = process.env.PORT || 10000;
server.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
