// index.js
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

// Basic static serving so you can serve index.html from same server if you want
app.use(express.static("public")); // put index.html in ./public to serve it

// rooms: each room -> { strokes: [], history: [], historyIndex: -1, bgColor, bgImage }
const rooms = {};

io.on("connection", (socket) => {
  console.log("🔌 connection", socket.id);

  socket.on("join", (room) => {
    socket.join(room);
    if (!rooms[room]) {
      rooms[room] = { strokes: [], history: [], historyIndex: -1, bgColor: "#ffffff", bgImage: null };
    }
    // send full room state
    const state = {
      strokes: rooms[room].strokes,
      bgColor: rooms[room].bgColor,
      bgImage: rooms[room].bgImage
    };
    socket.emit("sync", state);
    console.log(`${socket.id} joined room ${room}`);
  });

  // Add stroke (pen stroke or image-stamp)
  socket.on("stroke", ({ room, stroke }) => {
    if (!rooms[room]) return;
    const roomObj = rooms[room];

    // append to strokes
    const index = roomObj.strokes.length;
    roomObj.strokes.push(stroke);

    // push history action (discard any future history)
    roomObj.history = roomObj.history.slice(0, roomObj.historyIndex + 1);
    roomObj.history.push({ type: "add", strokes: [ { ...stroke, __index: index } ] });
    roomObj.historyIndex++;

    io.to(room).emit("stroke", stroke);
  });

  // Remove strokes by IDs (rubber)
  socket.on("remove", ({ room, ids }) => {
    if (!rooms[room]) return;
    const roomObj = rooms[room];

    // find removed strokes and their original indices
    const removed = [];
    for (let i = 0; i < roomObj.strokes.length; i++) {
      const st = roomObj.strokes[i];
      if (ids.includes(st.id)) {
        removed.push({ ...st, __index: i });
      }
    }
    if (removed.length === 0) return;

    // actually remove
    roomObj.strokes = roomObj.strokes.filter(s => !ids.includes(s.id));

    // history push
    roomObj.history = roomObj.history.slice(0, roomObj.historyIndex + 1);
    roomObj.history.push({ type: "remove", strokes: removed });
    roomObj.historyIndex++;

    io.to(room).emit("remove", ids);
  });

  // temporary move during image drag (no history)
  socket.on("tempMove", ({ room, id, x, y, w, h }) => {
    if (!rooms[room]) return;
    const roomObj = rooms[room];
    const st = roomObj.strokes.find(s => s.id === id);
    if (!st) return;
    st.x = x; st.y = y;
    if (w !== undefined) st.w = w;
    if (h !== undefined) st.h = h;
    io.to(room).emit("tempMove", { id, x, y, w, h });
  });

  // commit an update (like an image move/resize) — stored in history
  socket.on("update", ({ room, before, after }) => {
    if (!rooms[room]) return;
    const roomObj = rooms[room];

    // apply 'after' for each stroke (match by id)
    for (const a of after) {
      const idx = roomObj.strokes.findIndex(s => s.id === a.id);
      if (idx !== -1) roomObj.strokes[idx] = a;
    }

    // push history action (update)
    roomObj.history = roomObj.history.slice(0, roomObj.historyIndex + 1);
    roomObj.history.push({ type: "update", before: before, after: after });
    roomObj.historyIndex++;

    // broadcast new full state (simpler / robust)
    const state = { strokes: roomObj.strokes, bgColor: roomObj.bgColor, bgImage: roomObj.bgImage };
    io.to(room).emit("sync", state);
  });

  // Undo (server authoritative)
  socket.on("undo", (room) => {
    if (!rooms[room]) return;
    const roomObj = rooms[room];
    const idx = roomObj.historyIndex;
    if (idx < 0) return; // nothing to undo

    const action = roomObj.history[idx];

    if (action.type === "add") {
      // remove added strokes by id
      const ids = action.strokes.map(s => s.id);
      roomObj.strokes = roomObj.strokes.filter(s => !ids.includes(s.id));
    } else if (action.type === "remove") {
      // re-insert removed strokes at their original positions
      // insert in ascending __index order
      const toInsert = action.strokes.slice().sort((a,b)=>a.__index - b.__index);
      for (const st of toInsert) {
        const insertIndex = Math.min(st.__index, roomObj.strokes.length);
        // restore without __index property
        const copy = { ...st };
        delete copy.__index;
        roomObj.strokes.splice(insertIndex, 0, copy);
      }
    } else if (action.type === "update") {
      // replace with before state
      for (const before of action.before) {
        const i = roomObj.strokes.findIndex(s => s.id === before.id);
        if (i !== -1) roomObj.strokes[i] = before;
      }
    }

    roomObj.historyIndex--;
    io.to(room).emit("sync", { strokes: roomObj.strokes, bgColor: roomObj.bgColor, bgImage: roomObj.bgImage });
  });

  // Redo (server side)
  socket.on("redo", (room) => {
    if (!rooms[room]) return;
    const roomObj = rooms[room];
    if (roomObj.historyIndex >= roomObj.history.length - 1) return;
    const action = roomObj.history[roomObj.historyIndex + 1];

    if (action.type === "add") {
      // re-add strokes (append at their recorded indices if possible)
      const toAdd = action.strokes;
      for (const st of toAdd) {
        // append (we stored __index but indices may have shifted)
        const copy = { ...st }; delete copy.__index;
        roomObj.strokes.push(copy);
      }
    } else if (action.type === "remove") {
      const ids = action.strokes.map(s => s.id);
      roomObj.strokes = roomObj.strokes.filter(s => !ids.includes(s.id));
    } else if (action.type === "update") {
      // apply 'after'
      for (const after of action.after) {
        const i = roomObj.strokes.findIndex(s => s.id === after.id);
        if (i !== -1) roomObj.strokes[i] = after;
      }
    }

    roomObj.historyIndex++;
    io.to(room).emit("sync", { strokes: roomObj.strokes, bgColor: roomObj.bgColor, bgImage: roomObj.bgImage });
  });

  // Set background (color or image dataURL)
  socket.on("setBackground", ({ room, bgColor, bgImage }) => {
    if (!rooms[room]) return;
    const roomObj = rooms[room];
    roomObj.bgColor = bgColor || roomObj.bgColor;
    roomObj.bgImage = bgImage || roomObj.bgImage;
    // Background set is itself an action? (we won't store in action history by default)
    io.to(room).emit("sync", { strokes: roomObj.strokes, bgColor: roomObj.bgColor, bgImage: roomObj.bgImage });
  });

  // Clear board
  socket.on("clear", (room) => {
    if (!rooms[room]) return;
    const roomObj = rooms[room];
    roomObj.strokes = [];
    roomObj.history = [];
    roomObj.historyIndex = -1;
    io.to(room).emit("clear");
  });

  socket.on("disconnect", () => {
    console.log("🔌 disconnect", socket.id);
  });
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => console.log(`🚀 Server listening on ${PORT}`));
