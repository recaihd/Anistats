require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);

const PORT = process.env.PORT || 3000;
const MONGO_URI = process.env.MONGO_URI;

app.use(express.static(__dirname));

// conexão com o mongo
mongoose.connect(MONGO_URI)
    .then(() => console.log("✅ Conectado ao MongoDB Atlas"))
    .catch(err => console.error("❌ Erro ao conectar ao MongoDB:", err));


const UserSchema = new mongoose.Schema({
    username: { type: String, unique: true, required: true },
    senha: { type: String, required: true },
    pontos: { type: Number, default: 0 },
    avatar: { type: String, default: 'img/default_avatar.webp' }
});
const User = mongoose.model('User', UserSchema);


let fila = [];
let salas = {}; 
const TEMPO_TURNO = 20;
const AVATAR_PADRAO = 'img/default_avatar.webp';



async function obterRanking() {
    try {
        return await User.find()
            .sort({ pontos: -1 })
            .limit(10)
            .select('username pontos avatar');
    } catch (e) { return []; }
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
    
    
    const atacante = atacanteId === sala.p1.id ? sala.p1 : sala.p2;
    atacante.turnosRealizados++;
    for (let chave in atacante.cooldowns) { if (atacante.cooldowns[chave] > 0) atacante.cooldowns[chave]--; }

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



io.on('connection', (socket) => {
    
    socket.on('solicitarLogin', async ({ username, senha }) => {
        try {
            let usuario = await User.findOne({ username });

            if (usuario) {
                if (usuario.senha === senha) {
                    const uObj = usuario.toObject();
                    delete uObj.senha; // não envia a senha para o front
                    socket.emit('loginSucesso', uObj);
                } else {
                    socket.emit('erroLogin', "Senha incorreta!");
                }
            } else {
                usuario = new User({ username, senha, pontos: 0, avatar: AVATAR_PADRAO });
                await usuario.save();
                const uObj = usuario.toObject();
                delete uObj.senha;
                socket.emit('loginSucesso', uObj);
            }
        } catch (err) {
            socket.emit('erroLogin', "Erro ao processar login.");
        }
    });

    socket.on('loginExistente', async (dados) => {
        try {
            const usuario = await User.findOne({ username: dados.username }).select('-senha');
            if (usuario) socket.emit('loginSucesso', usuario);
        } catch (e) {}
    });

    socket.on('atualizarAvatar', async ({ username, avatar }) => {
        try {
            await User.findOneAndUpdate({ username }, { avatar });
            socket.emit('avatarAtualizado', avatar);
        } catch (e) {}
    });

    socket.on('obterRanking', async () => {
        const lista = await obterRanking();
        socket.emit('receberRanking', lista);
    });

    socket.on('procurarPartida', (dadosChar) => {
        
        fila = fila.filter(p => p.username !== dadosChar.username);
        
        fila.push({ 
            id: socket.id, 
            char: dadosChar, 
            username: dadosChar.username,
            avatar: dadosChar.avatar || AVATAR_PADRAO
        });

        if (fila.length >= 2) {
            const p1 = fila.shift();
            const p2 = fila.shift();
            const salaId = `sala_${p1.id}_${Date.now()}`;

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
            const winnerId = atacante.id;
            
            try {
                // Ganha 50 pontos
                await User.findOneAndUpdate({ username: atacante.username }, { $inc: { pontos: 50 } });
                // Perde 25 pontos, mas o mínimo é 0
                const userAlvo = await User.findOne({ username: alvo.username });
                if (userAlvo) {
                    let novosPontos = Math.max(0, userAlvo.pontos - 25);
                    await User.updateOne({ username: alvo.username }, { $set: { pontos: novosPontos } });
                }
            } catch (e) { console.error("Erro banco:", e); }

            io.to(salaId).emit('fimBatalha', { vencedor: winnerId });
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
    console.log(` Servidor Anistats rodando na porta ${PORT}`);
});