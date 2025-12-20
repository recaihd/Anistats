const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);

const PORT = process.env.PORT || 3000;

app.use(express.static(__dirname));

// Banco de dados em memória
let usuarios = {}; 
let fila = [];
let salas = {}; 

const TEMPO_TURNO = 20;
const AVATAR_PADRAO = 'img/default_avatar.webp';

// --- FUNÇÕES DE AUXÍLIO ---

function obterRanking() {
    return Object.values(usuarios)
        .map(u => ({ username: u.username, pontos: u.pontos, avatar: u.avatar }))
        .sort((a, b) => b.pontos - a.pontos)
        .slice(0, 10);
}

function gerenciarTimer(salaId) {
    const sala = salas[salaId];
    if (!sala) return;
    if (sala.timer) clearTimeout(sala.timer);
    sala.timer = setTimeout(() => passarTurnoPorInatividade(salaId), TEMPO_TURNO * 1000);
}

function passarTurnoPorInatividade(salaId) {
    const sala = salas[salaId];
    if (!sala) return;

    const atacanteId = sala.turno;
    const alvo = atacanteId === sala.p1.id ? sala.p2 : sala.p1;
    sala.turno = alvo.id;

    io.to(salaId).emit('atualizarBatalha', {
        atacante: atacanteId,
        dano: 0,
        nomeAtaque: "TEMPO ESGOTADO!",
        novoHpAlvo: (alvo.hp / alvo.hpMax) * 100,
        proximoTurno: sala.turno,
        statsP1: { id: sala.p1.id, turnos: sala.p1.turnosRealizados, cds: sala.p1.cooldowns },
        statsP2: { id: sala.p2.id, turnos: sala.p2.turnosRealizados, cds: sala.p2.cooldowns }
    });
    gerenciarTimer(salaId);
}

// --- COMUNICAÇÃO SOCKET.IO ---

io.on('connection', (socket) => {
    
    // LOGIN E CADASTRO
    socket.on('solicitarLogin', ({ username, senha }) => {
        if (usuarios[username]) {
            if (usuarios[username].senha === senha) {
                socket.emit('loginSucesso', usuarios[username]);
            } else {
                socket.emit('erroLogin', "Senha incorreta!");
            }
        } else {
            usuarios[username] = { 
                username, 
                senha, 
                pontos: 0, 
                avatar: AVATAR_PADRAO 
            };
            socket.emit('loginSucesso', usuarios[username]);
        }
    });

    socket.on('loginExistente', (dados) => {
        if (usuarios[dados.username] && usuarios[dados.username].senha === dados.senha) {
            socket.emit('loginSucesso', usuarios[dados.username]);
        }
    });

    // ATUALIZAR FOTO
    socket.on('atualizarAvatar', ({ username, avatar }) => {
        if (usuarios[username]) {
            usuarios[username].avatar = avatar;
            socket.emit('avatarAtualizado', avatar);
        }
    });

    // RANKING
    socket.on('obterRanking', () => {
        socket.emit('receberRanking', obterRanking());
    });

    // SISTEMA DE BUSCA DE PARTIDA
    socket.on('procurarPartida', (dadosChar) => {
        // Agora incluímos o avatar e username do perfil no objeto da fila
        fila.push({ 
            id: socket.id, 
            char: dadosChar, 
            username: dadosChar.username,
            avatar: dadosChar.avatar || AVATAR_PADRAO
        });

        if (fila.length >= 2) {
            const p1 = fila.shift();
            const p2 = fila.shift();
            const salaId = `sala_${p1.id}`;

            const s1 = io.sockets.sockets.get(p1.id);
            const s2 = io.sockets.sockets.get(p2.id);

            if (s1 && s2) {
                s1.join(salaId);
                s2.join(salaId);

                salas[salaId] = {
                    p1: { 
                        id: p1.id, 
                        username: p1.username, 
                        avatar: p1.avatar,
                        hpMax: p1.char.hp, 
                        hp: p1.char.hp, 
                        nome: p1.char.nome, 
                        turnosRealizados: 0, 
                        cooldowns: {} 
                    },
                    p2: { 
                        id: p2.id, 
                        username: p2.username, 
                        avatar: p2.avatar,
                        hpMax: p2.char.hp, 
                        hp: p2.char.hp, 
                        nome: p2.char.nome, 
                        turnosRealizados: 0, 
                        cooldowns: {} 
                    },
                    turno: p1.id,
                    timer: null
                };

                // Enviamos os dados completos para o Front-end montar a arena
                io.to(salaId).emit('startBattle', { 
                    player1: { ...p1.char, username: p1.username, avatar: p1.avatar }, 
                    player2: { ...p2.char, username: p2.username, avatar: p2.avatar }, 
                    p1Id: p1.id, 
                    p2Id: p2.id, 
                    salaId 
                });
                gerenciarTimer(salaId);
            }
        }
    });

    // COMBATE
    socket.on('atacar', ({ salaId, danoBase, nomeAtaque, isUlt }) => {
        const sala = salas[salaId];
        if (!sala || sala.turno !== socket.id) return;

        const atacante = socket.id === sala.p1.id ? sala.p1 : sala.p2;
        const alvo = socket.id === sala.p1.id ? sala.p2 : sala.p1;

        if (atacante.cooldowns[nomeAtaque] > 0) return;

        let danoFinal;
        if (isUlt) {
            danoFinal = Math.random() < 0.5 ? 60 : 75;
            atacante.turnosRealizados = 0;
        } else {
            const variacao = Math.floor(danoBase * 0.15);
            danoFinal = danoBase - Math.floor(Math.random() * (variacao + 1));
            // Habilidades fortes ganham tempo de recarga
            if (danoBase > 25) atacante.cooldowns[nomeAtaque] = 3; 
        }

        alvo.hp -= danoFinal;
        atacante.turnosRealizados++;

        // Reduz cooldowns das outras habilidades
        for (let chave in atacante.cooldowns) {
            if (atacante.cooldowns[chave] > 0) atacante.cooldowns[chave]--;
        }

        sala.turno = alvo.id;

        io.to(salaId).emit('atualizarBatalha', {
            atacante: atacante.id, 
            dano: danoFinal, 
            nomeAtaque,
            novoHpAlvo: Math.max(0, (alvo.hp / alvo.hpMax) * 100),
            proximoTurno: sala.turno,
            statsP1: { id: sala.p1.id, turnos: sala.p1.turnosRealizados, cds: sala.p1.cooldowns },
            statsP2: { id: sala.p2.id, turnos: sala.p2.turnosRealizados, cds: sala.p2.cooldowns }
        });

        if (alvo.hp <= 0) {
            clearTimeout(sala.timer);
            
            // Atualiza pontos no banco de dados
            if (usuarios[atacante.username]) usuarios[atacante.username].pontos += 50;
            if (usuarios[alvo.username]) {
                usuarios[alvo.username].pontos = Math.max(0, usuarios[alvo.username].pontos - 25);
            }

            io.to(salaId).emit('fimBatalha', { vencedor: atacante.id });
            delete salas[salaId];
        } else {
            gerenciarTimer(salaId);
        }
    });

    socket.on('disconnect', () => {
        fila = fila.filter(p => p.id !== socket.id);
        // Opcional: Lógica para encerrar salas se um jogador cair
    });
});

http.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
});