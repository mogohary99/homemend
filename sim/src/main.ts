/**
 * HomeMend — simulated Alexa+ experience.
 *
 * What is real: the MCP client, the Streamable HTTP transport, the HomeMend server and its state,
 * the MCP Apps views, and the tools/call messages in the inspector.
 * What is simulated: the Alexa+ layer (speech, and the planner that picks a tool for an utterance).
 */
import { McpHost, type WireEvent } from "./mcp-host";
import { plan, remember, type PlannerState } from "./planner";
import { Speech } from "./speech";
import type { CallToolResult } from "@modelcontextprotocol/client";

const params = new URLSearchParams(location.search);
const defaultServer = (() => {
  if (params.get("server")) return params.get("server")!;
  if (location.port === "5173" || location.port === "4173") return "http://localhost:3001/mcp";
  return new URL("/mcp", location.origin).href;
})();
const settings = {
  server: localStorage.getItem("hm.server") ?? defaultServer,
  household: params.get("household") ?? localStorage.getItem("hm.household") ?? `demo-${Math.random().toString(36).slice(2, 7)}`,
  theme: (localStorage.getItem("hm.theme") as "dark" | "light") ?? "dark",
  device: (localStorage.getItem("hm.device") as "show8" | "show15" | "tv") ?? "show8",
  voice: localStorage.getItem("hm.voice") !== "off",
  inspector: localStorage.getItem("hm.inspector") !== "off",
  dayOffset: Number(localStorage.getItem("hm.dayOffset") ?? 0),
};
const save = () => {
  localStorage.setItem("hm.server", settings.server);
  localStorage.setItem("hm.household", settings.household);
  localStorage.setItem("hm.theme", settings.theme);
  localStorage.setItem("hm.device", settings.device);
  localStorage.setItem("hm.voice", settings.voice ? "on" : "off");
  localStorage.setItem("hm.inspector", settings.inspector ? "on" : "off");
  localStorage.setItem("hm.dayOffset", String(settings.dayOffset));
};

save(); // persist the generated household id so a reload resumes the same household
const speech = new Speech();
speech.enabled = settings.voice;
let host: McpHost | undefined;
let state: PlannerState = {};
const wire: WireEvent[] = [];
let busy = false;

// ---------- DOM ----------
const app = document.getElementById("app")!;
app.innerHTML = `
<header class="topbar">
  <div class="brand"><span class="dot"></span> HomeMend <small>· Alexa+ experience (simulated) · real MCP server</small></div>
  <div class="controls">
    <span class="status" id="status"><span class="pill">connecting…</span></span>
    <select id="device" aria-label="Device frame"><option value="show8">Echo Show 8 frame</option><option value="show15">Echo Show 15 frame</option><option value="tv">Fire TV frame</option></select>
    <button class="chip-btn" id="theme">Theme: dark</button>
    <button class="chip-btn" id="voice">Voice: on</button>
    <button class="chip-btn" id="day" title="Demo control: pretend a day has passed so deliveries and follow-ups fire">Advance a day (+0)</button>
    <button class="chip-btn" id="reset" title="Start a fresh household">New household</button>
    <button class="chip-btn" id="demo" title="Play the scripted journey">▶ Guided demo</button>
    <button class="chip-btn" id="insp">Inspector</button>
  </div>
</header>
<main class="stage">
  <div class="device-wrap"><div class="device" id="deviceEl"><div class="screen" id="screen">
    <div class="hud"><div class="time" id="clock">--:--</div><div class="label">Simulated Alexa+ · HomeMend add-on</div></div>
    <div class="convo" id="convo"></div>
    <div class="bar">
      <div class="lightbar" id="lightbar"></div>
      <div class="inputrow">
        <button class="round mic" id="mic" aria-label="Push to talk">🎤</button>
        <input id="say" type="text" placeholder="Say something, e.g. “the dishwasher isn’t draining”" autocomplete="off" />
        <button class="round" id="send" aria-label="Send">➤</button>
      </div>
      <div class="chips" id="chips"></div>
    </div>
  </div></div></div>
  <aside class="inspector" id="inspector">
    <h2>MCP inspector <button class="chip-btn" id="clearWire">clear</button></h2>
    <div class="meta" id="meta"></div>
    <div class="wire" id="wire"></div>
  </aside>
</main>
<p class="footer-note">Alexa+ itself is not reachable by hackathon participants; this page is a stand-in host. Speech and intent routing are simulated locally; the MCP server, its state, and the MCP App views are real.</p>`;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const convo = $("convo");
const input = $<HTMLInputElement>("say");
const lightbar = $("lightbar");
const screen = $("screen");
const deviceEl = $("deviceEl");
const stage = document.querySelector("main.stage")!;

