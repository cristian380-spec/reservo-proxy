const express = require('express');
const app = express();

const RESERVO_TOKEN  = '49b063a0cb4e28bd639b47b952cadffbbe871632';
const RESERVO_AGENDA = '10WQt9N0R0tf0m2I7125YbN5B9w0FT';
const H = { 'Authorization': `Token ${RESERVO_TOKEN}`, 'Content-Type': 'application/json' };
const BASE = `https://reservo.cl/APIpublica/v2/agenda_online/${RESERVO_AGENDA}`;

// CORS
app.use(function (req, res, next) {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

app.use(express.json());

function toDateStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function shortName(n) {
  const p = n.split(' ');
  return p.length >= 4 ? `${p[0]} ${p[1]} ${p[p.length-2]}` : n;
}

function extractFirstSlot(data, dateStr) {
  const days = Array.isArray(data) ? data : [data];
  for (const day of days) {
    for (const suc of (day.sucursales || [])) {
      for (const prof of (suc.profesionales || [])) {
        for (const horaISO of (prof.horas_disponibles || [])) {
          return { date: day.fecha || dateStr, time: horaISO.substring(11,16), profesional: shortName(prof.nombre||'') };
        }
      }
    }
  }
  return null;
}

// ── GET /next-slot ─────────────────────────────────────────────────────────
const TRATS_NEXT = ['b32625a0-3067-466a-867c-45465d0c5d68','7a5086f2-a17b-4299-93aa-4abf1f329dca'];
app.get('/next-slot', async (req, res) => {
  const base = new Date();
  for (let i = 0; i <= 14; i++) {
    const d = new Date(base); d.setDate(base.getDate()+i);
    const ds = toDateStr(d);
    for (const t of TRATS_NEXT) {
      try {
        const r = await fetch(`${BASE}/horarios_disponibles/?uuid_tratamiento=${t}&fecha=${ds}`, { headers: H });
        if (!r.ok) continue;
        const slot = extractFirstSlot(await r.json(), ds);
        if (slot) return res.json(slot);
      } catch(e) {}
    }
  }
  res.json({ date: null, time: null });
});

// ── GET /slots?tratamiento=UUID&fecha=YYYY-MM-DD ──────────────────────────
app.get('/slots', async (req, res) => {
  const { tratamiento, fecha } = req.query;
  if (!tratamiento || !fecha) return res.status(400).json({ error: 'Faltan parámetros' });
  try {
    const r = await fetch(`${BASE}/horarios_disponibles/?uuid_tratamiento=${tratamiento}&fecha=${fecha}`, { headers: H });
    if (!r.ok) return res.json({ slots: [] });
    const data = await r.json();
    const days = Array.isArray(data) ? data : [data];
    const slots = [];
    for (const day of days) {
      for (const suc of (day.sucursales || [])) {
        for (const prof of (suc.profesionales || [])) {
          for (const horaISO of (prof.horas_disponibles || [])) {
            slots.push({
              fecha:    day.fecha,
              hora:     horaISO.substring(11,16),
              hora_iso: horaISO,
              calendario:        prof.agenda,
              profesional_uuid:  prof.agenda,
              profesional_nombre: prof.nombre
            });
          }
        }
      }
    }
    res.json({ slots });
  } catch(e) {
    res.json({ slots: [] });
  }
});

// ── POST /agendar ──────────────────────────────────────────────────────────
app.post('/agendar', async (req, res) => {
  const { hora_iso, tratamiento, calendario, nombre, apellido, email, telefono, rut, fecha_nacimiento } = req.body;
  try {
    const r = await fetch(`${BASE}/citas/`, {
      method: 'POST',
      headers: H,
      body: JSON.stringify({
        hora_iso,
        tratamientos: [tratamiento],
        calendario,
        cliente: { nombre, apellido, email, telefono, rut, fecha_nacimiento }
      })
    });
    const data = await r.json();
    res.status(r.status).json(data);
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// ── GET /debug ─────────────────────────────────────────────────────────────
app.get('/debug', async (req, res) => {
  const base = new Date();
  const results = [];
  for (let i = 0; i <= 2; i++) {
    const d = new Date(base); d.setDate(base.getDate()+i);
    const ds = toDateStr(d);
    for (const t of TRATS_NEXT) {
      try {
        const r = await fetch(`${BASE}/horarios_disponibles/?uuid_tratamiento=${t}&fecha=${ds}`, { headers: H });
        const raw = await r.text();
        results.push({ date: ds, trat: t, status: r.status, raw: raw.substring(0,300) });
      } catch(e) { results.push({ date: ds, trat: t, error: e.message }); }
    }
  }
  res.json(results);
});

app.get('/health', (_req, res) => res.json({ ok: true }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Reservo proxy en puerto ${PORT}`));
