// Sorteio do Casamento -- app de pagina unica, sem build step.
// Visao do convidado (padrao) + visao do organizador (#admin, protegida por
// uma chave). Tudo client-side, dados no Supabase (RLS publica de leitura,
// escrita so via funcoes RPC -- ver migracao no banco).

const SUPABASE_URL = "https://vckecwbtmejlchecrfch.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZja2Vjd2J0bWVqbGNoZWNyZmNoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE3MjQ2MzUsImV4cCI6MjEwNzMwMDYzNX0.6IAgEb5ZjyoLsWsS4gCWvZOd6HJ38qrvsV2NtCbyhfw";

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const app = document.getElementById("app");

function money(v) {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function escapeHtml(s) {
  const div = document.createElement("div");
  div.textContent = s;
  return div.innerHTML;
}

// ---------------------------------------------------------------------------
// Roteamento simples por hash: "#admin" mostra o painel do organizador,
// qualquer outra coisa (ou nada) mostra a tela do convidado.
// ---------------------------------------------------------------------------
function route() {
  document.body.classList.toggle("admin", location.hash.startsWith("#admin"));
  if (location.hash.startsWith("#admin")) {
    renderAdmin();
  } else {
    renderGuest();
  }
}
window.addEventListener("hashchange", route);

// ---------------------------------------------------------------------------
// Dados compartilhados
// ---------------------------------------------------------------------------
async function loadConfig() {
  const { data, error } = await sb.from("config").select("*").eq("id", 1).single();
  if (error) throw error;
  return data;
}

async function loadNumbers() {
  const { data, error } = await sb
    .from("raffle_numbers")
    .select("number, reservation_id")
    .order("number");
  if (error) throw error;
  return data;
}

async function loadReservations() {
  const { data, error } = await sb
    .from("reservations")
    .select("id, guest_name, total_price, created_at")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data;
}

// Pedido do usuario (2026-10-11): mostrar o NOME de quem ganhou, nao so o
// numero -- numero e nome ja ficam ligados via raffle_numbers.reservation_id,
// so precisava expor essa ligacao na tela do sorteio.
async function loadWinnerGuestName(winnerNumber) {
  const { data, error } = await sb
    .from("raffle_numbers")
    .select("reservations(guest_name)")
    .eq("number", winnerNumber)
    .single();
  if (error || !data?.reservations) return null;
  return data.reservations.guest_name;
}

// ===========================================================================
// VISAO DO CONVIDADO
// ===========================================================================
let guestState = {
  config: null,
  numbers: [],
  selectedTier: null, // {quantity, price}
  selected: new Set(),
  submitting: false,
  error: null,
  result: null, // {numbers, total, reservationId}
};

async function renderGuest() {
  app.innerHTML = `<p style="padding-top:60px;text-align:center;color:var(--cream-dim)">Carregando…</p>`;
  try {
    const [config, numbers] = await Promise.all([loadConfig(), loadNumbers()]);
    guestState.config = config;
    guestState.numbers = numbers;
  } catch (err) {
    app.innerHTML = `<p style="padding-top:60px;text-align:center;color:#ffb4b4">Não consegui carregar o sorteio. Atualize a página.</p>`;
    console.error(err);
    return;
  }

  paintGuest();
  subscribeNumbers();
}

let numbersChannel = null;
function subscribeNumbers() {
  if (numbersChannel) return;
  numbersChannel = sb
    .channel("raffle_numbers_changes")
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "raffle_numbers" },
      async () => {
        guestState.numbers = await loadNumbers();
        if (!location.hash.startsWith("#admin")) paintGuest();
      }
    )
    .subscribe();
}