function setLight(mode: "" | "listening" | "thinking" | "speaking") {
  lightbar.className = `lightbar ${mode}`.trim();
}
function toast(msg: string, err = false) {
  const t = document.createElement("div");
  t.className = `toast${err ? " err" : ""}`;
  t.textContent = msg;
  document.body.append(t);
  setTimeout(() => t.remove(), 3500);
}
function applyFrame() {
  deviceEl.className = `device ${settings.device === "tv" ? "tv" : settings.device === "show15" ? "show15" : ""}`.trim();
  screen.classList.toggle("light", settings.theme === "light");
  $("theme").textContent = `Theme: ${settings.theme}`;
  $("voice").textContent = `Voice: ${settings.voice ? "on" : "off"}`;
  $("day").textContent = `Advance a day (+${settings.dayOffset})`;
  $("insp").classList.toggle("on", settings.inspector);
  stage.classList.toggle("with-inspector", settings.inspector);
  $("inspector").style.display = settings.inspector ? "" : "none";
  ($("device") as HTMLSelectElement).value = settings.device;
}
function tick() {
  const d = simNow();
  $("clock").textContent = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}
function simNow() {
  return new Date(Date.now() + settings.dayOffset * 86_400_000);
}
setInterval(tick, 1000);

// ---------- inspector ----------
function renderMeta() {
  $("meta").innerHTML = host
    ? `<div>Server <b>${host.serverName ?? "?"}</b> · transport <b>Streamable HTTP</b> · negotiated protocol <b>${host.protocolVersion ?? "2025-11-25"}</b></div>
       <div>Endpoint <b>${settings.server}</b></div><div>Household <b>${settings.household}</b>${settings.dayOffset ? ` · demo clock <b>+${settings.dayOffset}d</b>` : ""}</div>
       <div>Tools <b>${host.tools.size}</b> · with MCP App UI <b>${[...host.tools.values()].filter((t) => (t._meta as any)?.ui?.resourceUri).length}</b></div>`
    : `<div>Not connected.</div>`;
}
function pushWire(e: WireEvent) {
  wire.push(e);
  const d = document.createElement("details");
  const label = e.dir === "→" ? `${e.method ?? "(response)"}${e.id != null ? ` #${e.id}` : ""}` : `${e.status ?? ""}${e.id != null ? ` #${e.id}` : ""}`;
  d.innerHTML = `<summary><span class="dir ${e.dir === "←" ? "in" : ""}">${e.dir}</span><span class="m">${label}</span>${e.ms != null ? `<span class="ms">${e.ms} ms</span>` : ""}</summary><pre>${escapeHtml(JSON.stringify({ headers: e.headers, body: e.body }, null, 2))}</pre>`;
  const w = $("wire");
  w.append(d);
  w.scrollTop = w.scrollHeight;
}
const escapeHtml = (s: string) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!);

