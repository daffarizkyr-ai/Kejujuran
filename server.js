const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const crypto = require('crypto');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: true } });
app.use(express.static(path.join(__dirname, 'public')));
app.get('/health', (_req, res) => res.json({ ok: true, app: 'Remi Kejujuran' }));

const rooms = new Map();
const SUITS = ['spade', 'diamond', 'love', 'clover'];
const RANKS = ['A','2','3','4','5','6','7','8','9','10','J','Q','K'];
const VALUES = Object.fromEntries(RANKS.map(r => [r, ['A','J','Q','K'].includes(r) ? 11 : Number(r)]));
const SUIT_SYMBOL = { spade:'♠', diamond:'♦', love:'♥', clover:'♣' };
const makeDeck = () => SUITS.flatMap(s => RANKS.map(r => ({ id: `${r}-${s}`, rank:r, suit:s })));
function shuffle(a) { for (let i=a.length-1;i>0;i--) { const j=crypto.randomInt(i+1); [a[i],a[j]]=[a[j],a[i]]; } return a; }
function code() { return crypto.randomBytes(3).toString('hex').toUpperCase(); }
function roomFor(socket) { const id = socket.data.room; return id && rooms.get(id); }
function playerFor(room, sid) { return room?.players.find(p => p.id === sid); }
function publicState(room) {
  return {
    code: room.code, status: room.status, hostId: room.hostId,
    players: room.players.map(p => ({ id:p.id, name:p.name, count:p.hand.length, score:p.score, sets:p.sets, connected:p.connected })),
    deckCount: room.deck.length, turn: room.turn, starterIndex: room.starterIndex,
    lastMessage: room.lastMessage, log: room.log.slice(-12),
    winner: room.winner, spin: room.spin,
  };
}
function emitRoom(room) {
  for (const p of room.players) {
    io.to(p.id).emit('state', { ...publicState(room), myHand: p.hand });
  }
}
function log(room, msg) { room.lastMessage = msg; room.log.push(msg); if (room.log.length > 40) room.log.shift(); }
function nextTurn(room) {
  room.turn = (room.turn + 1) % room.players.length;
  const p = room.players[room.turn];
  // Pemain yang kehabisan kartu tidak bisa mengajukan pertanyaan; ambil 1 kartu otomatis bila dek masih ada.
  if (p && p.hand.length === 0 && room.deck.length > 0) {
    p.hand.push(room.deck.pop());
    log(room, `${p.name} kehabisan kartu, sehingga mendapat 1 kartu otomatis dari dek tengah.`);
    awardSets(p, room);
    room.idleTurns = 0;
  }
}
function awardSets(player, room) {
  let changed = true;
  while (changed) {
    changed = false;
    const counts = {};
    for (const c of player.hand) counts[c.rank] = (counts[c.rank] || 0) + 1;
    const rank = Object.keys(counts).find(r => counts[r] === 4);
    if (rank) {
      const cards = player.hand.filter(c => c.rank === rank);
      player.hand = player.hand.filter(c => c.rank !== rank);
      const points = cards.reduce((sum,c) => sum + VALUES[c.rank], 0);
      player.score += points;
      player.sets.push({ rank, points, cards });
      log(room, `${player.name} membentuk seri ${rank} (4 kartu) dan memperoleh ${points} poin.`);
      changed = true;
    }
  }
}
function checkEnd(room) {
  if (room.deck.length !== 0) return false;
  // Sesudah dek habis, permainan berakhir setelah satu putaran penuh tanpa perpindahan kartu.
  if (room.idleTurns >= room.players.length) {
    room.status = 'finished';
    const max = Math.max(...room.players.map(p => p.score));
    room.winner = room.players.filter(p => p.score === max).map(p => p.name);
    log(room, `Permainan selesai. Pemenang: ${room.winner.join(', ')} dengan ${max} poin.`);
    return true;
  }
  return false;
}
function drawOne(player, room) {
  if (!room.deck.length) return false;
  player.hand.push(room.deck.pop());
  log(room, `${player.name} mengambil 1 kartu dari dek tengah secara rahasia.`);
  awardSets(player, room);
  return true;
}
function startGame(room) {
  const deck = shuffle(makeDeck());
  room.players.forEach(p => { p.hand = deck.splice(0,4); p.score=0; p.sets=[]; });
  room.deck = deck;
  room.status = 'playing'; room.turn = room.starterIndex; room.idleTurns=0; room.winner=null;
  log(room, `Permainan dimulai. ${room.players[room.turn].name} mendapat giliran pertama.`);
  emitRoom(room);
}

