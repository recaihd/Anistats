const socket = io(window.location.origin);
const personagensManuais = [
    { id: 1, nome: "Goku", img: "img/goku.png", hp: 150, ataques: [{ n: "Kamehameha", d: 30 }, { n: "Soco", d: 15 }], ult: "Instinto Superior" },
    { id: 2, nome: "Saitama", img: "img/saitama.png", hp: 150, ataques: [{ n: "Soco Sério", d: 38 }, { n: "Soco Normal", d: 20 }], ult: "Soco de Morte" },
    { id: 3, nome: "Naruto", img: "img/naruto.png", hp: 150, ataques: [{ n: "Rasengan", d: 30 }, { n: "Clone", d: 20 }], ult: "Modo Baryon" },
    { id: 4, nome: "Makima", img: "img/makima.png", hp: 150, ataques: [{ n: "Bang!", d: 32 }, { n: "Controle", d: 17 }], ult: "Sacrifício Ritual" },
    { id: 5, nome: "Frieren", img: "img/frieren.png", hp: 150, ataques: [{ n: "Zoltraak", d: 38 }, { n: "Mana Blast", d: 17 }], ult: "Magia Apocalíptica" },
    { id: 6, nome: "Roxy", img: "img/roxy.png", hp: 150, ataques: [{ n: "Water Splash", d: 30 }, { n: "Cajado", d: 16 }], ult: "Canto do Oceano" },
    { id: 7, nome: "Megumin", img: "img/megumin.png", hp: 150, ataques: [{ n: "EXPLOSION!", d: 37 }, { n: "Cajadada", d: 16 }], ult: "GRANDE EXPLOSÃO" },
    { id: 8, nome: "Zero Two", img: "img/zerotwo.png", hp: 150, ataques: [{ n: "Strelizia", d: 32 }, { n: "Garra", d: 16 }], ult: "Fúria de Klaxossauro" },
    { id: 9, nome: "Miku", img: "img/miku.png", hp: 150, ataques: [{ n: "Beijo do Amor", d: 32 }, { n: "Soco Fofo", d: 15 }], ult: "Sinfonia Digital" },
    { id: 10, nome: "Ayanami", img: "img/rei.png", hp: 150, ataques: [{ n: "Manipulação de Energia", d: 34 }, { n: "Levitação", d: 17 }], ult: "Transferência de Alma" },
    { id: 11, nome: "Elaine", img: "img/elaine.png.png", hp: 150, ataques: [{ n: "Manipulação do Ambiente", d: 33 }, { n: "Ataque Psicológico", d: 16 }], ult: "Mana Explosiva" },
    { id: 12, nome: "Nyaruko", img: "img/nyaruko.png", hp: 150, ataques: [{ n: "Super Força", d: 32 }, { n: "Explosivos", d: 15 }], ult: "Transformação" }
];

let minhaSala = null, meuPersonagem = null, meuTurno = false, meuUsuario = null;
let meusStatus = { turnos: 0, cds: {} }, cronometroFront = null;
const IMG_PADRAO = "img/default_avatar.webp";


function setCookie(n, v, d) {
    const date = new Date();
    date.setTime(date.getTime() + (d * 24 * 60 * 60 * 1000));
    const value = encodeURIComponent(JSON.stringify(v));
    document.cookie = n + "=" + value + ";expires=" + date.toUTCString() + ";path=/";
}

function getCookie(n) {
    const name = n + "=";
    const decodedCookie = decodeURIComponent(document.cookie);
    const ca = decodedCookie.split(';');
    for (let i = 0; i < ca.length; i++) {
        let c = ca[i];
        while (c.charAt(0) == ' ') c = c.substring(1);
        if (c.indexOf(name) == 0) {
            try {
                return JSON.parse(c.substring(name.length, c.length));
            } catch (e) { return null; }
        }
    }
    return null;
}

window.onload = () => {
    const salvo = getCookie("auth_anistats");
    if (salvo && salvo.username) {
        meuUsuario = salvo;
        socket.emit('loginExistente', meuUsuario);
    } else {
        document.getElementById('login-modal').classList.remove('hidden');
    }
};

