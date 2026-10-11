// Gravata Digital -- app de pagina unica, sem build step.
// Visao do convidado (padrao) + visao do organizador (#admin, protegida por
// uma chave). Varios sorteios por evento, rodando em SEQUENCIA -- so um fica
// "active" por vez (garantido por indice unico parcial no banco); o
// convidado sempre ve o sorteio ativo agora, nunca uma lista pra escolher.

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
  div.textContent = s == null ? "" : String(s);
  return div.innerHTML;
}

const tieSvg = `<svg class="tie-hero" viewBox="0 0 24 38" fill="none" xmlns="http://www.w3.org/2000/svg">
  <defs><linearGradient id="tieSheen" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="#F6F5F1"/><stop offset=".5" stop-color="#C3C6CA"/><stop offset="1" stop-color="#6E7175"/>
  </linearGradient></defs>
  <path d="M12 0 L17 7 L14.5 12 L12 10.5 L9.5 12 L7 7 Z" fill="url(#tieSheen)"/>
  <path d="M14.5 12 L17 28 L12 37 L7 28 L9.5 12 Z" fill="url(#tieSheen)" opacity=".9"/>
</svg>`;

function markHtml() {
  return `<div class="mark"><div class="word"><b>Gravata</b><span>Digital</span></div></div>`;
}

// ---------------------------------------------------------------------------
// Roteamento
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
async function loadSiteSettings() {
  const { data, error } = await sb.from("site_settings").select("*").eq("id", 1).single();
  if (error) throw error;
  return data;
}

async function loadRaffles() {
  const { data, error } = await sb.from("raffles").select("*").order("position");
  if (error) throw error;
  return data;
}

async function loadNumbers(raffleId) {
  const { data, error } = await sb
    .from("raffle_numbers")
    .select("number, reservation_id")
    .eq("raffle_id", raffleId)
    .order("number");
  if (error) throw error;
  return data;
}

async function loadReservations(raffleId) {
  const { data, error } = await sb
    .from("reservations")
    .select("id, guest_name, total_price, created_at")
    .eq("raffle_id", raffleId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data;
}

async function loadWinnerGuestName(raffleId, winnerNumber) {
  const { data, error } = await sb
    .from("raffle_numbers")
    .select("reservations(guest_name)")
    .eq("raffle_id", raffleId)
    .eq("number", winnerNumber)
    .single();
  if (error || !data?.reservations) return null;
  return data.reservations.guest_name;
}

function formatEventDate(dateStr) {
  if (!dateStr) return "";
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("pt-BR", { day: "numeric", month: "long", year: "numeric" });
}

// ===========================================================================
// VISAO DO CONVIDADO
// ===========================================================================
let guestState = {
  settings: null,
  raffles: [],
  numbers: [],
  selectedTier: null,
  selected: new Set(),
  nameDraft: "",
  submitting: false,
  error: null,
  result: null,
};

async function renderGuest() {
  app.innerHTML = `<p style="padding-top:60px;text-align:center;color:var(--pewter)">Carregando…</p>`;
  try {
    const [settings, raffles] = await Promise.all([loadSiteSettings(), loadRaffles()]);
    guestState.settings = settings;
    guestState.raffles = raffles;
    const active = raffles.find((r) => r.status === "active");
    guestState.numbers = active ? await loadNumbers(active.id) : [];
  } catch (err) {
    app.innerHTML = `<p style="padding-top:60px;text-align:center;color:#e59a9a">Não consegui carregar. Atualize a página.</p>`;
    console.error(err);
    return;
  }
  paintGuest();
  subscribeRealtime();
}

let rafflesChannel = null;
let numbersChannel = null;
function subscribeRealtime() {
  if (!rafflesChannel) {
    rafflesChannel = sb
      .channel("raffles_changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "raffles" }, async () => {
        guestState.raffles = await loadRaffles();
        const active = guestState.raffles.find((r) => r.status === "active");
        guestState.numbers = active ? await loadNumbers(active.id) : [];
        guestState.selectedTier = null;
        guestState.selected = new Set();
        guestState.result = null;
        if (!location.hash.startsWith("#admin")) paintGuest();
      })
      .subscribe();
  }
  if (!numbersChannel) {
    numbersChannel = sb
      .channel("raffle_numbers_changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "raffle_numbers" }, async () => {
        const active = guestState.raffles.find((r) => r.status === "active");
        if (!active) return;
        guestState.numbers = await loadNumbers(active.id);
        if (!location.hash.startsWith("#admin")) paintGuest();
      })
      .subscribe();
  }
}

