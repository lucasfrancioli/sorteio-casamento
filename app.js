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

function markHtml() {
  return `<div class="mark"><div class="word"><b>Gravata</b><span>Digital</span></div></div>`;
}

// ---------------------------------------------------------------------------
// Roteamento
// ---------------------------------------------------------------------------
function route() {
  document.body.classList.toggle("admin", location.hash.startsWith("#admin"));
  if (location.hash.startsWith("#admin")) {
    document.body.classList.remove("intro-active");
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
    .select("number, reservation_id, reservations(guest_name)")
    .eq("raffle_id", raffleId)
    .order("number");
  if (error) throw error;
  return data;
}

async function loadRaffleItems(raffleId) {
  const { data, error } = await sb.from("raffle_items").select("*").eq("raffle_id", raffleId).order("position");
  if (error) throw error;
  return data;
}

async function loadAllRaffleItems() {
  const { data, error } = await sb.from("raffle_items").select("*").order("position");
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
  allItems: [],
  numbers: [],
  selectedTier: null,
  selected: new Set(),
  nameDraft: "",
  submitting: false,
  error: null,
  result: null,
  introDismissedFor: null,
};

async function renderGuest() {
  app.innerHTML = `<p style="padding-top:60px;text-align:center;color:var(--ink-soft)">Carregando…</p>`;
  try {
    const [settings, raffles, allItems] = await Promise.all([loadSiteSettings(), loadRaffles(), loadAllRaffleItems()]);
    guestState.settings = settings;
    guestState.raffles = raffles;
    guestState.allItems = allItems;
    const active = raffles.find((r) => r.status === "active");
    guestState.numbers = active ? await loadNumbers(active.id) : [];
  } catch (err) {
    app.innerHTML = `<p style="padding-top:60px;text-align:center;color:#9B3A3A">Não consegui carregar. Atualize a página.</p>`;
    console.error(err);
    return;
  }
  paintGuest();
  subscribeRealtime();
}

function itemsForRaffle(raffleId) {
  return (guestState.allItems || []).filter((i) => i.raffle_id === raffleId).sort((a, b) => a.position - b.position);
}

let rafflesChannel = null;
let numbersChannel = null;
let itemsChannel = null;
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
  if (!itemsChannel) {
    itemsChannel = sb
      .channel("raffle_items_changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "raffle_items" }, async () => {
        guestState.allItems = await loadAllRaffleItems();
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
    if (guestState.introDismissedFor !== active.id) {
      paintIntro(active);
      return;
    }
    paintActiveRaffle(active);
    return;
  }

  paintWaitingOrWinner();
}

function paintIntro(raffle) {
  document.body.classList.add("intro-active");
  app.innerHTML = `
    <div style="padding-top:28px">${markHtml()}</div>
    <div class="intro-screen">
      <div class="intro-card">
        <h1>Garanta seu pedaço ✂️</h1>
        <button type="button" class="btn-primary" id="intro-choose">Escolher valor</button>
      </div>
    </div>
  `;
  document.getElementById("intro-choose").addEventListener("click", () => {
    guestState.introDismissedFor = raffle.id;
    paintGuest();
  });
}

function heroHtml() {
  const { settings } = guestState;
  return `
    <div class="hero">
      ${markHtml()}
      <h1>${escapeHtml(settings.event_name)}</h1>
      ${settings.event_date ? `<p class="date">${escapeHtml(formatEventDate(settings.event_date))}</p>` : ""}
      <p class="sub">Cada doação concorre a um número da sorte. Os prêmios são sorteados em sequência, ao vivo.</p>
    </div>
    <div class="tie-ribbon"></div>
  `;
}

function howToHtml() {
  return `
    <div class="section howto">
      <div class="howto-row">
        <span class="howto-num">1</span>
        <p class="howto-text"><b>Escolha um pacote</b> e os números da sorte que você quer.</p>
      </div>
      <div class="howto-row">
        <span class="howto-num">2</span>
        <p class="howto-text"><b>Pague a doação via Pix</b> com o QR Code gerado na hora, no valor exato.</p>
      </div>
      <div class="howto-row">
        <span class="howto-num">3</span>
        <p class="howto-text"><b>Guarde a tela.</b> No sorteio ao vivo, seu nome e número aparecem se você ganhar.</p>
      </div>
    </div>
  `;
}

function paintWaitingOrWinner() {
  document.body.classList.remove("intro-active");
  const { raffles } = guestState;
  const drawn = raffles.filter((r) => r.status === "drawn").sort((a, b) => new Date(b.drawn_at) - new Date(a.drawn_at));
  const upcoming = raffles.filter((r) => r.status === "draft").sort((a, b) => a.position - b.position);
  const lastWinner = drawn[0];
  const lastWinnerItems = lastWinner ? itemsForRaffle(lastWinner.id) : [];

  app.innerHTML = `
    ${heroHtml()}
    <div class="wrap">
      ${
        lastWinner
          ? `<div class="winner-banner" id="winner-banner">
               ${lastWinnerItems
                 .map(
                   (it) => `
                 <div style="margin-bottom:14px" data-item-id="${it.id}">
                   <p style="margin:0 0 6px">${escapeHtml(it.description)} -- número sorteado</p>
                   <div class="winner-num">${String(it.winner_number).padStart(2, "0")}</div>
                 </div>`
                 )
                 .join("")}
             </div>`
          : `<p style="text-align:center;color:var(--ink-soft);margin-top:30px">Nenhum sorteio aberto no momento. Fica de olho!</p>`
      }
      ${
        upcoming.length > 0
          ? `<div class="section">
               <h3 class="grid-head" style="font-family:var(--body);font-weight:600;font-size:0.9rem;margin-bottom:4px">A seguir</h3>
               <div class="upcoming-list">
                 ${upcoming
                   .map((r, i) => {
                     const label = itemsForRaffle(r.id).map((it) => it.description).join(", ") || "a definir";
                     return `<div class="upcoming-row"><span class="ord">${i + 1}.</span><span class="name">${escapeHtml(label)}</span></div>`;
                   })
                   .join("")}
               </div>
             </div>`
          : ""
      }
      ${howToHtml()}
      <footer class="foot">gravata digital · <a href="#admin">organizador</a></footer>
    </div>
  `;

  lastWinnerItems.forEach((it) => {
    loadWinnerGuestName(lastWinner.id, it.winner_number).then((name) => {
      if (!name) return;
      const container = document.querySelector(`#winner-banner [data-item-id="${it.id}"]`);
      if (container) container.insertAdjacentHTML("beforeend", `<p style="margin:10px 0 0;font-weight:600">${escapeHtml(name)}</p>`);
    });
  });
}

function paintActiveRaffle(raffle) {
  document.body.classList.remove("intro-active");
  const { numbers } = guestState;
  const tiers = raffle.pricing_tiers || [];
  const takenCount = numbers.filter((n) => n.reservation_id).length;
  const items = itemsForRaffle(raffle.id);

  app.innerHTML = `
    <div style="padding-top:28px">${markHtml()}</div>
    <div class="wrap">
      <div class="hairline" style="margin:18px 0"></div>
      <div class="prize">
        <h2>Sorteio do dia</h2>
        <div class="items-list">
          ${items
            .map((it) => {
              const drawn = Boolean(it.winner_number);
              return `
              <div class="item-card">
                ${it.image_url ? `<img src="${escapeHtml(it.image_url)}" alt="" />` : ""}
                <p class="item-desc">${escapeHtml(it.description)}</p>
                ${
                  drawn
                    ? `<p class="item-status won" data-item-id="${it.id}">já sorteado — número <span class="winner-num-inline">${String(it.winner_number).padStart(2, "0")}</span></p>`
                    : ""
                }
              </div>`;
            })
            .join("")}
        </div>
        <div class="hairline" style="margin:22px 0"></div>
        <h2>Escolha um pacote</h2>
        <div class="tiers" id="tiers" style="margin-top:14px"></div>
      </div>

      <div class="hairline" style="margin:0 0 22px"></div>

      ${howToHtml()}

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

  items
    .filter((it) => it.winner_number)
    .forEach((it) => {
      loadWinnerGuestName(raffle.id, it.winner_number).then((name) => {
        if (!name) return;
        const el = app.querySelector(`.item-status[data-item-id="${it.id}"]`);
        if (el) el.insertAdjacentHTML("beforeend", ` · ${escapeHtml(name)}`);
      });
    });

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
      const firstName = taken ? (n.reservations?.guest_name || "").trim().split(" ")[0] : "";
      return `<button type="button" class="num ${cls}" data-n="${n.number}" ${taken ? "disabled" : ""}>
        <span class="n-num">${String(n.number).padStart(2, "0")}</span>
        ${taken && firstName ? `<span class="n-name">${escapeHtml(firstName)}</span>` : ""}
      </button>`;
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

  const prizeLabel = itemsForRaffle(raffle.id).map((it) => it.description).join(" · ") || "Gravata Digital";
  guestState.result = { raffleId: raffle.id, prize: prizeLabel, numbers: numbersArr, total, reservationId: data, guestName: name };
  paintGuest();
}

let tieCutPlayedFor = null;

function tieCutSceneHtml() {
  return `<div class="tiecut-stage">
    <svg id="tcScene" viewBox="0 0 300 420" role="img" aria-label="Uma tesoura corta a ponta da gravata">
      <defs>
        <pattern id="tcStripes" width="16" height="16" patternUnits="userSpaceOnUse" patternTransform="rotate(-40)">
          <rect class="p-base" width="16" height="16"/>
          <rect class="p-stripe" width="16" height="3" opacity=".9"/>
          <rect class="p-stripe" y="8" width="16" height="1" opacity=".5"/>
        </pattern>
        <linearGradient id="tcSteel" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#f4f6f8"/>
          <stop offset=".55" stop-color="#b3bbc5"/>
          <stop offset="1" stop-color="#8e97a3"/>
        </linearGradient>
        <filter id="tcShadow" x="-30%" y="-30%" width="160%" height="160%">
          <feDropShadow dx="0" dy="2" stdDeviation="2" flood-color="#000" flood-opacity=".25"/>
        </filter>
        <path id="tcTieShape" d="M137,78 L163,78 L189,318 L150,364 L111,318 Z"/>
        <clipPath id="tcClipTie"><use href="#tcTieShape"/></clipPath>
        <clipPath id="tcClipTop"><polygon points="0,0 300,0 300,210 0,250"/></clipPath>
        <clipPath id="tcClipBottom"><polygon points="0,250 300,210 300,440 0,440"/></clipPath>
        <g id="tcBladeShape">
          <path class="tc-handle" d="M4,-3 Q20,-1 33,10"/>
          <circle class="tc-handle" cx="42" cy="19" r="11"/>
          <path d="M9,0 L-76,0 C-64,-6 -42,-11 -14,-11 C0,-11 9,-7 9,-3 Z" fill="url(#tcSteel)" stroke="#7d8692" stroke-width=".8"/>
        </g>
      </defs>
      <g id="tcWholeTie">
        <path class="tie-fill" d="M137,78 L163,78 L189,318 L150,364 L111,318 Z"/>
        <path class="tie-shade" d="M150,78 L163,78 L189,318 L150,364 Z"/>
        <path class="tie-line" d="M137,78 L163,78 L189,318 L150,364 L111,318 Z"/>
      </g>
      <g id="tcBottomPiece" clip-path="url(#tcClipBottom)" style="display:none">
        <path class="tie-fill" d="M137,78 L163,78 L189,318 L150,364 L111,318 Z"/>
        <path class="tie-shade" d="M150,78 L163,78 L189,318 L150,364 Z"/>
        <path class="tie-line" d="M137,78 L163,78 L189,318 L150,364 L111,318 Z"/>
      </g>
      <g id="tcTopPiece" clip-path="url(#tcClipTop)" style="display:none">
        <path class="tie-fill" d="M137,78 L163,78 L189,318 L150,364 L111,318 Z"/>
        <path class="tie-shade" d="M150,78 L163,78 L189,318 L150,364 Z"/>
        <path class="tie-line" d="M137,78 L163,78 L189,318 L150,364 L111,318 Z"/>
      </g>
      <line id="tcCutGap" class="tc-gap" clip-path="url(#tcClipTie)" x1="0" y1="0" x2="0" y2="0"/>
      <path class="tc-collar" d="M150,40 L102,20 L120,74 Z"/>
      <path class="tc-collar" d="M150,40 L198,20 L180,74 Z"/>
      <path class="tie-fill" d="M126,38 Q150,32 174,38 L164,82 Q150,87 136,82 Z"/>
      <path class="tie-shade" d="M150,35 Q162,35 174,38 L164,82 Q157,85 150,85 Z"/>
      <path class="tie-line" d="M126,38 Q150,32 174,38 L164,82 Q150,87 136,82 Z"/>
      <g id="tcConfetti"></g>
      <g id="tcScissors" filter="url(#tcShadow)">
        <g id="tcBladeB"><use href="#tcBladeShape" transform="scale(1,-1)"/></g>
        <g id="tcBladeA"><use href="#tcBladeShape"/></g>
        <circle r="3.6" fill="#6b7480" stroke="#e7eaee" stroke-width="1.2"/>
      </g>
    </svg>
    <div class="tiecut-caption" id="tcCaption">
      <h2 id="tcTitle"></h2>
      <p id="tcMsg"></p>
    </div>
    <button class="btn-ghost" id="tcReplay" hidden>Ver de novo</button>
  </div>`;
}

function initTieCut(container, { title, msg, instant, overlay }) {
  if (instant) {
    container.hidden = true;
    return;
  }

  const NS = "http://www.w3.org/2000/svg";
  const $ = (id) => container.querySelector("#" + id);
  const sc = $("tcScissors"), bladeA = $("tcBladeA"), bladeB = $("tcBladeB");
  const whole = $("tcWholeTie"), top = $("tcTopPiece"), bottom = $("tcBottomPiece");
  const gap = $("tcCutGap"), conf = $("tcConfetti");
  const caption = $("tcCaption"), btn = $("tcReplay");
  $("tcTitle").textContent = title;
  $("tcMsg").textContent = msg;

  if (overlay) {
    container.classList.add("tc-overlay");
    document.body.style.overflow = "hidden";
  }
  function closeOverlay() {
    if (!container.classList.contains("tc-overlay")) {
      container.hidden = true;
      return;
    }
    container.classList.add("tc-hide");
    setTimeout(() => {
      container.hidden = true;
      container.classList.remove("tc-overlay", "tc-hide");
      document.body.style.overflow = "";
    }, 400);
  }

  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const ANG = -7.6;
  const cutY = (x) => 238 - (16 / 120) * (x - 90);
  const CUT_R = 186, CUT_L = 114;
  const ENTER = 700, SNIP0 = 800, SNIP = 480, CLOSE = 200, OPEN = 26;
  const XS = [200, 176, 152];
  const T_SPLIT = SNIP0 + 2 * SNIP + CLOSE + 30;
  const T_EXIT = T_SPLIT + 150;
  const T_END = T_SPLIT + 1500;

  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const seg = (t, a, b) => clamp((t - a) / (b - a));
  const easeOut = (t) => 1 - Math.pow(1 - t, 3);
  const easeIn = (t) => t * t * t;
  const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

  const COLORS = ["#7D2235", "#9B3A4A", "#16284A", "#3C5484", "#D8CEB8"];
  let bits = [];
  function makeConfetti() {
    conf.textContent = "";
    bits = [];
    for (let i = 0; i < 36; i++) {
      const round = Math.random() < 0.3;
      const el = document.createElementNS(NS, round ? "circle" : "rect");
      if (round) {
        el.setAttribute("r", 2.5);
      } else {
        const w = 4 + Math.random() * 3, h = 7 + Math.random() * 5;
        el.setAttribute("x", -w / 2);
        el.setAttribute("y", -h / 2);
        el.setAttribute("width", w);
        el.setAttribute("height", h);
        el.setAttribute("rx", 1);
      }
      el.setAttribute("fill", COLORS[i % COLORS.length]);
      el.setAttribute("opacity", 0);
      conf.appendChild(el);
      const x0 = 150 + (Math.random() - 0.5) * 40;
      bits.push({
        el, x0, y0: cutY(x0),
        vx: (Math.random() - 0.5) * 0.38,
        vy: -(0.18 + Math.random() * 0.28),
        spin: (Math.random() - 0.5) * 0.9,
        r0: Math.random() * 360,
        life: 1300 + Math.random() * 500,
      });
    }
  }

  function render(t) {
    let x, a, dy = 0, op = 1;
    if (t < SNIP0) {
      const k = easeOut(seg(t, 0, ENTER));
      x = lerp(400, XS[0], k);
      a = lerp(0, OPEN, k);
    } else if (t < T_EXIT) {
      const i = Math.min(2, Math.floor((t - SNIP0) / SNIP)), lt = t - SNIP0 - i * SNIP;
      if (lt < CLOSE) {
        x = XS[i];
        a = lerp(OPEN, i === 2 ? 0 : 3, easeIn(lt / CLOSE));
      } else if (i < 2) {
        const k = easeInOut(seg(lt, CLOSE, SNIP));
        x = lerp(XS[i], XS[i + 1], k);
        a = lerp(3, OPEN, k);
      } else {
        x = XS[2];
        a = 0;
      }
    } else {
      const k = easeInOut(seg(t, T_EXIT, T_EXIT + 600));
      x = lerp(XS[2], XS[2] + 90, k);
      dy = lerp(0, -80, k);
      a = lerp(0, 18, k);
      op = 1 - k;
    }
    sc.setAttribute("transform", `translate(${x} ${cutY(x) + dy}) rotate(${ANG}) scale(1.15)`);
    sc.setAttribute("opacity", op);
    bladeA.setAttribute("transform", `rotate(${a})`);
    bladeB.setAttribute("transform", `rotate(${-a})`);

    let p = 0;
    if (t >= SNIP0) {
      const i = Math.min(2, Math.floor((t - SNIP0) / SNIP)), lt = t - SNIP0 - i * SNIP;
      p = (i + (lt < CLOSE ? easeIn(lt / CLOSE) : 1)) / 3;
    }
    if (p > 0 && t < T_SPLIT) {
      const x2 = lerp(CUT_R, CUT_L, p);
      gap.setAttribute("x1", CUT_R + 4);
      gap.setAttribute("y1", cutY(CUT_R + 4));
      gap.setAttribute("x2", x2);
      gap.setAttribute("y2", cutY(x2));
      gap.style.display = "";
    } else {
      gap.style.display = "none";
    }

    const split = t >= T_SPLIT;
    whole.style.display = split ? "none" : "";
    top.style.display = bottom.style.display = split ? "" : "none";
    if (split) {
      const k = seg(t, T_SPLIT, T_SPLIT + 1300);
      const ty = 360 * k * k, tx = 14 * k, rot = lerp(0, 26, easeOut(k));
      bottom.setAttribute("transform", `translate(${tx} ${ty}) rotate(${rot} 150 232)`);
      bottom.setAttribute("opacity", 1 - seg(t, T_SPLIT + 900, T_SPLIT + 1300));
      const kk = (t - T_SPLIT) / 1000;
      const swing = -3.5 * Math.exp(-2.8 * kk) * Math.sin(kk * 11);
      top.setAttribute("transform", `rotate(${swing} 150 60)`);
    }

    for (const b of bits) {
      const lt = t - T_SPLIT;
      if (lt < 0 || lt > b.life) {
        b.el.setAttribute("opacity", 0);
        continue;
      }
      const bx = b.x0 + b.vx * lt, by = b.y0 + b.vy * lt + 0.5 * 0.0009 * lt * lt;
      b.el.setAttribute("transform", `translate(${bx} ${by}) rotate(${b.r0 + b.spin * lt})`);
      b.el.setAttribute("opacity", 1 - seg(lt, b.life - 350, b.life));
    }

    caption.classList.toggle("show", t >= T_SPLIT + 400);
  }

  let raf = 0;
  function finish() {
    btn.hidden = false;
    closeOverlay();
  }

  function play() {
    cancelAnimationFrame(raf);
    btn.hidden = true;
    makeConfetti();
    if (reduce) {
      render(T_END);
      finish();
      return;
    }
    const t0 = performance.now();
    const step = (now) => {
      const t = now - t0;
      render(t);
      if (t < T_END) raf = requestAnimationFrame(step);
      else finish();
    };
    raf = requestAnimationFrame(step);
  }

  btn.addEventListener("click", play);

  if (instant || reduce) {
    render(T_END);
    btn.hidden = false;
  } else {
    render(0);
    play();
  }
}

function paintConfirmation(activeRaffleMaybeGone) {
  document.body.classList.remove("intro-active");
  const { settings, result } = guestState;
  const pixReady = Boolean(settings.pix_key);

  const payload = pixReady
    ? buildPixPayload({
        pixKey: normalizePixKey(settings.pix_key, settings.pix_key_type),
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
        ${tieCutSceneHtml()}
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

  initTieCut(document.querySelector(".tiecut-stage"), {
    title: "Pedaço garantido!",
    msg: `${result.guestName}, seus números já estão guardados. Boa sorte em "${result.prize}".`,
    instant: tieCutPlayedFor === result.reservationId,
    overlay: true,
  });
  tieCutPlayedFor = result.reservationId;

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

  app.innerHTML = `<p style="padding-top:40px;text-align:center;color:var(--ink-soft)">Carregando…</p>`;
  let settings, raffles, allItems;
  try {
    [settings, raffles, allItems] = await Promise.all([loadSiteSettings(), loadRaffles(), loadAllRaffleItems()]);
  } catch (err) {
    app.innerHTML = `<p style="padding-top:40px;text-align:center;color:#9B3A3A">Erro ao carregar.</p>`;
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
    <select id="cfg-pix-type">
      <option value="">selecione...</option>
      <option value="celular" ${settings.pix_key_type === "celular" ? "selected" : ""}>Celular</option>
      <option value="cpf" ${settings.pix_key_type === "cpf" ? "selected" : ""}>CPF</option>
      <option value="cnpj" ${settings.pix_key_type === "cnpj" ? "selected" : ""}>CNPJ</option>
      <option value="email" ${settings.pix_key_type === "email" ? "selected" : ""}>E-mail</option>
      <option value="aleatoria" ${settings.pix_key_type === "aleatoria" ? "selected" : ""}>Chave aleatória</option>
    </select>
    <p style="font-size:0.78rem;color:var(--ink-soft);margin-top:4px">Celular: pode digitar com DDD normalmente (ex: 19 99852-3323), o sistema ajusta o formato sozinho.</p>
    <button class="btn-primary" id="save-settings" style="margin-top:14px">Salvar evento</button>
    <p id="settings-msg" style="font-size:0.85rem;margin-top:8px"></p>

    <h2 class="grid-head" style="font-family:var(--display);font-style:italic;font-size:1.3rem;margin-top:30px">Sorteios</h2>
    <button class="btn-primary" id="new-raffle" style="margin:12px 0 20px">+ novo sorteio</button>

    <div id="raffles-list"></div>

    <footer class="foot" style="text-align:left"><a href="#">← voltar pra tela do convidado</a></footer>
  `;

  document.getElementById("save-settings").addEventListener("click", async () => {
    const rawType = document.getElementById("cfg-pix-type").value.trim();
    const rawKey = document.getElementById("cfg-pix-key").value.trim();
    const { error } = await sb.rpc("admin_update_site_settings", {
      p_admin_key: adminKey,
      p_event_name: document.getElementById("cfg-event-name").value.trim(),
      p_event_date: document.getElementById("cfg-event-date").value.trim() || null,
      p_pix_key: normalizePixKey(rawKey, rawType),
      p_pix_key_type: rawType,
    });
    const msg = document.getElementById("settings-msg");
    if (error) {
      msg.style.color = "#9B3A3A";
      msg.textContent = "Chave de organizador inválida ou erro ao salvar.";
    } else {
      msg.style.color = "#2F7D4F";
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
    listEl.innerHTML = `<p style="color:var(--ink-soft)">Nenhum sorteio cadastrado ainda.</p>`;
  } else {
    listEl.innerHTML = raffles
      .map((r) => {
        const badgeClass = r.status === "active" ? "active" : r.status === "drawn" ? "drawn" : "";
        const badgeText = r.status === "active" ? "ao vivo" : r.status === "drawn" ? "encerrado" : "agendado";
        const items = allItems.filter((i) => i.raffle_id === r.id).sort((a, b) => a.position - b.position);
        const titleLabel = items.map((i) => i.description).join(" · ") || "(sem itens)";
        const itemsSummary = items
          .map(
            (i) =>
              `<div style="font-size:0.78rem;color:var(--ink-soft);padding:2px 0">${escapeHtml(i.description)}${i.winner_number ? ` — número ${String(i.winner_number).padStart(2, "0")}` : ""}</div>`
          )
          .join("");
        return `
          <div class="raffle-card" data-id="${r.id}">
            <div class="top">
              <h3>${escapeHtml(titleLabel)}</h3>
              <span class="raffle-badge ${badgeClass}">${badgeText}</span>
            </div>
            ${itemsSummary}
            <div class="raffle-actions">
              <button type="button" class="btn-small-outline edit-raffle">editar</button>
              ${r.status === "draft" ? `<button type="button" class="btn-small-primary activate-raffle">ativar</button>` : ""}
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

  const [reservations, numbers, items] = !isNew
    ? await Promise.all([loadReservations(raffle.id), loadNumbers(raffle.id), loadRaffleItems(raffle.id)])
    : [[], [], []];

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

    <label>Itens a serem sorteados</label>
    <div id="item-rows"></div>
    <button type="button" class="btn-ghost" id="add-item">+ adicionar item</button>

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

  let currentItems = items.length ? items.map((it) => ({ ...it })) : [{ id: null, description: "", image_url: null, winner_number: null }];

  function renderItemRows(list) {
    const el = document.getElementById("item-rows");
    el.innerHTML = list
      .map((it, i) => {
        const drawn = Boolean(it.winner_number);
        return `
        <div class="item-edit-row" data-i="${i}">
          <div class="item-edit-top">
            <strong>Item ${i + 1}</strong>
            <span class="item-edit-status ${drawn ? "won" : ""}">${drawn ? `sorteado — número ${String(it.winner_number).padStart(2, "0")}` : "ainda não sorteado"}</span>
          </div>
          <input type="text" class="it-desc" value="${escapeHtml(it.description || "")}" placeholder="ex: Gravata do noivo" />
          <input type="file" class="it-image-file" accept="image/*" />
          <div class="it-image-preview">${it.image_url ? `<img src="${escapeHtml(it.image_url)}" />` : ""}</div>
          <div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap">
            ${!isNew && it.id && !drawn && raffle.status === "active" ? `<button type="button" class="btn-small-primary it-draw">sortear este item</button>` : ""}
            ${!drawn ? `<button type="button" class="btn-ghost it-remove">remover item</button>` : ""}
          </div>
        </div>`;
      })
      .join("");

    el.querySelectorAll(".it-remove").forEach((btn) => {
      btn.addEventListener("click", () => {
        currentItems.splice(Number(btn.closest(".item-edit-row").dataset.i), 1);
        if (currentItems.length === 0) currentItems.push({ id: null, description: "", image_url: null, winner_number: null });
        renderItemRows(currentItems);
      });
    });

    el.querySelectorAll(".it-image-file").forEach((input) => {
      input.addEventListener("change", async (e) => {
        const i = Number(input.closest(".item-edit-row").dataset.i);
        const file = e.target.files[0];
        if (!file) return;
        const ext = file.name.split(".").pop();
        const path = `${crypto.randomUUID()}.${ext}`;
        const { error } = await sb.storage.from("prize-images").upload(path, file);
        if (error) {
          alert("Falha ao enviar imagem: " + error.message);
          return;
        }
        const { data } = sb.storage.from("prize-images").getPublicUrl(path);
        currentItems[i].image_url = data.publicUrl;
        renderItemRows(currentItems);
      });
    });

    el.querySelectorAll(".it-draw").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (!confirm("Sortear esse item agora? Isso não pode ser desfeito.")) return;
        const i = Number(btn.closest(".item-edit-row").dataset.i);
        const { error } = await sb.rpc("admin_draw_item_winner", {
          p_admin_key: adminKey,
          p_raffle_id: raffle.id,
          p_item_id: currentItems[i].id,
        });
        if (error) {
          alert("Erro: " + error.message);
          return;
        }
        renderAdmin();
      });
    });
  }

  renderItemRows(currentItems);

  document.getElementById("add-item").addEventListener("click", () => {
    currentItems.push({ id: null, description: "", image_url: null, winner_number: null });
    renderItemRows(currentItems);
  });

  document.getElementById("back-to-list").addEventListener("click", () => {
    editingRaffleId = null;
    renderAdmin();
  });

  document.getElementById("save-raffle").addEventListener("click", async () => {
    const itemRows = document.querySelectorAll(".item-edit-row");
    const itemsPayload = Array.from(itemRows)
      .map((row) => {
        const i = Number(row.dataset.i);
        return {
          id: currentItems[i].id || null,
          description: row.querySelector(".it-desc").value.trim(),
          image_url: currentItems[i].image_url || null,
        };
      })
      .filter((it) => it.description);

    const rows = document.querySelectorAll(".tier-row");
    const newTiers = Array.from(rows)
      .map((row) => ({
        quantity: Number(row.querySelector(".t-qty").value),
        price: Number(row.querySelector(".t-price").value),
      }))
      .filter((t) => t.quantity > 0 && t.price >= 0)
      .sort((a, b) => a.quantity - b.quantity);

    const position = Number(document.getElementById("r-position").value) || 1;
    const msg = document.getElementById("raffle-msg");

    if (itemsPayload.length === 0) {
      msg.style.color = "#9B3A3A";
      msg.textContent = "Adicione pelo menos um item a ser sorteado.";
      return;
    }

    let error;
    if (isNew) {
      const maxNumber = Number(document.getElementById("r-max-number").value) || 100;
      ({ error } = await sb.rpc("admin_create_raffle", {
        p_admin_key: adminKey,
        p_items: itemsPayload,
        p_pricing_tiers: newTiers,
        p_max_number: maxNumber,
        p_position: position,
      }));
    } else {
      ({ error } = await sb.rpc("admin_update_raffle", {
        p_admin_key: adminKey,
        p_raffle_id: raffle.id,
        p_items: itemsPayload,
        p_pricing_tiers: newTiers,
        p_position: position,
      }));
    }

    if (error) {
      msg.style.color = "#9B3A3A";
      msg.textContent = "Erro: " + error.message;
    } else {
      editingRaffleId = null;
      renderAdmin();
    }
  });
}

route();
