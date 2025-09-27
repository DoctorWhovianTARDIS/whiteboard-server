const canvas=document.getElementById('board');
const ctx=canvas.getContext('2d');
const penBtn=document.getElementById('penBtn');
const rubberBtn=document.getElementById('rubberBtn');
const colorInput=document.getElementById('color');
const sizeInput=document.getElementById('size');
const clearBtn=document.getElementById('clear');
const roomInput=document.getElementById('room');
const joinBtn=document.getElementById('joinBtn');
const statusSpan=document.getElementById('status');
const undoBtn=document.getElementById('undo');
const redoBtn=document.getElementById('redo');

let tool="pen";
let drawing=false;
let room=null;
let strokes=[];
let currentStroke=null;

// History for undo/redo
let history=[];
let historyIndex=-1;

const socket=io("https://whiteboard-muqx.onrender.com");

// Helpers
function drawStroke(s){
  ctx.strokeStyle=s.color;
  ctx.lineWidth=s.size;
  ctx.lineCap='round';
  ctx.beginPath();
  ctx.moveTo(s.points[0].x,s.points[0].y);
  for(let p of s.points.slice(1)) ctx.lineTo(p.x,p.y);
  ctx.stroke();
}
function redrawAll(){
  ctx.clearRect(0,0,canvas.width,canvas.height);
  for(let s of strokes) drawStroke(s);
}
function clearCanvas(){ strokes=[]; history=[]; historyIndex=-1; ctx.clearRect(0,0,canvas.width,canvas.height); }

// Socket events
socket.on("stroke", s=>{ strokes.push(s); drawStroke(s); });
socket.on("remove", ids=>{ strokes=strokes.filter(s=>!ids.includes(s.id)); redrawAll(); });
socket.on("redo", newStrokes=>{ strokes.push(...newStrokes); redrawAll(); });
socket.on("sync", all=>{ strokes=all; history=[]; historyIndex=-1; redrawAll(); });
socket.on("clear", ()=>{ clearCanvas(); });

// Join room
joinBtn.addEventListener("click",()=>{
  room=roomInput.value.trim();
  if(!room)return alert("Type a room name!");
  socket.emit("join", room);
  statusSpan.textContent="Joined: "+room;
  clearCanvas();
});

// Tools
penBtn.addEventListener("click",()=>{ tool="pen"; penBtn.classList.add("active"); rubberBtn.classList.remove("active"); });
rubberBtn.addEventListener("click",()=>{ tool="rubber"; rubberBtn.classList.add("active"); penBtn.classList.remove("active"); });

// Clear
clearBtn.addEventListener("click",()=>{
  if(!confirm("Are you sure?")) return;
  clearCanvas();
  if(room) socket.emit("clear", room);
});

// History management
function pushAction(action){
  history=history.slice(0,historyIndex+1);
  history.push(action);
  historyIndex++;
}

function undo(){
  if(historyIndex<0) return;
  const action=history[historyIndex];

  if(action.type==="add"){
    strokes = strokes.filter(s=> !action.strokes.map(st=>st.id).includes(s.id));
    if(room) socket.emit("remove",{room,ids:action.strokes.map(st=>st.id)});
  } else if(action.type==="remove"){
    strokes.push(...action.strokes);
    if(room) socket.emit("redo",{room,strokes:action.strokes});
  }
  historyIndex--;
  redrawAll();
}

function redo(){
  if(historyIndex>=history.length-1) return;
  historyIndex++;
  const action=history[historyIndex];

  if(action.type==="add"){
    strokes.push(...action.strokes);
    if(room) socket.emit("redo",{room,strokes:action.strokes});
  } else if(action.type==="remove"){
    strokes = strokes.filter(s=>!action.strokes.map(st=>st.id).includes(s.id));
    if(room) socket.emit("remove",{room,ids:action.strokes.map(st=>st.id)});
  }
  redrawAll();
}

undoBtn.addEventListener("click",undo);
redoBtn.addEventListener("click",redo);

document.addEventListener("keydown",e=>{
  if(e.ctrlKey&&e.key==="z"){ undo(); e.preventDefault(); }
  if(e.ctrlKey&&e.key==="y"){ redo(); e.preventDefault(); }
});

// Drawing
canvas.addEventListener("mousedown",e=>{
  drawing=true;
  if(tool==="pen"){
    currentStroke={ id: Date.now()+"-"+Math.random().toString(36,5), color:colorInput.value, size:parseInt(sizeInput.value,10), points:[{x:e.offsetX,y:e.offsetY}] };
    ctx.beginPath(); ctx.moveTo(e.offsetX,e.offsetY);
  } else if(tool==="rubber"){
    eraseAt(e.offsetX,e.offsetY);
  }
});

canvas.addEventListener("mousemove",e=>{
  if(!drawing) return;
  if(tool==="pen" && currentStroke){
    const pt={x:e.offsetX,y:e.offsetY};
    currentStroke.points.push(pt);
    ctx.strokeStyle=currentStroke.color;
    ctx.lineWidth=currentStroke.size;
    ctx.lineCap="round";
    ctx.lineTo(pt.x,pt.y);
    ctx.stroke();
  } else if(tool==="rubber"){
    eraseAt(e.offsetX,e.offsetY);
  }
});

canvas.addEventListener("mouseup",finishStroke);
canvas.addEventListener("mouseout",finishStroke);

function finishStroke(){
  if(!drawing) return;
  if(tool==="pen" && currentStroke){
    strokes.push(currentStroke);
    if(room) socket.emit("stroke",{room,stroke:currentStroke});
    pushAction({type:"add",strokes:[currentStroke]});
    currentStroke=null;
  }
  drawing=false;
}

// Rubber erase
function eraseAt(x,y){
  const radius=parseInt(sizeInput.value,10);
  const erased=strokes.filter(s=>intersectsStroke(s,x,y,radius));
  if(erased.length){
    strokes = strokes.filter(s=>!erased.map(st=>st.id).includes(s.id));
    undone=[];
    pushAction({type:"remove",strokes:erased});
    redrawAll();
    if(room) socket.emit("remove",{room,ids:erased.map(st=>st.id)});
  }
}

// Check if stroke intersects a point
function intersectsStroke(s,x,y,r){
  const pts=s.points;
  for(let i=0;i<pts.length-1;i++){
    const A=pts[i], B=pts[i+1];
    if(pointLineDistance({x,y},A,B)<=r) return true;
  }
  return false;
}

function pointLineDistance(P,A,B){
  const dx=B.x-A.x, dy=B.y-A.y;
  const len2=dx*dx+dy*dy;
  if(len2===0) return Math.hypot(P.x-A.x,P.y-A.y);
  let t=((P.x-A.x)*dx+(P.y-A.y)*dy)/len2;
  t=Math.max(0,Math.min(1,t));
  const proj={x:A.x+t*dx,y:A.y+t*dy};
  return Math.hypot(P.x-proj.x,P.y-proj.y);
}