function paintGuest() {
  const { config, numbers, result } = guestState;

  if (config.winner_number) {
    paintWinnerScreen();
    return;
  }

  if (result) {
    paintConfirmation();
    return;
  }

  const tiers = config.pricing_tiers || [];
  const takenCount = numbers.filter((n) => n.reservation_id).length;

  app.innerHTML = `
    <div class="hero">
      <svg class="tie-mark" viewBox="0 0 34 54" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M17 0L24 10L19 16L22 48L17 54L12 48L15 16L10 10L17 0Z" fill="var(--gold)" />
      </svg>
      <h1>${escapeHtml(config.event_name)}</h1>
      <p class="sub">Toda doação ajuda a gente na lua de mel — e cada R$ doado te dá um número da sorte, como agradecimento.</p>
    </div>

    <div class="wrap">
      <section>
        <div class="card prize-card">
          <div>
            <p class="label">o prêmio é</p>
            <p class="name">${escapeHtml(config.prize_description)}</p>
          </div>
        </div>
      </section>

      <section>
        <h2 class="section-title">Faça sua parte</h2>
        <p class="section-hint">Escolha quantos números da sorte você quer ganhar como agradecimento pela doação.</p>
        <div class="tiers" id="tiers"></div>
      </section>

      <section id="grid-section" ${guestState.selectedTier ? "" : "hidden"}>
        <h2 class="section-title">Escolha seus números</h2>
        <div class="grid-controls">
          <span id="grid-count"></span>
          <span style="color:var(--cream-dim);font-size:0.8rem">${takenCount}/${numbers.length} já escolhidos</span>
        </div>
        <div class="num-grid" id="num-grid"></div>
        <div class="legend">
          <span><i class="i-free"></i>livre</span>
          <span><i class="i-sel"></i>seu</span>
          <span><i class="i-taken"></i>já doado</span>
        </div>
      </section>

      <section id="checkout-section" ${guestState.selectedTier ? "" : "hidden"}>
        <div class="checkout">
          <div class="checkout-bar">
            <div class="checkout-total">
              <span>Total da doação</span>
              <span class="amt">${guestState.selectedTier ? money(guestState.selectedTier.price) : money(0)}</span>
            </div>
            <input type="text" id="guest-name" placeholder="Seu nome" value="${guestState.nameDraft ? escapeHtml(guestState.nameDraft) : ""}" />
            ${guestState.error ? `<p class="error-msg">${escapeHtml(guestState.error)}</p>` : ""}
            <button class="btn-primary" id="confirm-btn" ${guestState.submitting ? "disabled" : ""}>
              ${guestState.submitting ? "Confirmando…" : "Confirmar doação"}
            </button>
          </div>
        </div>
      </section>

      <footer>
        feito com carinho para este casamento ·
        <a href="#admin">organizador</a>
      </footer>
    </div>
  `;

  // Tiers
  const tiersEl = document.getElementById("tiers");
  tiersEl.innerHTML = tiers
    .map(
      (t, i) => `
      <button class="tier" data-idx="${i}" style="${
        guestState.selectedTier === t ? "background:var(--gold);color:var(--ink);border-color:var(--gold-bright)" : ""
      }">
        <span class="qty">${t.quantity}</span>
        <span class="qty-label">número${t.quantity > 1 ? "s" : ""}</span>
        <div class="price">${money(t.price)}</div>
      </button>`
    )
    .join("");
  tiersEl.querySelectorAll(".tier").forEach((btn) => {
    btn.addEventListener("click", () => {
      guestState.selectedTier = tiers[Number(btn.dataset.idx)];
      guestState.selected = new Set();
      guestState.error = null;
      paintGuest();
      document.getElementById("grid-section")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });

  if (guestState.selectedTier) {
    const gridEl = document.getElementById("num-grid");
    gridEl.innerHTML = numbers
      .map((n) => {
        const taken = Boolean(n.reservation_id);
        const selected = guestState.selected.has(n.number);
        const cls = taken ? "taken" : selected ? "selected" : "";
        return `<button class="num ${cls}" data-n="${n.number}" ${taken ? "disabled" : ""}>${n.number}</button>`;
      })
      .join("");

    gridEl.querySelectorAll(".num:not(.taken)").forEach((btn) => {
      btn.addEventListener("click", () => {
        const n = Number(btn.dataset.n);
        const needed = guestState.selectedTier.quantity;
        if (guestState.selected.has(n)) {
          guestState.selected.delete(n);
        } else if (guestState.selected.size < needed) {
          guestState.selected.add(n);
        }
        paintGuest();
      });
    });

    const needed = guestState.selectedTier.quantity;
    document.getElementById("grid-count").textContent = `${guestState.selected.size}/${needed} escolhidos`;

    const confirmBtn = document.getElementById("confirm-btn");
    const isReady = () =>
      guestState.selected.size === needed && (guestState.nameDraft || "").trim().length > 0;

    const nameInput = document.getElementById("guest-name");
    nameInput.addEventListener("input", (e) => {
      guestState.nameDraft = e.target.value;
      // So atualiza o atributo disabled do botao diretamente (sem re-render
      // completo) -- um paintGuest() aqui perderia o foco/cursor do campo de
      // nome no meio da digitacao. Achado ao testar com Playwright: sem
      // isso, o botao ficava preso no estado "desabilitado" de quando foi
      // desenhado pela ultima vez (antes do nome ser digitado).
      confirmBtn.disabled = guestState.submitting || !isReady();
    });

    confirmBtn.disabled = guestState.submitting || !isReady();
    confirmBtn.addEventListener("click", submitClaim);
  }
}

async function submitClaim() {
  const name = (guestState.nameDraft || "").trim();
  if (!name) return;

  guestState.submitting = true;
  guestState.error = null;
  paintGuest();

  const numbersArr = Array.from(guestState.selected);
  const total = guestState.selectedTier.price;

  const { data, error } = await sb.rpc("claim_numbers", {
    p_guest_name: name,
    p_numbers: numbersArr,
    p_total_price: total,
  });

  guestState.submitting = false;

  if (error) {
    guestState.error = error.message.includes("ja foram escolhidos")
      ? "Algum desses números já foi escolhido por outra pessoa agora há pouco. Escolha outro(s)."
      : "Não consegui confirmar. Tente de novo.";
    guestState.numbers = await loadNumbers();
    paintGuest();
    return;
  }

  guestState.result = { numbers: numbersArr, total, reservationId: data };
  paintGuest();
}

function paintConfirmation() {
  const { config, result } = guestState;
  const pixReady = Boolean(config.pix_key);

  const payload = pixReady
    ? buildPixPayload({
        pixKey: config.pix_key,
        amount: result.total,
        merchantName: config.event_name,
        merchantCity: "BRASIL",
        txid: result.reservationId.replace(/-/g, "").slice(0, 25),
      })
    : null;

  let pixHtml = "";
  if (pixReady) {
    pixHtml = `
      <div class="pix-box">
        <div id="pix-qr"></div>
        <div class="pix-copy" id="pix-copy-text">${escapeHtml(payload)}</div>
        <button class="btn-ghost" id="copy-pix" style="color:#333;text-decoration:none;font-weight:600">Copiar código Pix</button>
      </div>
    `;
  }

  app.innerHTML = `
    <div class="hero">
      <svg class="tie-mark" viewBox="0 0 34 54" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M17 0L24 10L19 16L22 48L17 54L12 48L15 16L10 10L17 0Z" fill="var(--gold)" />
      </svg>
      <h1>Muito obrigado!</h1>
    </div>
    <div class="wrap">
      <section>
        <div class="card confirm-card">
          <div class="check">✓</div>
          <p>Seus números da sorte:</p>
          <div class="confirm-numbers">
            ${result.numbers.map((n) => `<span class="n">${n}</span>`).join("")}
          </div>
          <p style="color:var(--cream-dim);font-size:0.9rem">Guarde essa tela — é o seu registro. Pague ${money(
            result.total
          )} via Pix ${pixReady ? "abaixo" : "com o casal"}.</p>
          ${pixHtml}
        </div>
      </section>
      <footer>boa sorte! 💍</footer>
    </div>
  `;

  if (pixReady) {
    // qrcodejs (davidshimjs) renderiza direto no elemento, sem metodo
    // static .toCanvas() -- API diferente do pacote "qrcode" do npm, que
    // nao e um bundle pronto pra <script> (usa require() interno, so
    // funciona com bundler). Achado ao testar com Playwright.
    new QRCode(document.getElementById("pix-qr"), {
      text: payload,
      width: 220,
      height: 220,
      colorDark: "#000000",
      colorLight: "#ffffff",
    });
    document.getElementById("copy-pix").addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(payload);
        document.getElementById("copy-pix").textContent = "Copiado!";
      } catch {
        // clipboard pode falhar em alguns navegadores/contextos -- o texto já está visível pra copiar manualmente
      }
    });
  }
}