function paintGuest() {
  const { settings, raffles, result } = guestState;
  const active = raffles.find((r) => r.status === "active");

  if (result) {
    paintConfirmation(active);
    return;
  }

  if (active) {
    paintActiveRaffle(active);
    return;
  }

  paintWaitingOrWinner();
}

function heroHtml() {
  const { settings } = guestState;
  return `
    <div class="hero">
      ${markHtml()}
      ${tieSvg}
      <h1>${escapeHtml(settings.event_name)}</h1>
      ${settings.event_date ? `<p class="date">${escapeHtml(formatEventDate(settings.event_date))}</p>` : ""}
      <p class="sub">Cada doação concorre a um número da sorte. Os prêmios são sorteados em sequência, ao vivo.</p>
    </div>
  `;
}

function paintWaitingOrWinner() {
  const { raffles } = guestState;
  const drawn = raffles.filter((r) => r.status === "drawn").sort((a, b) => new Date(b.drawn_at) - new Date(a.drawn_at));
  const upcoming = raffles.filter((r) => r.status === "draft").sort((a, b) => a.position - b.position);
  const lastWinner = drawn[0];

  app.innerHTML = `
    ${heroHtml()}
    <div class="wrap">
      ${
        lastWinner
          ? `<div class="winner-banner" id="winner-banner">
               <p style="margin:0 0 6px">${escapeHtml(lastWinner.prize_description)} -- número sorteado</p>
               <div class="winner-num">${lastWinner.winner_number}</div>
             </div>`
          : `<p style="text-align:center;color:var(--pewter);margin-top:30px">Nenhum sorteio aberto no momento. Fica de olho!</p>`
      }
      ${
        upcoming.length > 0
          ? `<div class="section">
               <h3 class="grid-head" style="font-family:var(--body);font-weight:600;font-size:0.9rem;margin-bottom:4px">A seguir</h3>
               <div class="upcoming-list">
                 ${upcoming
                   .map(
                     (r, i) =>
                       `<div class="upcoming-row"><span class="ord">${i + 1}.</span><span class="name">${escapeHtml(r.prize_description)}</span></div>`
                   )
                   .join("")}
               </div>
             </div>`
          : ""
      }
      <footer class="foot">gravata digital · <a href="#admin">organizador</a></footer>
    </div>
  `;

  if (lastWinner) {
    loadWinnerGuestName(lastWinner.id, lastWinner.winner_number).then((name) => {
      if (!name) return;
      const banner = document.getElementById("winner-banner");
      if (banner) banner.insertAdjacentHTML("beforeend", `<p style="margin:10px 0 0;font-weight:600">${escapeHtml(name)}</p>`);
    });
  }
}

