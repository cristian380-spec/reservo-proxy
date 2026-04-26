const express = require('express');
const app = express();

const RESERVO_TOKEN  = '49b063a0cb4e28bd639b47b952cadffbbe871632';
const RESERVO_AGENDA = '10WQt9N0R0tf0m2I7125YbN5B9w0FT';
const TRATAMIENTOS   = [
  'b32625a0-3067-466a-867c-45465d0c5d68', // Psiquiatría
  '7a5086f2-a17b-4299-93aa-4abf1f329dca'  // Psicología
];

app.use(function (req, res, next) {
  const origin = req.headers.origin || '';
  const allowed = ['https://equi-libra.cl', 'https://www.equi-libra.cl'];
  if (allowed.includes(origin) || origin.startsWith('http://localhost')) {
    res.header('Access-Control-Allow-Origin', origin);
  }
  res.header('Access-Control-Allow-Methods', 'GET');
  next();
});

function toDateStr(d) {
  const y  = d.getFullYear();
  const m  = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

// Extrae el primer horario disponible del formato Reservo
// La API devuelve un ARRAY de objetos día: [{ fecha, sucursales: [...] }, ...]
function extractFirstSlot(data, dateStr) {
  const days = Array.isArray(data) ? data : [data];
  for (const day of days) {
    for (const suc of (day.sucursales || [])) {
      for (const prof of (suc.profesionales || [])) {
        for (const horaISO of (prof.horas_disponibles || [])) {
          const dt = new Date(horaISO);
          const hh = String(dt.getHours()).padStart(2, '0');
          const mm = String(dt.getMinutes()).padStart(2, '0');
          return { date: day.fecha || dateStr, time: `${hh}:${mm}` };
        }
      }
    }
  }
  return null;
}

app.get('/next-slot', async (req, res) => {
  const base = new Date();
  for (let i = 0; i <= 14; i++) {
    const date = new Date(base);
    date.setDate(base.getDate() + i);
    const dateStr = toDateStr(date);
    for (const trat of TRATAMIENTOS) {
      try {
        const url = `https://reservo.cl/APIpublica/v2/agenda_online/${RESERVO_AGENDA}/horarios_disponibles/?uuid_tratamiento=${trat}&fecha=${dateStr}`;
        const r = await fetch(url, { headers: { 'Authorization': `Token ${RESERVO_TOKEN}` } });
        if (!r.ok) continue;
        const data = await r.json();
        const slot = extractFirstSlot(data, dateStr);
        if (slot) return res.json(slot);
      } catch (e) {}
    }
  }
  res.json({ date: null, time: null });
});

app.get('/debug', async (req, res) => {
  const base = new Date();
  const results = [];
  for (let i = 0; i <= 3; i++) {
    const date = new Date(base);
    date.setDate(base.getDate() + i);
    const dateStr = toDateStr(date);
    for (const trat of TRATAMIENTOS) {
      try {
        const url = `https://reservo.cl/APIpublica/v2/agenda_online/${RESERVO_AGENDA}/horarios_disponibles/?uuid_tratamiento=${trat}&fecha=${dateStr}`;
        const r = await fetch(url, { headers: { 'Authorization': `Token ${RESERVO_TOKEN}` } });
        const raw = await r.text();
        results.push({ date: dateStr, trat, status: r.status, raw: raw.substring(0, 500) });
      } catch (e) {
        results.push({ date: dateStr, trat, error: e.message });
      }
    }
  }
  res.json(results);
});

app.get('/health', (_req, res) => res.json({ ok: true }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Reservo proxy en puerto ${PORT}`));
