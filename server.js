const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);

const PORT = process.env.PORT || 3000;
app.use(express.static(__dirname));

let fila = [];
let salas = {}; 

// CONFIGURAÇÃO: Tempo em segundos
const TEMPO_TURNO = 20;

function gerenciarTimer(salaId) {
    const sala = salas[salaId];
    if (!sala) return;

    // Limpa timer anterior se existir
    if (sala.timer) clearTimeout(sala.timer);

    // Inicia contagem regressiva
    sala.timer = setTimeout(() => {
        passarTurnoPorInatividade(salaId);
    }, TEMPO_TURNO * 1000);
}

function passarTurnoPorInatividade(salaId) {
    const sala = salas[salaId];
    if (!sala) return;

    const atacanteId = sala.turno;
    const atacante = atacanteId === sala.p1.id ? sala.p1 : sala.p2;
    const alvo = atacanteId === sala.p1.id ? sala.p2 : sala.p1;

    // Apenas passa o turno sem dar dano
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

    gerenciarTimer(salaId); // Reinicia o timer para o próximo jogador
}

io.on('connection', (socket) => {
    socket.on('procurarPartida', (dadosPersonagem) => {
        fila.push({ id: socket.id, char: dadosPersonagem });
        
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
                    p1: { id: p1.id, hpMax: p1.char.hp, hp: p1.char.hp, nome: p1.char.nome, turnosRealizados: 0, cooldowns: {} },
                    p2: { id: p2.id, hpMax: p2.char.hp, hp: p2.char.hp, nome: p2.char.nome, turnosRealizados: 0, cooldowns: {} },
                    turno: p1.id,
                    timer: null
                };

                io.to(salaId).emit('startBattle', { oponente: p2.char, p1Id: p1.id, salaId });
                gerenciarTimer(salaId); // Inicia o primeiro timer
            }
        }
    });

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
            if (danoBase > 20) atacante.cooldowns[nomeAtaque] = 4;
        }

        alvo.hp -= danoFinal;
        atacante.turnosRealizados++;

        for (let chave in atacante.cooldowns) {
            if (atacante.cooldowns[chave] > 0) atacante.cooldowns[chave]--;
        }

        sala.turno = alvo.id;

        io.to(salaId).emit('atualizarBatalha', {
            atacante: atacante.id,
            dano: danoFinal,
            nomeAtaque,
            novoHpAlvo: (alvo.hp / alvo.hpMax) * 100,
            proximoTurno: sala.turno,
            statsP1: { id: sala.p1.id, turnos: sala.p1.turnosRealizados, cds: sala.p1.cooldowns },
            statsP2: { id: sala.p2.id, turnos: sala.p2.turnosRealizados, cds: sala.p2.cooldowns }
        });

        if (alvo.hp <= 0) {
            clearTimeout(sala.timer);
            io.to(salaId).emit('fimBatalha', { vencedor: atacante.id });
            delete salas[salaId];
        } else {
            gerenciarTimer(salaId); // Reseta o timer para o próximo
        }
    });

    socket.on('disconnect', () => {
        // Limpar salas vazias ao desconectar (opcional, mas recomendado)
    });
});

http.listen(PORT, () => console.log(`Rodando na porta ${PORT}`));