async function paintWinnerScreen() {
  const { config } = guestState;
  const guestName = await loadWinnerGuestName(config.winner_number);
  app.innerHTML = `
    <div class="hero">
      <h1>🎉 Temos um vencedor!</h1>
    </div>
    <div class="wrap">
      <div class="winner-banner">
        <p style="margin:0 0 6px">O número sorteado foi</p>
        <div class="winner-num">${config.winner_number}</div>
        ${guestName ? `<p style="margin:10px 0 0;font-weight:600">${escapeHtml(guestName)}</p>` : ""}
      </div>
      <p style="text-align:center;color:var(--cream-dim);margin-top:16px">Obrigado a todos que participaram e ajudaram na nossa lua de mel! 💍</p>
    </div>
  `;
}

// ===========================================================================
// VISAO DO ORGANIZADOR (#admin)
// ===========================================================================
let adminKey = sessionStorage.getItem("sorteio_admin_key") || "";

async function renderAdmin() {
  if (!adminKey) {
    app.innerHTML = `
      <div class="admin-header"><h1>Painel do organizador</h1></div>
      <label>Chave de organizador</label>
      <input type="text" id="admin-key-input" placeholder="Cole a chave aqui" />
      <button class="btn-primary" id="admin-login" style="margin-top:10px">Entrar</button>
    `;
    document.getElementById("admin-login").addEventListener("click", () => {
      const v = document.getElementById("admin-key-input").value.trim();
      if (!v) return;
      adminKey = v;
      sessionStorage.setItem("sorteio_admin_key", v);
      renderAdmin();
    });
    return;
  }

  app.innerHTML = `<p style="padding-top:40px;text-align:center;color:var(--cream-dim)">Carregando…</p>`;
  let config, numbers, reservations;
  try {
    [config, numbers, reservations] = await Promise.all([loadConfig(), loadNumbers(), loadReservations()]);
  } catch (err) {
    app.innerHTML = `<p style="padding-top:40px;text-align:center;color:#ffb4b4">Erro ao carregar.</p>`;
    console.error(err);
    return;
  }

  const taken = numbers.filter((n) => n.reservation_id).length;
  const arrecadado = reservations.reduce((sum, r) => sum + Number(r.total_price), 0);
  const tiers = config.pricing_tiers || [];

  // Nome do vencedor: deriva do que ja foi carregado (numero -> reservation_id
  // -> nome), sem precisar de outra consulta -- mesma ligacao que a tela do
  // convidado usa via loadWinnerGuestName, so que aqui os dados ja estao em mao.
  let winnerName = null;
  if (config.winner_number) {
    const winnerRow = numbers.find((n) => n.number === config.winner_number);
    const winnerReservation = reservations.find((r) => r.id === winnerRow?.reservation_id);
    winnerName = winnerReservation?.guest_name || null;
  }

  app.innerHTML = `
    <div class="admin-header">
      <h1>Painel do organizador</h1>
    </div>

    <div class="card" style="margin-bottom:16px">
      <div class="stat-row"><span>Arrecadado</span><span class="v">${money(arrecadado)}</span></div>
      <div class="stat-row"><span>Números escolhidos</span><span class="v">${taken}/${numbers.length}</span></div>
      <div class="stat-row"><span>Doações</span><span class="v">${reservations.length}</span></div>
    </div>

    ${
      config.winner_number
        ? `<div class="winner-banner"><p style="margin:0 0 6px">Vencedor sorteado</p><div class="winner-num">${config.winner_number}</div>${
            winnerName ? `<p style="margin:10px 0 0;font-weight:600">${escapeHtml(winnerName)}</p>` : ""
          }</div>`
        : `<button class="btn-primary" id="draw-btn" ${taken === 0 ? "disabled" : ""}>Sortear agora</button>`
    }

    <h2 class="section-title" style="margin-top:24px">Prêmio e preços</h2>
    <label>Nome do evento</label>
    <input type="text" id="cfg-event-name" value="${escapeHtml(config.event_name)}" />
    <label>O que será sorteado</label>
    <input type="text" id="cfg-prize" value="${escapeHtml(config.prize_description)}" />
    <label>Pacotes (número de doações e preço)</label>
    <div id="tier-rows"></div>
    <button class="btn-ghost" id="add-tier">+ adicionar pacote</button>

    <label>Chave Pix</label>
    <input type="text" id="cfg-pix-key" value="${escapeHtml(config.pix_key || "")}" placeholder="CPF, celular, e-mail ou chave aleatória" />
    <label>Tipo de chave</label>
    <input type="text" id="cfg-pix-type" value="${escapeHtml(config.pix_key_type || "")}" placeholder="ex: celular" />

    <button class="btn-primary" id="save-cfg" style="margin-top:16px">Salvar alterações</button>
    <p id="save-msg" style="font-size:0.85rem;color:var(--ok);margin-top:8px"></p>

    <h2 class="section-title" style="margin-top:28px">Quem já doou</h2>
    <div class="card">
      ${
        reservations.length === 0
          ? `<p style="color:var(--cream-dim)">Ninguém ainda.</p>`
          : reservations
              .map(
                (r) =>
                  `<div class="reservation-row"><span>${escapeHtml(r.guest_name)}</span><span>${money(Number(r.total_price))}</span></div>`
              )
              .join("")
      }
    </div>

    <footer style="margin-top:24px"><a href="#">← voltar pra tela do convidado</a></footer>
  `;

  function renderTierRows(list) {
    const el = document.getElementById("tier-rows");
    el.innerHTML = list
      .map(
        (t, i) => `
        <div class="tier-row" data-i="${i}">
          <input type="number" min="1" class="t-qty" value="${t.quantity}" placeholder="qtd" />
          <input type="number" min="0" step="0.01" class="t-price" value="${t.price}" placeholder="preço" />
          <button class="btn-ghost t-remove" type="button">remover</button>
        </div>`
      )
      .join("");
    el.querySelectorAll(".t-remove").forEach((btn) => {
      btn.addEventListener("click", () => {
        const i = Number(btn.closest(".tier-row").dataset.i);
        currentTiers.splice(i, 1);
        renderTierRows(currentTiers);
      });
    });
  }

  let currentTiers = tiers.map((t) => ({ ...t }));
  renderTierRows(currentTiers);

  document.getElementById("add-tier").addEventListener("click", () => {
    currentTiers.push({ quantity: 1, price: 0 });
    renderTierRows(currentTiers);
  });

  document.getElementById("save-cfg").addEventListener("click", async () => {
    const rows = document.querySelectorAll(".tier-row");
    const newTiers = Array.from(rows)
      .map((row) => ({
        quantity: Number(row.querySelector(".t-qty").value),
        price: Number(row.querySelector(".t-price").value),
      }))
      .filter((t) => t.quantity > 0 && t.price >= 0)
      .sort((a, b) => a.quantity - b.quantity);

    const { error } = await sb.rpc("admin_update_config", {
      p_admin_key: adminKey,
      p_event_name: document.getElementById("cfg-event-name").value.trim(),
      p_prize_description: document.getElementById("cfg-prize").value.trim(),
      p_pricing_tiers: newTiers,
      p_pix_key: document.getElementById("cfg-pix-key").value.trim(),
      p_pix_key_type: document.getElementById("cfg-pix-type").value.trim(),
    });

    const msg = document.getElementById("save-msg");
    if (error) {
      msg.style.color = "var(--danger)";
      msg.textContent = "Chave de organizador inválida ou erro ao salvar.";
    } else {
      msg.style.color = "var(--ok)";
      msg.textContent = "Salvo!";
      setTimeout(() => renderAdmin(), 600);
    }
  });

  const drawBtn = document.getElementById("draw-btn");
  if (drawBtn) {
    drawBtn.addEventListener("click", async () => {
      if (!confirm("Sortear agora? Isso não pode ser desfeito.")) return;
      drawBtn.disabled = true;
      drawBtn.textContent = "Sorteando…";
      const { error } = await sb.rpc("admin_draw_winner", { p_admin_key: adminKey });
      if (error) {
        alert("Erro: " + error.message);
        drawBtn.disabled = false;
        drawBtn.textContent = "Sortear agora";
        return;
      }
      renderAdmin();
    });
  }
}

route();