// login e perfil
function fazerLogin() {
    const u = document.getElementById('login-user').value.trim();
    const p = document.getElementById('login-pass').value.trim();
    if (u.length < 3) return alert("Username muito curto!");
    socket.emit('solicitarLogin', { username: u, senha: p });
}

socket.on('loginSucesso', d => {
    meuUsuario = d;
    setCookie("auth_anistats", d, 30);
    document.getElementById('login-modal').classList.add('hidden');
    atualizarUIUsuario();
});

socket.on('erroLogin', m => alert(m));

function atualizarUIUsuario() {
    document.getElementById('user-header-info').classList.remove('hidden');
    document.getElementById('header-username').innerText = meuUsuario.username;
    document.getElementById('header-points').innerText = meuUsuario.pontos;
    document.getElementById('header-avatar').src = meuUsuario.avatar || IMG_PADRAO;
}

function trocarFoto() {
    const url = prompt("URL da nova foto (Link direto de imagem):", meuUsuario.avatar || "");
    if (url) socket.emit('atualizarAvatar', { username: meuUsuario.username, avatar: url });
}

socket.on('avatarAtualizado', url => {
    meuUsuario.avatar = url;
    atualizarUIUsuario();
    setCookie("auth_anistats", meuUsuario, 30);
});

// ranking do jogo
function toggleRanking() {
    const m = document.getElementById('ranking-modal');
    m.classList.toggle('hidden');
    if (!m.classList.contains('hidden')) socket.emit('obterRanking');
}

socket.on('receberRanking', l => {
    document.getElementById('ranking-list').innerHTML = l.map((u, i) => `
            <div class="ranking-item">
                <span class="rank-number">#${i + 1}</span>
                <img src="${u.avatar || IMG_PADRAO}" class="ranking-avatar">
                <span class="ranking-name">${u.username}</span>
                <span class="ranking-pts">${u.pontos} pts</span>
            </div>
        `).join('');
});

// --- SELEÇÃO E BUSCA ---
function irParaSelecao() {
    document.getElementById('home-screen').classList.add('hidden');
    document.getElementById('select-screen').classList.remove('hidden');
    const list = document.getElementById('char-list');
    list.innerHTML = personagensManuais.map(c => `
            <div class="char-card" onclick="confirmarEscolha(${c.id})">
                <div class="char-img"><img src="${c.img}"></div>
                <div class="char-info"><p style="font-size:0.7rem; color:var(--primary-pink)">LEVEL 100</p><p>${c.nome}</p></div>
            </div>
        `).join('');
}

function confirmarEscolha(id) {
    meuPersonagem = personagensManuais.find(c => c.id === id);
    document.getElementById('select-screen').innerHTML = `
            <div style="margin-top:50px">
                <img src="img/f1.gif" style="width:100px">
                <h2 style="margin-top:20px">PROCURANDO OPONENTE...</h2>
            </div>`;
    socket.emit('procurarPartida', { ...meuPersonagem, username: meuUsuario.username, avatar: meuUsuario.avatar });
}

// --- BATALHA ---
socket.on('startBattle', d => {
    minhaSala = d.salaId;
    meuTurno = (d.p1Id === socket.id);

    document.getElementById('bg-video').src = "videos/body_battle.mp4";
    document.getElementById('select-screen').classList.add('hidden');
    document.getElementById('battle-screen').classList.remove('hidden');

    const souP1 = socket.id === d.p1Id;
    const eu = souP1 ? d.player1 : d.player2;
    const oponente = souP1 ? d.player2 : d.player1;

    document.getElementById('p1-name').innerText = eu.nome;
    document.getElementById('p1-img').src = eu.img;
    document.getElementById('p2-name').innerText = oponente.nome;
    document.getElementById('p2-img').src = oponente.img;

    document.getElementById('p1-user-name').innerText = eu.username;
    document.getElementById('p1-user-avatar').src = eu.avatar || IMG_PADRAO;
    document.getElementById('p2-user-name').innerText = oponente.username;
    document.getElementById('p2-user-avatar').src = oponente.avatar || IMG_PADRAO;

    renderAcoes();
    iniciarCronometro();
});