io.on('connection', socket => {
  socket.on('createRoom', ({ name }, cb=()=>{}) => {
    name = String(name || '').trim().slice(0,20);
    if (!name) return cb({ error:'Masukkan nama pemain.' });
    let id; do { id=code(); } while (rooms.has(id));
    const room = { id, code:id, hostId:socket.id, players:[{id:socket.id,name,hand:[],score:0,sets:[],connected:true}], deck:[],status:'lobby',turn:0,starterIndex:0,spin:null,idleTurns:0,log:[],lastMessage:'Room dibuat. Bagikan kode kepada teman.',winner:null };
    rooms.set(id,room); socket.join(id); socket.data.room=id;
    cb({ ok:true, code:id }); emitRoom(room);
  });
  socket.on('joinRoom', ({ code:raw, name }, cb=()=>{}) => {
    const id=String(raw||'').trim().toUpperCase(), room=rooms.get(id);
    name=String(name||'').trim().slice(0,20);
    if (!name) return cb({error:'Masukkan nama pemain.'});
    if (!room) return cb({error:'Room tidak ditemukan.'});
    if (room.status!=='lobby') return cb({error:'Permainan sudah dimulai.'});
    if (room.players.length>=6) return cb({error:'Room sudah penuh (maksimal 6 pemain).'});
    if (room.players.some(p=>p.name.toLowerCase()===name.toLowerCase())) return cb({error:'Nama pemain sudah digunakan di room ini.'});
    room.players.push({id:socket.id,name,hand:[],score:0,sets:[],connected:true});
    socket.join(id); socket.data.room=id; cb({ok:true,code:id}); emitRoom(room);
  });
  socket.on('spinWheel', () => {
    const room=roomFor(socket); if (!room || room.status!=='lobby' || room.hostId!==socket.id) return;
    if (room.players.length<2) return socket.emit('notice','Minimal 2 pemain untuk memulai.');
    // crypto.randomInt memberi peluang sama untuk setiap pemain.
    room.starterIndex=crypto.randomInt(room.players.length);
    room.spin={winner:room.players[room.starterIndex].name, index:room.starterIndex, nonce:crypto.randomBytes(4).toString('hex')};
    log(room,`Spin wheel memilih ${room.spin.winner} sebagai pemain pertama.`);
    emitRoom(room);
  });
  socket.on('startGame', () => {
    const room=roomFor(socket); if (!room || room.hostId!==socket.id || room.status!=='lobby') return;
    if (room.players.length<2) return socket.emit('notice','Minimal 2 pemain.');
    if (!room.spin) return socket.emit('notice','Lakukan spin wheel terlebih dahulu.');
    startGame(room);
  });
  socket.on('ask', ({targetId,rank}, cb=()=>{}) => {
    const room=roomFor(socket), me=playerFor(room,socket.id);
    if (!room || room.status!=='playing') return cb({error:'Permainan belum aktif.'});
    if (room.players[room.turn]?.id!==socket.id) return cb({error:'Belum giliran Anda.'});
    if (room.pending) return cb({error:'Tunggu pemain yang ditanya menyelesaikan tebakannya.'});
    const target=playerFor(room,targetId);
    if (!target || target.id===socket.id) return cb({error:'Pilih pemain lain.'});
    if (!RANKS.includes(rank) || !me.hand.some(c=>c.rank===rank)) return cb({error:'Anda harus memiliki minimal satu kartu dengan angka/gambar tersebut.'});
    if (!target.hand.some(c=>c.rank===rank)) {
      log(room,`${me.name} meminta ${rank} kepada ${target.name}, tetapi ${target.name} tidak memilikinya.`);
      if (drawOne(me,room)) room.idleTurns=0; else room.idleTurns++;
      nextTurn(room); checkEnd(room); emitRoom(room); return cb({ok:true,result:'not-held'});
    }
    room.pending={askerId:socket.id,targetId,rank};
    io.to(targetId).emit('guessRequest',{askerName:me.name,rank,availableSuits:target.hand.filter(c=>c.rank===rank).map(c=>c.suit)});
    io.to(socket.id).emit('waitingGuess',{targetName:target.name,rank});
    cb({ok:true,result:'guess-pending'});
  });
  socket.on('guess', ({suit}, cb=()=>{}) => {
    const room=roomFor(socket); if (!room || room.status!=='playing' || !room.pending || room.pending.targetId!==socket.id) return cb({error:'Tidak ada tebakan yang menunggu.'});
    if (!SUITS.includes(suit)) return cb({error:'Ikon kartu tidak valid.'});
    const pending=room.pending, asker=playerFor(room,pending.askerId), target=playerFor(room,pending.targetId);
    const wantedId=`${pending.rank}-${suit}`;
    const idx=target.hand.findIndex(c=>c.id===wantedId);
    room.pending=null;
    if (idx>=0) {
      const [card]=target.hand.splice(idx,1); asker.hand.push(card);
      log(room,`${asker.name} berhasil menebak ${pending.rank} ${SUIT_SYMBOL[suit]} dari ${target.name}. Giliran ${asker.name} berlanjut.`);
      room.idleTurns=0; awardSets(asker,room); awardSets(target,room);
      if (!asker.hand.length && !target.hand.length && room.deck.length===0) checkEnd(room);
    } else {
      log(room,`${asker.name} salah menebak ikon kartu ${pending.rank} dari ${target.name}.`);
      if (drawOne(asker,room)) room.idleTurns=0; else room.idleTurns++;
      nextTurn(room); checkEnd(room);
    }
    emitRoom(room); cb({ok:true,correct:idx>=0});
  });
  socket.on('disconnect', () => {
    const room=roomFor(socket); if (!room) return;
    const p=playerFor(room,socket.id); if (p) p.connected=false;
    // Room tetap ada agar pemain dapat reconnect melalui kode pada sesi server yang sama.
    emitRoom(room);
  });
});

const PORT=process.env.PORT||3000;
server.listen(PORT,'0.0.0.0',()=>console.log(`Remi Kejujuran berjalan di port ${PORT}`));
