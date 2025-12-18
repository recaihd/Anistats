const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);

// Porta dinâmica para a Render ou 3000 local
const PORT = process.env.PORT || 3000;

// Serve os arquivos da raiz (index.html, pastas img e videos)
app.use(express.static(__dirname));

let fila = [];
let salas = {}; 

io.on('connection', (socket) => {
    console.log('Novo jogador conectado:', socket.id);

    socket.on('procurarPartida', (dadosPersonagem) => {
        console.log('Jogador entrou na fila:', dadosPersonagem.nome);
        fila.push({ id: socket.id, char: dadosPersonagem });
        
        if (fila.length >= 2) {
            const p1 = fila.shift();
            const p2 = fila.shift();
            const salaId = `sala_${p1.id}`;

            // Recupera os sockets reais
            const s1 = io.sockets.sockets.get(p1.id);
            const s2 = io.sockets.sockets.get(p2.id);

            if (s1 && s2) {
                s1.join(salaId);
                s2.join(salaId);

                salas[salaId] = {
                    p1: { id: p1.id, hpMax: p1.char.hp, hp: p1.char.hp, nome: p1.char.nome },
                    p2: { id: p2.id, hpMax: p2.char.hp, hp: p2.char.hp, nome: p2.char.nome },
                    turno: p1.id
                };

                io.to(p1.id).emit('startBattle', { oponente: p2.char, seuTurno: true, salaId });
                io.to(p2.id).emit('startBattle', { oponente: p1.char, seuTurno: false, salaId });
            }
        }
    });

    socket.on('atacar', ({ salaId, dano, nomeAtaque }) => {
        const sala = salas[salaId];
        if (!sala || sala.turno !== socket.id) return;

        const alvo = socket.id === sala.p1.id ? sala.p2 : sala.p1;
        const atacanteId = socket.id;
        const alvoId = alvo.id;

        alvo.hp -= dano;
        sala.turno = alvoId; 

        // Calcula porcentagem para a barra de vida
        const porcentagemHp = (alvo.hp / alvo.hpMax) * 100;

        io.to(salaId).emit('atualizarBatalha', {
            atacante: atacanteId,
            dano,
            nomeAtaque,
            novoHpAlvo: porcentagemHp > 0 ? porcentagemHp : 0,
            proximoTurno: sala.turno
        });

        if (alvo.hp <= 0) {
            io.to(salaId).emit('fimBatalha', { vencedor: atacanteId });
            delete salas[salaId];
        }
    });

    socket.on('disconnect', () => {
        fila = fila.filter(p => p.id !== socket.id);
    });
});

http.listen(PORT, () => {
    console.log(`Servidor rodando em http://localhost:${PORT}`);
});