
// 🔥 CONFIG FIREBASE (COLOQUE A SUA)
const firebaseConfig = {
  apiKey: "SUA_API_KEY",
  authDomain: "SEU_AUTH_DOMAIN",
  projectId: "SEU_PROJECT_ID",
  storageBucket: "SEU_STORAGE",
  messagingSenderId: "SEU_ID",
  appId: "SEU_APP_ID"
};

firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();

//
// ➕ ADICIONAR ATENDIMENTO
//
function adicionar() {

  let nome = document.getElementById("nome").value;
  let pasta = document.getElementById("pasta").value;
  let tecnico = document.getElementById("tecnico").value;
  let data = document.getElementById("data").value;
  let hora = document.getElementById("hora").value;

  if (!nome || !pasta || !tecnico || !data || !hora) {
    alert("Preencha todos os campos!");
    return;
  }

  db.collection("atendimentos").add({
    nome,
    pasta,
    tecnico,
    data,
    hora,
    criadoEm: Date.now()
  });

  limparCampos();
}

//
// 📥 LISTA EM TEMPO REAL
//
db.collection("atendimentos")
  .orderBy("criadoEm", "desc")
  .onSnapshot(snapshot => {

    let lista = document.getElementById("lista");
    lista.innerHTML = "";

    snapshot.forEach(doc => {
      let a = doc.data();

      lista.innerHTML += `
        <div>
          <b>${a.nome}</b><br>
          Pasta: ${a.pasta}<br>
          Técnico: ${a.tecnico}<br>
          ${a.data} | ${a.hora}
        </div>
      `;
    });

  });

//
// 🧹 LIMPAR CAMPOS
//
function limparCampos() {
  document.getElementById("nome").value = "";
  document.getElementById("pasta").value = "";
  document.getElementById("tecnico").value = "";
  document.getElementById("data").value = "";
  document.getElementById("hora").value = "";
}