function paintActiveRaffle(raffle) {
  const { numbers } = guestState;
  const tiers = raffle.pricing_tiers || [];
  const takenCount = numbers.filter((n) => n.reservation_id).length;

  app.innerHTML = `
    ${heroHtml()}
    <div class="wrap">
      <div class="status-row" style="margin-top:0"><span class="dot live"></span><span>sorteio ao vivo agora</span></div>

      <div class="prize satin-edge" style="padding-top:18px">
        <h2>${escapeHtml(raffle.prize_description)}</h2>
        ${raffle.prize_image_url ? `<img src="${escapeHtml(raffle.prize_image_url)}" alt="" />` : ""}
        <div class="tiers" id="tiers" style="margin-top:18px"></div>
      </div>

      <div class="section satin-edge" id="grid-section" ${guestState.selectedTier ? "" : "hidden"}>
        <div class="grid-head">
          <h3>Escolha seus números</h3>
          <span class="count">${takenCount}/${numbers.length} já doados</span>
        </div>
        <div class="num-grid" id="num-grid"></div>
        <div class="legend">
          <span><i class="i-free"></i>livre</span>
          <span><i class="i-sel"></i>seu</span>
          <span><i class="i-taken"></i>já doado</span>
        </div>
      </div>

      <div class="checkout satin-edge" id="checkout-section" ${guestState.selectedTier ? "" : "hidden"}>
        <div class="checkout-total">
          <span class="label">total da doação</span>
          <span class="amt">${guestState.selectedTier ? money(guestState.selectedTier.price) : money(0)}</span>
        </div>
        <input type="text" id="guest-name" placeholder="Seu nome" value="${escapeHtml(guestState.nameDraft || "")}" />
        ${guestState.error ? `<p class="error-msg">${escapeHtml(guestState.error)}</p>` : ""}
        <button class="btn-primary" id="confirm-btn" ${guestState.submitting ? "disabled" : ""}>
          ${guestState.submitting ? "Confirmando…" : "Confirmar doação"}
        </button>
      </div>

      <footer class="foot">gravata digital · <a href="#admin">organizador</a></footer>
    </div>
  `;

  const tiersEl = document.getElementById("tiers");
  tiersEl.innerHTML = tiers
    .map(
      (t, i) =>
        `<button type="button" class="tier ${guestState.selectedTier === t ? "chosen" : ""}" data-idx="${i}">
          <div class="amt">${money(t.price)}</div>
          <span class="qty">${t.quantity} número${t.quantity > 1 ? "s" : ""}</span>
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

  if (!guestState.selectedTier) return;

  const gridEl = document.getElementById("num-grid");
  gridEl.innerHTML = numbers
    .map((n) => {
      const taken = Boolean(n.reservation_id);
      const selected = guestState.selected.has(n.number);
      const cls = taken ? "taken" : selected ? "selected" : "";
      return `<button type="button" class="num ${cls}" data-n="${n.number}" ${taken ? "disabled" : ""}>${String(n.number).padStart(2, "0")}</button>`;
    })
    .join("");

  const needed = guestState.selectedTier.quantity;
  gridEl.querySelectorAll(".num:not(.taken)").forEach((btn) => {
    btn.addEventListener("click", () => {
      const n = Number(btn.dataset.n);
      if (guestState.selected.has(n)) {
        guestState.selected.delete(n);
      } else if (guestState.selected.size < needed) {
        guestState.selected.add(n);
      }
      paintGuest();
    });
  });

  const confirmBtn = document.getElementById("confirm-btn");
  const isReady = () => guestState.selected.size === needed && (guestState.nameDraft || "").trim().length > 0;

  const nameInput = document.getElementById("guest-name");
  nameInput.addEventListener("input", (e) => {
    guestState.nameDraft = e.target.value;
    confirmBtn.disabled = guestState.submitting || !isReady();
  });

  confirmBtn.disabled = guestState.submitting || !isReady();
  confirmBtn.addEventListener("click", () => submitClaim(raffle));
}

async function submitClaim(raffle) {
  const name = (guestState.nameDraft || "").trim();
  if (!name) return;

  guestState.submitting = true;
  guestState.error = null;
  paintGuest();

  const numbersArr = Array.from(guestState.selected);
  const total = guestState.selectedTier.price;

  const { data, error } = await sb.rpc("claim_numbers", {
    p_raffle_id: raffle.id,
    p_guest_name: name,
    p_numbers: numbersArr,
    p_total_price: total,
  });

  guestState.submitting = false;

  if (error) {
    guestState.error = error.message.includes("ja foram escolhidos")
      ? "Algum desses números já foi escolhido por outra pessoa agora há pouco. Escolha outro(s)."
      : error.message.includes("nao esta ativo")
        ? "Esse sorteio não está mais ativo."
        : "Não consegui confirmar. Tente de novo.";
    guestState.numbers = await loadNumbers(raffle.id);
    paintGuest();
    return;
  }

  guestState.result = { raffleId: raffle.id, prize: raffle.prize_description, numbers: numbersArr, total, reservationId: data, guestName: name };
  paintGuest();
}

function paintConfirmation(activeRaffleMaybeGone) {
  const { settings, result } = guestState;
  const pixReady = Boolean(settings.pix_key);

  const payload = pixReady
    ? buildPixPayload({
        pixKey: settings.pix_key,
        amount: result.total,
        merchantName: settings.event_name,
        merchantCity: "BRASIL",
        txid: result.reservationId.replace(/-/g, "").slice(0, 25),
      })
    : null;

  app.innerHTML = `
    ${heroHtml()}
    <div class="wrap">
      <div class="confirm">
        <div class="ring">✓</div>
        <h2>Doação recebida, obrigado!</h2>
        <p class="msg">${escapeHtml(result.guestName)}, seus números já estão guardados. Boa sorte em "${escapeHtml(result.prize)}".</p>
        <p class="nums-label">seus números da sorte</p>
        <div class="confirm-numbers">${result.numbers.map((n) => `<span class="n">${String(n).padStart(2, "0")}</span>`).join("")}</div>
        ${
          pixReady
            ? `<div class="satin-edge"><div style="padding-top:20px"><div class="pix-box">
                 <div id="pix-qr"></div>
                 <div class="pix-code" id="pix-copy-text">${escapeHtml(payload)}</div>
                 <button class="btn-copy" id="copy-pix">Copiar código pix</button>
               </div>
               <p class="pix-hint">Pague ${money(result.total)} via Pix com o código acima. Guarde esta tela até o sorteio.</p></div></div>`
            : `<p class="pix-hint">Pague ${money(result.total)} via Pix diretamente com o casal.</p>`
        }
      </div>
      <footer class="foot">gravata digital</footer>
    </div>
  `;

  if (pixReady) {
    new QRCode(document.getElementById("pix-qr"), {
      text: payload,
      width: 180,
      height: 180,
      colorDark: "#000000",
      colorLight: "#ffffff",
    });
    document.getElementById("copy-pix").addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(payload);
        document.getElementById("copy-pix").textContent = "Copiado!";
      } catch {
        // clipboard pode falhar em alguns navegadores -- o texto ja esta visivel pra copiar manualmente
      }
    });
  }
}

// ===========================================================================
// VISAO DO ORGANIZADOR (#admin)
// ===========================================================================
let adminKey = sessionStorage.getItem("gravata_admin_key") || "";
let editingRaffleId = null; // null = nao editando; "new" = criando; ou o id de um sorteio existente

async function renderAdmin() {
  if (!adminKey) {
    app.innerHTML = `
      ${markHtml()}
      <div class="admin-header"><h1>Painel do organizador</h1></div>
      <label>Chave de organizador</label>
      <input type="text" id="admin-key-input" placeholder="Cole a chave aqui" />
      <button class="btn-primary" id="admin-login" style="margin-top:10px">Entrar</button>
    `;
    document.getElementById("admin-login").addEventListener("click", () => {
      const v = document.getElementById("admin-key-input").value.trim();
      if (!v) return;
      adminKey = v;
      sessionStorage.setItem("gravata_admin_key", v);
      renderAdmin();
    });
    return;
  }

  app.innerHTML = `<p style="padding-top:40px;text-align:center;color:var(--pewter)">Carregando…</p>`;
  let settings, raffles;
  try {
    [settings, raffles] = await Promise.all([loadSiteSettings(), loadRaffles()]);
  } catch (err) {
    app.innerHTML = `<p style="padding-top:40px;text-align:center;color:#e59a9a">Erro ao carregar.</p>`;
    console.error(err);
    return;
  }

  if (editingRaffleId !== null) {
    await renderRaffleEditor(settings, raffles, editingRaffleId);
    return;
  }

  app.innerHTML = `
    ${markHtml()}
    <div class="admin-header"><h1>Painel do organizador</h1></div>

    <label>Nome do evento</label>
    <input type="text" id="cfg-event-name" value="${escapeHtml(settings.event_name)}" />
    <label>Data (opcional)</label>
    <input type="text" id="cfg-event-date" value="${escapeHtml(settings.event_date || "")}" placeholder="AAAA-MM-DD" />
    <label>Chave Pix</label>
    <input type="text" id="cfg-pix-key" value="${escapeHtml(settings.pix_key || "")}" placeholder="CPF, celular, e-mail ou chave aleatória" />
    <label>Tipo de chave</label>
    <input type="text" id="cfg-pix-type" value="${escapeHtml(settings.pix_key_type || "")}" placeholder="ex: celular" />
    <button class="btn-primary" id="save-settings" style="margin-top:14px">Salvar evento</button>
    <p id="settings-msg" style="font-size:0.85rem;margin-top:8px"></p>

    <h2 class="grid-head" style="font-family:var(--display);font-style:italic;font-size:1.3rem;margin-top:30px">Sorteios</h2>
    <button class="btn-primary" id="new-raffle" style="margin:12px 0 20px">+ novo sorteio</button>

    <div id="raffles-list"></div>

    <footer class="foot" style="text-align:left"><a href="#">← voltar pra tela do convidado</a></footer>
  `;

  document.getElementById("save-settings").addEventListener("click", async () => {
    const { error } = await sb.rpc("admin_update_site_settings", {
      p_admin_key: adminKey,
      p_event_name: document.getElementById("cfg-event-name").value.trim(),
      p_event_date: document.getElementById("cfg-event-date").value.trim() || null,
      p_pix_key: document.getElementById("cfg-pix-key").value.trim(),
      p_pix_key_type: document.getElementById("cfg-pix-type").value.trim(),
    });
    const msg = document.getElementById("settings-msg");
    if (error) {
      msg.style.color = "#e59a9a";
      msg.textContent = "Chave de organizador inválida ou erro ao salvar.";
    } else {
      msg.style.color = "#8fbf8f";
      msg.textContent = "Salvo!";
      setTimeout(() => renderAdmin(), 500);
    }
  });

  document.getElementById("new-raffle").addEventListener("click", () => {
    editingRaffleId = "new";
    renderAdmin();
  });

  const listEl = document.getElementById("raffles-list");
  if (raffles.length === 0) {
    listEl.innerHTML = `<p style="color:var(--pewter)">Nenhum sorteio cadastrado ainda.</p>`;
  } else {
    listEl.innerHTML = raffles
      .map((r) => {
        const badgeClass = r.status === "active" ? "active" : r.status === "drawn" ? "drawn" : "";
        const badgeText = r.status === "active" ? "ao vivo" : r.status === "drawn" ? "encerrado" : "agendado";
        return `
          <div class="raffle-card" data-id="${r.id}">
            <div class="top">
              <h3>${escapeHtml(r.prize_description)}</h3>
              <span class="raffle-badge ${badgeClass}">${badgeText}</span>
            </div>
            <div class="raffle-actions">
              <button type="button" class="btn-small-outline edit-raffle">editar</button>
              ${r.status === "draft" ? `<button type="button" class="btn-small-primary activate-raffle">ativar</button>` : ""}
              ${r.status === "active" ? `<button type="button" class="btn-small-primary draw-raffle">sortear</button>` : ""}
              ${r.status === "drawn" ? `<span style="color:var(--pewter);font-size:0.82rem;align-self:center">número ${r.winner_number}</span>` : ""}
            </div>
          </div>
        `;
      })
      .join("");

    listEl.querySelectorAll(".edit-raffle").forEach((btn) => {
      btn.addEventListener("click", () => {
        editingRaffleId = btn.closest(".raffle-card").dataset.id;
        renderAdmin();
      });
    });
    listEl.querySelectorAll(".activate-raffle").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.closest(".raffle-card").dataset.id;
        const { error } = await sb.rpc("admin_set_active_raffle", { p_admin_key: adminKey, p_raffle_id: id });
        if (error) { alert("Erro: " + error.message); return; }
        renderAdmin();
      });
    });
    listEl.querySelectorAll(".draw-raffle").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (!confirm("Sortear agora? Isso não pode ser desfeito.")) return;
        const id = btn.closest(".raffle-card").dataset.id;
        const { error } = await sb.rpc("admin_draw_winner", { p_admin_key: adminKey, p_raffle_id: id });
        if (error) { alert("Erro: " + error.message); return; }
        renderAdmin();
      });
    });
  }
}

async function renderRaffleEditor(settings, raffles, id) {
  const isNew = id === "new";
  const raffle = isNew ? null : raffles.find((r) => r.id === id);
  if (!isNew && !raffle) {
    editingRaffleId = null;
    renderAdmin();
    return;
  }

  const [reservations, numbers] = !isNew
    ? await Promise.all([loadReservations(raffle.id), loadNumbers(raffle.id)])
    : [[], []];

  const tiers = (raffle?.pricing_tiers || []).map((t) => ({ ...t }));
  const arrecadado = reservations.reduce((sum, r) => sum + Number(r.total_price), 0);
  const taken = numbers.filter((n) => n.reservation_id).length;

  app.innerHTML = `
    ${markHtml()}
    <div class="admin-header"><h1>${isNew ? "Novo sorteio" : "Editar sorteio"}</h1></div>

    ${
      !isNew
        ? `<div class="card" style="margin-bottom:10px">
             <div class="stat-row"><span>Arrecadado</span><span class="v">${money(arrecadado)}</span></div>
             <div class="stat-row"><span>Números escolhidos</span><span class="v">${taken}/${numbers.length}</span></div>
             <div class="stat-row"><span>Doações</span><span class="v">${reservations.length}</span></div>
           </div>`
        : ""
    }

    <label>O que será sorteado</label>
    <input type="text" id="r-prize" value="${escapeHtml(raffle?.prize_description || "")}" placeholder="ex: Gravata do noivo" />

    <label>Imagem (opcional)</label>
    <input type="file" id="r-image-file" accept="image/*" />
    <input type="hidden" id="r-image-url" value="${escapeHtml(raffle?.prize_image_url || "")}" />
    <div id="r-image-preview" style="margin-top:8px">${raffle?.prize_image_url ? `<img src="${escapeHtml(raffle.prize_image_url)}" style="max-width:100%;max-height:160px" />` : ""}</div>

    ${
      isNew
        ? `<label>Quantidade de números (ex: 100 = de 1 a 100)</label><input type="number" id="r-max-number" value="100" min="1" />`
        : ""
    }

    <label>Posição (ordem de exibição)</label>
    <input type="number" id="r-position" value="${raffle?.position ?? raffles.length + 1}" min="1" />

    <label>Pacotes (número de doações e preço)</label>
    <div id="tier-rows"></div>
    <button type="button" class="btn-ghost" id="add-tier">+ adicionar pacote</button>

    <button class="btn-primary" id="save-raffle" style="margin-top:16px">${isNew ? "Criar sorteio" : "Salvar alterações"}</button>
    <p id="raffle-msg" style="font-size:0.85rem;margin-top:8px"></p>

    ${
      !isNew && reservations.length > 0
        ? `<h2 class="grid-head" style="font-family:var(--display);font-style:italic;font-size:1.1rem;margin-top:24px">Quem já doou</h2>
           <div>${reservations.map((r) => `<div class="reservation-row"><span>${escapeHtml(r.guest_name)}</span><span>${money(Number(r.total_price))}</span></div>`).join("")}</div>`
        : ""
    }

    <button type="button" class="btn-ghost" id="back-to-list" style="margin-top:20px">← voltar pra lista de sorteios</button>
  `;

  function renderTierRows(list) {
    const el = document.getElementById("tier-rows");
    el.innerHTML = list
      .map(
        (t, i) => `
        <div class="tier-row" data-i="${i}">
          <input type="number" min="1" class="t-qty" value="${t.quantity}" placeholder="qtd" />
          <input type="number" min="0" step="0.01" class="t-price" value="${t.price}" placeholder="preço" />
          <button type="button" class="btn-ghost t-remove">remover</button>
        </div>`
      )
      .join("");
    el.querySelectorAll(".t-remove").forEach((btn) => {
      btn.addEventListener("click", () => {
        currentTiers.splice(Number(btn.closest(".tier-row").dataset.i), 1);
        renderTierRows(currentTiers);
      });
    });
  }

  let currentTiers = tiers.length ? tiers : [{ quantity: 1, price: 10 }];
  renderTierRows(currentTiers);

  document.getElementById("add-tier").addEventListener("click", () => {
    currentTiers.push({ quantity: 1, price: 0 });
    renderTierRows(currentTiers);
  });

  document.getElementById("back-to-list").addEventListener("click", () => {
    editingRaffleId = null;
    renderAdmin();
  });

  document.getElementById("r-image-file").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const msg = document.getElementById("raffle-msg");
    msg.style.color = "var(--pewter)";
    msg.textContent = "Enviando imagem…";
    const ext = file.name.split(".").pop();
    const path = `${crypto.randomUUID()}.${ext}`;
    const { error } = await sb.storage.from("prize-images").upload(path, file);
    if (error) {
      msg.style.color = "#e59a9a";
      msg.textContent = "Falha ao enviar imagem: " + error.message;
      return;
    }
    const { data } = sb.storage.from("prize-images").getPublicUrl(path);
    document.getElementById("r-image-url").value = data.publicUrl;
    document.getElementById("r-image-preview").innerHTML = `<img src="${escapeHtml(data.publicUrl)}" style="max-width:100%;max-height:160px" />`;
    msg.textContent = "Imagem enviada!";
  });

  document.getElementById("save-raffle").addEventListener("click", async () => {
    const rows = document.querySelectorAll(".tier-row");
    const newTiers = Array.from(rows)
      .map((row) => ({
        quantity: Number(row.querySelector(".t-qty").value),
        price: Number(row.querySelector(".t-price").value),
      }))
      .filter((t) => t.quantity > 0 && t.price >= 0)
      .sort((a, b) => a.quantity - b.quantity);

    const prizeDescription = document.getElementById("r-prize").value.trim();
    const prizeImageUrl = document.getElementById("r-image-url").value.trim();
    const position = Number(document.getElementById("r-position").value) || 1;
    const msg = document.getElementById("raffle-msg");

    if (!prizeDescription) {
      msg.style.color = "#e59a9a";
      msg.textContent = "Descreve o que vai ser sorteado.";
      return;
    }

    let error;
    if (isNew) {
      const maxNumber = Number(document.getElementById("r-max-number").value) || 100;
      ({ error } = await sb.rpc("admin_create_raffle", {
        p_admin_key: adminKey,
        p_prize_description: prizeDescription,
        p_prize_image_url: prizeImageUrl,
        p_pricing_tiers: newTiers,
        p_max_number: maxNumber,
        p_position: position,
      }));
    } else {
      ({ error } = await sb.rpc("admin_update_raffle", {
        p_admin_key: adminKey,
        p_raffle_id: raffle.id,
        p_prize_description: prizeDescription,
        p_prize_image_url: prizeImageUrl,
        p_pricing_tiers: newTiers,
        p_position: position,
      }));
    }

    if (error) {
      msg.style.color = "#e59a9a";
      msg.textContent = "Erro: " + error.message;
    } else {
      editingRaffleId = null;
      renderAdmin();
    }
  });
}

route();
