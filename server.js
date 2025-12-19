const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);

const PORT = process.env.PORT || 3000;

app.use(express.static(__dirname));

let fila = [];
let salas = {}; 

io.on('connection', (socket) => {
    console.log('Novo jogador:', socket.id);

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

                // Inicializa a sala com contadores de turno e cooldowns vazios
                salas[salaId] = {
                    p1: { 
                        id: p1.id, 
                        hpMax: p1.char.hp, 
                        hp: p1.char.hp, 
                        nome: p1.char.nome,
                        turnosRealizados: 0,
                        cooldowns: {} 
                    },
                    p2: { 
                        id: p2.id, 
                        hpMax: p2.char.hp, 
                        hp: p2.char.hp, 
                        nome: p2.char.nome,
                        turnosRealizados: 0,
                        cooldowns: {}
                    },
                    turno: p1.id
                };

                io.to(p1.id).emit('startBattle', { oponente: p2.char, seuTurno: true, salaId });
                io.to(p2.id).emit('startBattle', { oponente: p1.char, seuTurno: false, salaId });
            }
        }
    });

    socket.on('atacar', ({ salaId, danoBase, nomeAtaque, isUlt }) => {
        const sala = salas[salaId];
        if (!sala || sala.turno !== socket.id) return;

        const atacante = socket.id === sala.p1.id ? sala.p1 : sala.p2;
        const alvo = socket.id === sala.p1.id ? sala.p2 : sala.p1;

        // 1. Verificar Cooldown do ataque
        if (atacante.cooldowns[nomeAtaque] > 0) return;

        // 2. Calcular Dano Aleatório
        let danoFinal;
        if (isUlt) {
            // Ultimate: 60 ou 75 de dano (50% de chance para cada)
            danoFinal = Math.random() < 0.5 ? 60 : 75;
            atacante.turnosRealizados = 0; // Reseta o contador após usar a Ult
        } else {
            // Ataque normal: danoBase até (danoBase - 15%)
            const variacao = Math.floor(danoBase * 0.15);
            danoFinal = danoBase - Math.floor(Math.random() * (variacao + 1));
            
            // Se for o ataque forte (dano > 20), coloca em cooldown de 3 turnos
            if (danoBase > 20) {
                atacante.cooldowns[nomeAtaque] = 4; // 4 porque o turno atual conta ao reduzir
            }
        }

        // 3. Aplicar Dano e Atualizar Turnos
        alvo.hp -= danoFinal;
        atacante.turnosRealizados++;

        // 4. Reduzir Cooldowns existentes do atacante
        for (let chave in atacante.cooldowns) {
            if (atacante.cooldowns[chave] > 0) {
                atacante.cooldowns[chave]--;
            }
        }

        sala.turno = alvo.id; 

// 5. Enviar atualização para os clientes
        io.to(salaId).emit('atualizarBatalha', {
            atacante: atacante.id,
            dano: danoFinal,
            nomeAtaque,
            novoHpAlvo: (alvo.hp / alvo.hpMax) * 100,
            proximoTurno: sala.turno,
            // AGORA ENVIAMOS O ID JUNTO PARA FACILITAR NO FRONT
            statsP1: { id: sala.p1.id, turnos: sala.p1.turnosRealizados, cds: sala.p1.cooldowns },
            statsP2: { id: sala.p2.id, turnos: sala.p2.turnosRealizados, cds: sala.p2.cooldowns }
        });

        // 6. Verificar Fim de Jogo
        if (alvo.hp <= 0) {
            io.to(salaId).emit('fimBatalha', { vencedor: atacante.id });
            delete salas[salaId];
        }
    });

    socket.on('disconnect', () => {
        fila = fila.filter(p => p.id !== socket.id);
    });
});

http.listen(PORT, () => {
    console.log(`Servidor rodando em PORTA: ${PORT}`);
});