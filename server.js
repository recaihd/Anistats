require('dotenv').config(); // Carrega o .env logo no topo
const express = require('express');
const mongoose = require('mongoose');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);

const PORT = process.env.PORT || 3000;
const MONGO_URI = process.env.MONGO_URI;

app.use(express.static(__dirname));

// --- CONEXÃO COM MONGODB ---
mongoose.connect(MONGO_URI)
    .then(() => console.log("✅ Conectado ao MongoDB Atlas"))
    .catch(err => console.error("❌ Erro ao conectar ao MongoDB:", err));

// --- MODELO DE USUÁRIO ---
const UserSchema = new mongoose.Schema({
    username: { type: String, unique: true, required: true },
    senha: { type: String, required: true },
    pontos: { type: Number, default: 0 },
    avatar: { type: String, default: 'img/default_avatar.webp' }
});
const User = mongoose.model('User', UserSchema);

// --- VARIÁVEIS DE JOGO (MEMÓRIA VOLÁTIL) ---
let fila = [];
let salas = {}; 
const TEMPO_TURNO = 20;
const AVATAR_PADRAO = 'img/default_avatar.webp';

// --- FUNÇÕES DE AUXÍLIO ---

async function obterRanking() {
    try {
        // Busca os 10 melhores direto do banco
        return await User.find()
            .sort({ pontos: -1 })
            .limit(10)
            .select('username pontos avatar');
    } catch (e) {
        return [];
    }
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
    
    // LOGIN E CADASTRO (Lógica do Banco)
    socket.on('solicitarLogin', async ({ username, senha }) => {
        try {
            let usuario = await User.findOne({ username });

            if (usuario) {
                if (usuario.senha === senha) {
                    socket.emit('loginSucesso', usuario);
                } else {
                    socket.emit('erroLogin', "Senha incorreta!");
                }
            } else {
                // Se não existe, cria um novo
                usuario = new User({ username, senha, pontos: 0, avatar: AVATAR_PADRAO });
                await usuario.save();
                socket.emit('loginSucesso', usuario);
            }
        } catch (err) {
            socket.emit('erroLogin', "Erro ao processar login.");
        }
    });

    socket.on('loginExistente', async (dados) => {
        try {
            const usuario = await User.findOne({ username: dados.username, senha: dados.senha });
            if (usuario) socket.emit('loginSucesso', usuario);
        } catch (e) {}
    });

    // ATUALIZAR FOTO NO BANCO
    socket.on('atualizarAvatar', async ({ username, avatar }) => {
        try {
            await User.findOneAndUpdate({ username }, { avatar });
            socket.emit('avatarAtualizado', avatar);
        } catch (e) {}
    });

    // RANKING BUSCADO DO BANCO
    socket.on('obterRanking', async () => {
        const lista = await obterRanking();
        socket.emit('receberRanking', lista);
    });

    // BUSCA DE PARTIDA
    socket.on('procurarPartida', (dadosChar) => {
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
                    p1: { id: p1.id, username: p1.username, avatar: p1.avatar, hpMax: p1.char.hp, hp: p1.char.hp, nome: p1.char.nome, turnosRealizados: 0, cooldowns: {} },
                    p2: { id: p2.id, username: p2.username, avatar: p2.avatar, hpMax: p2.char.hp, hp: p2.char.hp, nome: p2.char.nome, turnosRealizados: 0, cooldowns: {} },
                    turno: p1.id,
                    timer: null
                };

                io.to(salaId).emit('startBattle', { 
                    player1: { ...p1.char, username: p1.username, avatar: p1.avatar }, 
                    player2: { ...p2.char, username: p2.username, avatar: p2.avatar }, 
                    p1Id: p1.id, p2Id: p2.id, salaId 
                });
                gerenciarTimer(salaId);
            }
        }
    });

    // COMBATE
    socket.on('atacar', async ({ salaId, danoBase, nomeAtaque, isUlt }) => {
        const sala = salas[salaId];
        if (!sala || sala.turno !== socket.id) return;

        const atacante = socket.id === sala.p1.id ? sala.p1 : sala.p2;
        const alvo = socket.id === sala.p1.id ? sala.p2 : sala.p1;

        if (atacante.cooldowns[nomeAtaque] > 0) return;

        let danoFinal = isUlt ? (Math.random() < 0.5 ? 60 : 75) : (danoBase - Math.floor(Math.random() * (Math.floor(danoBase * 0.15) + 1)));
        if (isUlt) atacante.turnosRealizados = 0;
        else if (danoBase > 25) atacante.cooldowns[nomeAtaque] = 3;

        alvo.hp -= danoFinal;
        atacante.turnosRealizados++;

        for (let chave in atacante.cooldowns) { if (atacante.cooldowns[chave] > 0) atacante.cooldowns[chave]--; }

        sala.turno = alvo.id;

        io.to(salaId).emit('atualizarBatalha', {
            atacante: atacante.id, dano: danoFinal, nomeAtaque,
            novoHpAlvo: Math.max(0, (alvo.hp / alvo.hpMax) * 100),
            proximoTurno: sala.turno,
            statsP1: { id: sala.p1.id, turnos: sala.p1.turnosRealizados, cds: sala.p1.cooldowns },
            statsP2: { id: sala.p2.id, turnos: sala.p2.turnosRealizados, cds: sala.p2.cooldowns }
        });

        if (alvo.hp <= 0) {
            clearTimeout(sala.timer);
            
            // ATUALIZAÇÃO NO BANCO DE DADOS (Persistente)
            try {
                await User.findOneAndUpdate({ username: atacante.username }, { $inc: { pontos: 50 } });
                await User.findOneAndUpdate({ username: alvo.username }, { $inc: { pontos: -25 } });
                // Garante que pontos não fiquem negativos
                await User.updateOne({ username: alvo.username, pontos: { $lt: 0 } }, { pontos: 0 });
            } catch (e) { console.error("Erro ao atualizar pontos:", e); }

            io.to(salaId).emit('fimBatalha', { vencedor: atacante.id });
            delete salas[salaId];
        } else {
            gerenciarTimer(salaId);
        }
    });

    socket.on('disconnect', () => {
        fila = fila.filter(p => p.id !== socket.id);
    });
});

http.listen(PORT, () => {
    console.log(`Servidor anistats.fun rodando na porta ${PORT}`);
});