// ---------- connection ----------
async function connect() {
  $("status").innerHTML = `<span class="pill">connecting…</span>`;
  host = new McpHost({ serverUrl: settings.server, household: settings.household, clockOverride: settings.dayOffset ? simNow().toISOString() : undefined, onWire: pushWire });
  try {
    await host.connect();
    $("status").innerHTML = `<span class="pill ok">● connected · ${host.tools.size} tools · MCP ${host.protocolVersion ?? "2025-11-25"}</span>`;
    renderMeta();
    // Resume conversation context from the server (state lives there, not in this page).
    try {
      const brief = await host.callTool("get_household_brief", {});
      const sc = brief.structuredContent as any;
      const open = sc?.open_cases?.[0];
      state = { ...state, caseId: open?.case_id ?? state.caseId, lastKind: open ? "brief" : state.lastKind };
      refreshChips();
    } catch {
      /* non-fatal */
    }
  } catch (err) {
    $("status").innerHTML = `<span class="pill bad">● cannot reach ${settings.server}</span>`;
    toast(`Could not connect to the MCP server: ${err instanceof Error ? err.message : err}`, true);
    host = undefined;
  }
}

// ---------- conversation ----------
function addUserTurn(text: string) {
  const t = document.createElement("div");
  t.className = "turn";
  t.innerHTML = `<div class="you"></div>`;
  t.querySelector(".you")!.textContent = text;
  convo.append(t);
  convo.scrollTop = convo.scrollHeight;
  return t;
}
function addAlexaTurn() {
  const t = document.createElement("div");
  t.className = "turn";
  t.innerHTML = `<div class="alexa"><div class="thinking"><i></i><i></i><i></i></div></div>`;
  convo.append(t);
  convo.scrollTop = convo.scrollHeight;
  return t.querySelector(".alexa") as HTMLElement;
}
async function speakInto(el: HTMLElement, text: string) {
  const txt = document.createElement("div");
  txt.className = "text speaking";
  txt.textContent = text;
  el.querySelector(".thinking")?.remove();
  el.prepend(txt);
  convo.scrollTop = convo.scrollHeight;
  setLight("speaking");
  await speech.speak(text);
  txt.classList.remove("speaking");
  setLight("");
}

async function handleUtterance(text: string) {
  if (busy || !text.trim()) return;
  if (!host) {
    await connect();
    if (!host) return;
  }
  busy = true;
  speech.stop();
  addUserTurn(text);
  const alexa = addAlexaTurn();
  setLight("thinking");
  try {
    const p = plan(text, state);
    if (p.kind === "say") {
      busy = false;
      await speakInto(alexa, p.text);
      return;
    }
    const toolLine = document.createElement("div");
    toolLine.className = "tool";
    toolLine.innerHTML = `tools/call <code>${p.name}</code> <span>${escapeHtml(p.note)}</span>`;
    const resultPromise = host.callTool(p.name, p.args);
    let bridgeMounted = false;
    const iframe = document.createElement("iframe");
    iframe.className = "appframe";
    iframe.title = `HomeMend ${p.name}`;
    if (host.uiResourceUri(p.name)) {
      alexa.append(iframe);
      bridgeMounted = true;
      host
        .mountApp(iframe, p.name, p.args, resultPromise, {
          theme: settings.theme,
          onMessage: (t) => {
            addUserTurn(t);
          },
          onModelContext: (t, sc) => {
            // The person tapped something in the card; the server answered. Keep the planner in sync and speak the result.
            state = remember(state, "(app)", sc);
            refreshChips();
            if (t) {
              const a = addAlexaTurn();
              void speakInto(a, t);
            }
          },
          onDisplayMode: (m) => iframe.classList.toggle("fullscreen", m === "fullscreen"),
        })
        .catch((e) => {
          console.error(e);
          iframe.remove();
        });
    }
    const result: CallToolResult = await resultPromise;
    const textBlock = result.content.find((c) => c.type === "text") as { text: string } | undefined;
    state = remember(state, p.name, result.structuredContent);
    alexa.append(toolLine);
    if (result.isError) iframe.remove();
    refreshChips();
    if (!bridgeMounted) iframe.remove();
    busy = false; // speaking must not block the next utterance (a new one interrupts speech, like a real device)
    await speakInto(alexa, textBlock?.text ?? "Done.");
  } catch (err) {
    busy = false;
    await speakInto(alexa, `Sorry, something went wrong talking to HomeMend. ${err instanceof Error ? err.message : ""}`);
  } finally {
    busy = false;
    if (!speechSynthesis.speaking) setLight("");
  }
}

