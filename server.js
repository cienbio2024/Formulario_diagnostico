const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

async function enviarEmail(datos, diagnostico) {
  try {
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background: #0f3a58; padding: 20px; border-radius: 10px 10px 0 0;">
          <h1 style="color: white; margin: 0; font-size: 22px;">🧬 Nueva consulta CIENBIO</h1>
        </div>
        <div style="background: #f7fafb; padding: 24px; border: 1px solid #dde5ee;">
          <h2 style="color: #0f3a58; font-size: 16px; margin-bottom: 16px;">Datos del contacto</h2>
          <table style="width:100%; border-collapse: collapse;">
            <tr><td style="padding:6px 0;color:#6b7a8d;width:140px;">Nombre</td><td style="padding:6px 0;font-weight:600;">${datos.nombre}</td></tr>
            <tr><td style="padding:6px 0;color:#6b7a8d;">Cargo</td><td style="padding:6px 0;">${datos.cargo}</td></tr>
            <tr><td style="padding:6px 0;color:#6b7a8d;">Organización</td><td style="padding:6px 0;">${datos.org}</td></tr>
            <tr><td style="padding:6px 0;color:#6b7a8d;">Tipo</td><td style="padding:6px 0;">${datos.tipoOrg}</td></tr>
            <tr><td style="padding:6px 0;color:#6b7a8d;">Email</td><td style="padding:6px 0;"><a href="mailto:${datos.email}" style="color:#1B5E8E;">${datos.email}</a></td></tr>
            <tr><td style="padding:6px 0;color:#6b7a8d;">Teléfono</td><td style="padding:6px 0;">${datos.tel || 'No indicado'}</td></tr>
          </table>
          <hr style="border:none;border-top:1px solid #dde5ee;margin:20px 0;">
          <h2 style="color:#0f3a58;font-size:16px;margin-bottom:16px;">Desafío científico</h2>
          <table style="width:100%; border-collapse: collapse;">
            <tr><td style="padding:6px 0;color:#6b7a8d;width:140px;">Problema</td><td style="padding:6px 0;">${datos.tipoProblema}</td></tr>
            <tr><td style="padding:6px 0;color:#6b7a8d;">Descripción</td><td style="padding:6px 0;">${datos.descripcion}</td></tr>
            <tr><td style="padding:6px 0;color:#6b7a8d;">Urgencia</td><td style="padding:6px 0;">${datos.urgencia}</td></tr>
            <tr><td style="padding:6px 0;color:#6b7a8d;">Técnicas</td><td style="padding:6px 0;">${datos.tecnicas}</td></tr>
          </table>
          <hr style="border:none;border-top:1px solid #dde5ee;margin:20px 0;">
          <h2 style="color:#0f3a58;font-size:16px;margin-bottom:12px;">Diagnóstico generado por IA</h2>
          <div style="background:white;padding:16px;border-radius:8px;border:1px solid #dde5ee;font-size:14px;line-height:1.7;white-space:pre-wrap;">${diagnostico}</div>
          <div style="margin-top:24px;text-align:center;">
            <a href="mailto:${datos.email}" style="background:#1B5E8E;color:white;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px;">Responder a ${datos.nombre}</a>
          </div>
        </div>
        <div style="background:#0f3a58;padding:14px;border-radius:0 0 10px 10px;text-align:center;">
          <p style="color:rgba(255,255,255,0.6);font-size:12px;margin:0;">CIENBIO SpA · cienbio.cl</p>
        </div>
      </div>`;

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${process.env.RESEND_API_KEY}` },
      body: JSON.stringify({
        from: 'CIENBIO <onboarding@resend.dev>',
        to: ['augustomanubens@gmail.com'],
       subject: `Nueva consulta CIENBIO: ${datos.nombre} | ${datos.email} | ${datos.tel || 'sin tel'} — ${datos.org}`,
        html
      })
    });
    if (!res.ok) { const err = await res.json(); console.error('Error Resend:', JSON.stringify(err)); }
    else console.log('Email enviado a augustomanubens@gmail.com');
  } catch (e) { console.error('Error email:', e.message); }
}

async function guardarEnSheets(datos, diagnostico) {
  if (!process.env.SHEETS_WEBHOOK_URL) return;
  try {
    await fetch(process.env.SHEETS_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fecha: new Date().toISOString(), ...datos, diagnostico })
    });
    console.log('Guardado en Google Sheets');
  } catch (e) { console.error('Error Sheets:', e.message); }
}

app.post('/api/diagnostico', async (req, res) => {
  const { prompt, datos } = req.body;
  if (!prompt) return res.status(400).json({ error: 'Prompt requerido' });

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 1000, messages: [{ role: 'user', content: prompt }] })
    });

    const data = await response.json();
    if (!response.ok) { console.error('Error Anthropic:', JSON.stringify(data)); return res.status(response.status).json({ error: data.error?.message || 'Error en la API' }); }

    const text = data.content?.find(b => b.type === 'text')?.text || '';
    if (datos) { enviarEmail(datos, text); guardarEnSheets(datos, text); }
    res.json({ text });

  } catch (error) { console.error('Error:', error); res.status(500).json({ error: 'Error interno' }); }
});

app.get('*', (req, res) => { res.sendFile(path.join(__dirname, 'public', 'index.html')); });
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`CIENBIO Diagnóstico corriendo en puerto ${PORT}`));

