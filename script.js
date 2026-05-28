// Firebase
const firebaseConfig = {
    apiKey: "AIzaSyB5Rvz_snCwJCXwTp3gnpV8fa0K13FcrA",
    authDomain: "caicavvagendamentos.firebaseapp.com",
    projectId: "caicavvagendamentos",
    storageBucket: "caicavvagendamentos.firebasestorage.app",
    messagingSenderId: "402044173505",
    appId: "1:402044173505:web:300c6bca3116adc108a840"
};

firebase.initializeApp(firebaseConfig);

const db = firebase.firestore();
const DOC_ATENDIMENTOS = db.collection("caicavv").doc("atendimentos");


// ==========================
// EXEMPLO DE FUNÇÕES
// ==========================

// Toast
function mostrarToast(msg, tipo = "sucesso") {
    const toast = document.createElement("div");

    toast.className = `toast show ${tipo}`;
    toast.innerText = msg;

    document.body.appendChild(toast);

    setTimeout(() => {
        toast.remove();
    }, 3000);
}


// Login simples
function login() {
    const usuario = document.getElementById("usuario").value;
    const senha = document.getElementById("senha").value;

    if (usuario === "admin" && senha === "123") {
        document.body.classList.add("modo-app");

        document.getElementById("loginScreen").style.display = "none";
        document.getElementById("app").style.display = "block";

        mostrarToast("Login realizado com sucesso!");
    } else {
        mostrarToast("Usuário ou senha inválidos", "erro");
    }
}


// Logout
function logout() {
    document.body.classList.remove("modo-app");

    document.getElementById("loginScreen").style.display = "flex";
    document.getElementById("app").style.display = "none";

    mostrarToast("Você saiu do sistema");
}


// Mostrar/Ocultar senha
function toggleSenha() {
    const senha = document.getElementById("senha");

    if (senha.type === "password") {
        senha.type = "text";
    } else {
        senha.type = "password";
    }
}


// ==========================
// ATENDIMENTOS
// ==========================

let atendimentos = [];


// Adicionar atendimento
async function adicionarAtendimento() {

    const nome = document.getElementById("nome").value;
    const tecnico = document.getElementById("tecnico").value;
    const data = document.getElementById("data").value;
    const descricao = document.getElementById("descricao").value;

    if (!nome || !tecnico || !data) {
        mostrarToast("Preencha os campos obrigatórios", "erro");
        return;
    }

    const novo = {
        id: Date.now(),
        nome,
        tecnico,
        data,
        descricao,
        status: "pendente"
    };

    atendimentos.push(novo);

    await salvarFirebase();

    renderizarAtendimentos();

    limparFormulario();

    mostrarToast("Atendimento adicionado!");
}


// Renderizar atendimentos
function renderizarAtendimentos() {

    const lista = document.getElementById("listaAtendimentos");

    lista.innerHTML = "";

    if (atendimentos.length === 0) {
        lista.innerHTML = `
            <div class="lista-vazia">
                Nenhum atendimento encontrado
            </div>
        `;
        return;
    }

    atendimentos.forEach(item => {

        lista.innerHTML += `
            <div class="card atendimento-card v10-card">

                <div class="v10-card-inner">

                    <div class="v10-card-top">
                        <div class="v10-identidade">

                            <div class="v10-nome">
                                ${item.nome}
                            </div>

                            <div class="v10-sub">
                                <span>Técnico: ${item.tecnico}</span>
                                <span>Data: ${item.data}</span>
                            </div>

                        </div>

                        <span class="status-chip">
                            ${item.status}
                        </span>
                    </div>

                    <div class="v10-meta">

                        <div class="v10-meta-item">
                            <div class="v10-meta-label">
                                Descrição
                            </div>

                            <div class="v10-meta-value">
                                ${item.descricao || "-"}
                            </div>
                        </div>

                    </div>

                    <div class="v10-actions">

                        <button
                            class="compareceu"
                            onclick="marcarCompareceu(${item.id})"
                        >
                            Compareceu
                        </button>

                        <button
                            class="faltou"
                            onclick="marcarFaltou(${item.id})"
                        >
                            Faltou
                        </button>

                        <button
                            class="excluir"
                            onclick="excluirAtendimento(${item.id})"
                        >
                            Excluir
                        </button>

                    </div>

                </div>
            </div>
        `;
    });
}


// Marcar compareceu
async function marcarCompareceu(id) {

    atendimentos = atendimentos.map(item => {

        if (item.id === id) {
            item.status = "compareceu";
        }

        return item;
    });

    await salvarFirebase();

    renderizarAtendimentos();

    mostrarToast("Paciente marcou presença");
}


// Marcar falta
async function marcarFaltou(id) {

    atendimentos = atendimentos.map(item => {

        if (item.id === id) {
            item.status = "faltou";
        }

        return item;
    });

    await salvarFirebase();

    renderizarAtendimentos();

    mostrarToast("Falta registrada");
}


// Excluir atendimento
async function excluirAtendimento(id) {

    atendimentos = atendimentos.filter(item => item.id !== id);

    await salvarFirebase();

    renderizarAtendimentos();

    mostrarToast("Atendimento excluído");
}


// Limpar formulário
function limparFormulario() {

    document.getElementById("nome").value = "";
    document.getElementById("tecnico").value = "";
    document.getElementById("data").value = "";
    document.getElementById("descricao").value = "";
}


// ==========================
// FIREBASE
// ==========================

// Salvar no Firebase
async function salvarFirebase() {

    try {

        await DOC_ATENDIMENTOS.set({
            lista: atendimentos
        });

    } catch (erro) {

        console.error(erro);

        mostrarToast("Erro ao salvar", "erro");
    }
}


// Carregar do Firebase
async function carregarFirebase() {

    try {

        const doc = await DOC_ATENDIMENTOS.get();

        if (doc.exists) {

            const dados = doc.data();

            atendimentos = dados.lista || [];

            renderizarAtendimentos();
        }

    } catch (erro) {

        console.error(erro);

        mostrarToast("Erro ao carregar dados", "erro");
    }
}


// ==========================
// INICIAR
// ==========================

window.onload = () => {

    carregarFirebase();

};