const SUGGESTIONS: Record<string, string[]> = {
  start: ["What needs attention at home?", "The dishwasher isn't draining", "The dryer runs but there's no heat", "What appliances do you know about?"],
  step: ["No change", "I found a cracked hose", "That fixed it", "Skip this step"],
  diagnosis: ["Show me the parts", "What did we try?"],
  parts: ["Order the first one", "Order the cheapest one"],
  order: ["Yes, place the order", "Not now"],
  placed: ["What needs attention at home?", "Where were we with the dishwasher?"],
  brief: ["Where were we with the dishwasher?", "The dishwasher isn't draining", "I replaced the fridge water filter"],
  case: ["I installed it and it works", "It's still broken"],
  resolved: ["What else needs attention?", "Thanks"],
};
function refreshChips() {
  const kind = state.pendingQuote ? "order" : state.lastKind === "order" ? "placed" : state.lastKind ?? "start";
  const list = SUGGESTIONS[kind] ?? SUGGESTIONS.start;
  $("chips").innerHTML = "";
  for (const s of list) {
    const b = document.createElement("button");
    b.textContent = s;
    b.addEventListener("click", () => void handleUtterance(s));
    $("chips").append(b);
  }
}

// ---------- guided demo ----------
const DEMO_SCRIPT = [
  "What needs attention at home?",
  "The dishwasher isn't draining, there's water at the bottom",
  "I checked, the filter is clean",
  "I found it, the drain hose is cracked near the clamp",
  "Show me the parts",
  "Order the first one",
  "Yes, place the order",
];
async function runDemo() {
  for (const line of DEMO_SCRIPT) {
    input.value = line;
    await handleUtterance(line);
    input.value = "";
    await new Promise((r) => setTimeout(r, 900));
  }
  toast("Guided demo finished. Try “Advance a day”, then ask “did my part arrive?”");
}

// ---------- wiring ----------
$("send").addEventListener("click", () => {
  const v = input.value;
  input.value = "";
  void handleUtterance(v);
});
input.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    const v = input.value;
    input.value = "";
    void handleUtterance(v);
  }
});
$("mic").addEventListener("click", async () => {
  if (!speech.canListen) return toast("Speech recognition needs Chrome. Type instead.", true);
  const mic = $("mic");
  mic.classList.add("listening");
  setLight("listening");
  speech.stop();
  try {
    const heard = await speech.listen((t) => (input.value = t));
    if (heard) {
      input.value = "";
      await handleUtterance(heard);
    }
  } catch (e) {
    toast(`Mic: ${e instanceof Error ? e.message : e}`, true);
  } finally {
    mic.classList.remove("listening");
    if (!busy) setLight("");
  }
});
$("theme").addEventListener("click", () => {
  settings.theme = settings.theme === "dark" ? "light" : "dark";
  save();
  applyFrame();
});
$("voice").addEventListener("click", () => {
  settings.voice = !settings.voice;
  speech.enabled = settings.voice;
  if (!settings.voice) speech.stop();
  save();
  applyFrame();
});
$("device").addEventListener("change", (e) => {
  settings.device = (e.target as HTMLSelectElement).value as typeof settings.device;
  save();
  applyFrame();
});
$("day").addEventListener("click", async () => {
  settings.dayOffset += 1;
  save();
  applyFrame();
  tick();
  await connect();
  toast(`Demo clock moved to ${simNow().toDateString()}. Ask “what needs attention at home?”`);
});
$("reset").addEventListener("click", async () => {
  settings.household = `demo-${Math.random().toString(36).slice(2, 7)}`;
  settings.dayOffset = 0;
  state = {};
  save();
  applyFrame();
  convo.innerHTML = "";
  await connect();
  refreshChips();
  toast(`New household ${settings.household}`);
});
$("insp").addEventListener("click", () => {
  settings.inspector = !settings.inspector;
  save();
  applyFrame();
});
$("clearWire").addEventListener("click", () => {
  wire.length = 0;
  $("wire").innerHTML = "";
});
$("demo").addEventListener("click", () => void runDemo());

applyFrame();
tick();
refreshChips();
void connect().then(() => renderMeta());
