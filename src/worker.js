function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;',
    '"': '&quot;', "'": '&#39;'
  })[c]);
}

async function enviarEmail(datos, diagnostico, env) {
  if (!env.RESEND_API_KEY) {
    throw new Error('Falta RESEND_API_KEY');
  }

  const d = Object.fromEntries(
    Object.entries(datos).map(([k, v]) => [k, escapeHtml(v)])
  );

  const html = `
    <div style="font-family:Arial,sans-serif;max-width:650px;margin:auto">
      <div style="background:#0f3a58;color:white;padding:22px">
        <h1>Nueva consulta CIENBIO</h1>
      </div>
      <div style="padding:24px;background:#f7fafb">
        <h2>Datos del contacto</h2>
        <p><b>Nombre:</b> ${d.nombre || ''}</p>
        <p><b>Cargo:</b> ${d.cargo || ''}</p>
        <p><b>Organización:</b> ${d.org || ''}</p>
        <p><b>Tipo:</b> ${d.tipoOrg || ''}</p>
        <p><b>Email:</b> ${d.email || ''}</p>
        <p><b>Teléfono:</b> ${d.tel || 'No indicado'}</p>
        <hr>
        <h2>Desafío científico</h2>
        <p><b>Problema:</b> ${d.tipoProblema || ''}</p>
        <p><b>Descripción:</b> ${d.descripcion || ''}</p>
        <p><b>Urgencia:</b> ${d.urgencia || ''}</p>
        <p><b>Técnicas:</b> ${d.tecnicas || ''}</p>
        <hr>
        <h2>Diagnóstico generado por IA</h2>
        <div style="white-space:pre-wrap;background:white;padding:16px">
          ${escapeHtml(diagnostico)}
        </div>
      </div>
      <div style="background:#0f3a58;color:white;padding:14px;text-align:center">
        CIENBIO SpA · cienbio.cl
      </div>
    </div>`;

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${env.RESEND_API_KEY}`
    },
    body: JSON.stringify({
      from: 'CIENBIO <onboarding@resend.dev>',
      to: ['augustomanubens@gmail.com'],
      subject: `Nueva consulta CIENBIO: ${datos.nombre || ''} | ${datos.email || ''} | ${datos.tel || 'sin tel'} — ${datos.org || ''}`,
      html
    })
  });

  if (!response.ok) {
    throw new Error(`Resend: ${response.status} ${await response.text()}`);
  }
}

async function guardarEnSheets(datos, diagnostico, env) {
  if (!env.SHEETS_WEBHOOK_URL) return;

  const response = await fetch(env.SHEETS_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fecha: new Date().toISOString(),
      ...datos,
      diagnostico
    })
  });

  if (!response.ok) {
    throw new Error(`Sheets: HTTP ${response.status}`);
  }
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' }
  });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname !== '/api/diagnostico') {
      return env.ASSETS.fetch(request);
    }

    if (request.method !== 'POST') {
      return json({ error: 'Método no permitido' }, 405);
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: 'JSON inválido' }, 400);
    }

    const { prompt, datos } = body;

    if (typeof prompt !== 'string' || !prompt.trim()) {
      return json({ error: 'Prompt requerido' }, 400);
    }

    if (!env.ANTHROPIC_API_KEY) {
      return json({ error: 'Servicio de IA no configurado' }, 503);
    }

    try {
      const response = await fetch(
        'https://api.anthropic.com/v1/messages',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': env.ANTHROPIC_API_KEY,
            'anthropic-version': '2023-06-01'
          },
          body: JSON.stringify({
            model: 'claude-haiku-4-5-20251001',
            max_tokens: 1000,
            messages: [{ role: 'user', content: prompt }]
          })
        }
      );

      const data = await response.json();

      if (!response.ok) {
        console.error('Error Anthropic:', response.status);
        return json({
          error: data.error?.message || 'Error en la API de IA'
        }, response.status);
      }

      const text = data.content?.find(
        item => item.type === 'text'
      )?.text || '';

      if (datos && typeof datos === 'object' && !Array.isArray(datos)) {
        ctx.waitUntil(
          Promise.allSettled([
            enviarEmail(datos, text, env),
            guardarEnSheets(datos, text, env)
          ]).then(results => {
            results.forEach((result, index) => {
              if (result.status === 'rejected') {
                console.error(
                  index === 0 ? 'Error email:' : 'Error Sheets:',
                  result.reason
                );
              }
            });
          })
        );
      }

      return json({ text });

    } catch (error) {
      console.error('Error diagnóstico:', error);
      return json({ error: 'Error interno del servidor' }, 500);
    }
  }
};