function iniciarCronometro() {
    if (cronometroFront) clearInterval(cronometroFront);
    let t = 20;
    const disp = document.getElementById('timer-display');
    disp.innerText = "20s";
    cronometroFront = setInterval(() => {
        t--; disp.innerText = t + "s";
        if (t <= 0) clearInterval(cronometroFront);
    }, 1000);
}

function renderAcoes() {
    const container = document.getElementById('actions');
    let html = meuPersonagem.ataques.map(a => {
        const cd = meusStatus.cds[a.n] > 0;
        return `<button class="skill-btn" onclick="usarAtaque(${a.d},'${a.n}',false)" ${(!meuTurno || cd) ? 'disabled' : ''}>
                ${a.n} ${cd ? `(${meusStatus.cds[a.n]}T)` : ''}
            </button>`;
    }).join('');
    const podeUlt = meusStatus.turnos >= 6;
    html += `<button class="skill-btn ult-btn ${podeUlt ? 'ult-ready' : ''}" onclick="usarAtaque(75,'${meuPersonagem.ult}',true)" ${(!meuTurno || !podeUlt) ? 'disabled' : ''}>ULT: ${meuPersonagem.ult}</button>`;
    container.innerHTML = html;
}

function usarAtaque(d, n, u) {
    socket.emit('atacar', { salaId: minhaSala, danoBase: d, nomeAtaque: n, isUlt: u });
    meuTurno = false;
    renderAcoes();
}

socket.on('atualizarBatalha', r => {
    const isEuAtacando = r.atacante === socket.id;
    const alvoDivId = isEuAtacando ? 'player-2' : 'player-1';
    const hpId = isEuAtacando ? 'p2-hp' : 'p1-hp';

    if (r.dano > 0) {
        const d = document.createElement('div');
        d.className = 'floating-damage';
        d.innerText = `-${r.dano}`;
        document.getElementById(alvoDivId).appendChild(d);
        setTimeout(() => d.remove(), 800);
        document.getElementById(alvoDivId).classList.add('shake');
        setTimeout(() => document.getElementById(alvoDivId).classList.remove('shake'), 400);
    }
    document.getElementById(hpId).style.width = r.novoHpAlvo + "%";
    document.getElementById('battle-log').innerText = `${isEuAtacando ? 'Você' : 'Oponente'} usou ${r.nomeAtaque}!`;

    meusStatus = (r.statsP1.id === socket.id) ? r.statsP1 : r.statsP2;
    meuTurno = r.proximoTurno === socket.id;
    renderAcoes();
    iniciarCronometro();
});

socket.on('fimBatalha', r => {
    clearInterval(cronometroFront);
    const venci = r.vencedor === socket.id;
    const screen = document.getElementById('result-screen');
    const title = document.getElementById('result-title');
    const change = document.getElementById('result-change');

    // atualização de pontos local para o header
    if (venci) {
        meuUsuario.pontos += 50;
    } else {
        meuUsuario.pontos = Math.max(0, meuUsuario.pontos - 25);
    }

    atualizarUIUsuario();
    setCookie("auth_anistats", meuUsuario, 30);

    screen.classList.remove('hidden');
    if (venci) {
        title.innerText = "VITÓRIA";
        title.className = "result-title win-text";
        change.innerText = "GANHOU +50";
        change.style.color = "#10b981";

        if (r.motivo === 'disconnect') {
            const msg = document.createElement('div');
            msg.innerText = "(Oponente desconectou)";
            msg.style.fontSize = "1rem";
            msg.style.marginTop = "5px";
            msg.style.color = "#ccc";
            title.appendChild(msg);
        }
    } else {
        title.innerText = "DERROTA";
        title.className = "result-title lose-text";
        change.innerText = "PERDEU -25";
        change.style.color = "#ef4444";
    }
});