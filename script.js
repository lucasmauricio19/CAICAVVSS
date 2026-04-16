
// 🔥 Firebase config (COLE O SEU AQUI)
const firebaseConfig = {
  apiKey: "SUA_API_KEY",
  authDomain: "SEU_AUTH_DOMAIN",
  projectId: "SEU_PROJECT_ID",
  storageBucket: "SEU_BUCKET",
  messagingSenderId: "SEU_ID",
  appId: "SEU_APP_ID"
};

// inicializa Firebase
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();

let userAtual = null;

//
// 🔐 LOGIN
//
function login() {
  let email = document.getElementById("email").value;
  let senha = document.getElementById("senha").value;

  auth.signInWithEmailAndPassword(email, senha)
    .then(user => {
      userAtual = user.user;
      entrarApp();
    })
    .catch(err => alert(err.message));
}

function logout() {
  auth.signOut().then(() => location.reload());
}

function entrarApp() {
  document.getElementById("loginBox").style.display = "none";
  document.getElementById("app").style.display = "block";
  document.getElementById("userInfo").innerText =
    "Logado como: " + userAtual.email;

  carregarDados();
}

//
// 🧠 ADICIONAR ATENDIMENTO
//
function adicionar() {
  db.collection("atendimentos").add({
    nome: document.getElementById("nome").value,
    pasta: document.getElementById("pasta").value,
    tecnico: document.getElementById("tecnico").value,
    data: document.getElementById("data").value,
    hora: document.getElementById("hora").value
  });

  alert("Salvo!");
  carregarDados();
}

//
// 📊 CARREGAR DADOS
//
function carregarDados() {
  db.collection("atendimentos").onSnapshot(snapshot => {
    let lista = document.getElementById("lista");
    lista.innerHTML = "";

    snapshot.forEach(doc => {
      let a = doc.data();

      lista.innerHTML += `
        <div>
          <b>${a.nome}</b> - Pasta ${a.pasta}<br>
          Técnico: ${a.tecnico}<br>
          ${a.data} | ${a.hora}
          <hr>
        </div>
      `;
    });
  });
}