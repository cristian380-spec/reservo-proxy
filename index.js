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
    const text = await r.text();
    let data; try { data = JSON.parse(text); } catch(e) { return res.json({ slots: [] }); }
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
  const { hora_iso, tratamiento, calendario, nombre, apellido, email, telefono, rut, fecha_nacimiento, paciente_uuid } = req.body;
  try {
    const cliente = paciente_uuid
      ? { uuid: paciente_uuid }
      : { nombre, apellido, email, telefono, rut, fecha_nacimiento };
    const r = await fetch(`${BASE}/citas/`, {
      method: 'POST',
      headers: H,
      body: JSON.stringify({
        hora_iso,
        tratamientos: [tratamiento],
        calendario,
        cliente
      })
    });
    const text = await r.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch(e) {
      // Reservo devolvió HTML (error del servidor o slot inválido)
      if (!r.ok) {
        return res.status(r.status).json({ error: 'Horario no disponible o ya reservado. Intenta con otro horario.' });
      }
      return res.status(500).json({ error: 'Respuesta inesperada del servidor de agenda.' });
    }
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

// ── GET /lookup-rut?rut=12.345.678-9 ──────────────────────────────────────
// Usa /makereserva/existencia_rut_api/ (doc oficial Reservo)
app.get('/lookup-rut', async (req, res) => {
  const { rut } = req.query;
  if (!rut) return res.status(400).json({ error: 'Falta RUT' });
  // Reservo exige RUT sin puntos, con guión: "12345678-9"
  const cleanRut = rut.replace(/\./g, '');
  try {
    const r = await fetch('https://reservo.cl/makereserva/existencia_rut_api/', {
      method: 'POST',
      headers: H,
      body: JSON.stringify({ rut: cleanRut })
    });
    const text = await r.text();
    let data;
    try { data = JSON.parse(text); } catch(e) { return res.json({ found: false }); }

    if (data.marcado === 1) return res.json({ found: false, blocked: true });
    if (data.existe === 1)  return res.json({ found: true, uuid: data.paciente });
    res.json({ found: false });
  } catch(e) {
    res.json({ found: false });
  }
});

// ── GET /debug-paciente?rut=12345678-9 ────────────────────────────────────
app.get('/debug-paciente', async (req, res) => {
  const { rut } = req.query;
  if (!rut) return res.status(400).json({ error: 'Falta RUT' });
  const cleanRut = rut.replace(/\./g, '');
  const results = {};
  // Step 1: existencia
  try {
    const r1 = await fetch('https://reservo.cl/makereserva/existencia_rut_api/', {
      method: 'POST', headers: H, body: JSON.stringify({ rut: cleanRut })
    });
    const t1 = await r1.text();
    results.step1_status = r1.status;
    results.step1_raw = t1.substring(0, 500);
    let d1; try { d1 = JSON.parse(t1); } catch(e) { d1 = null; }
    results.step1_parsed = d1;
    // Step 2: cliente detail
    if (d1 && d1.existe === 1) {
      const uuid = d1.paciente;
      const r2 = await fetch(`${BASE}/clientes/${uuid}/`, { headers: H });
      const t2 = await r2.text();
      results.step2_url = `${BASE}/clientes/${uuid}/`;
      results.step2_status = r2.status;
      results.step2_raw = t2.substring(0, 1000);
      // Also try list endpoint
      const r3 = await fetch(`${BASE}/clientes/?rut=${encodeURIComponent(cleanRut)}`, { headers: H });
      const t3 = await r3.text();
      results.step3_url = `${BASE}/clientes/?rut=${cleanRut}`;
      results.step3_status = r3.status;
      results.step3_raw = t3.substring(0, 1000);
    }
  } catch(e) { results.error = e.message; }
  res.json(results);
});

app.get('/health', (_req, res) => res.json({ ok: true }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Reservo proxy en puerto ${PORT}`));
