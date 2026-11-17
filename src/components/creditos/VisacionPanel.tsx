import React, { useEffect, useState } from 'react';
import { FileText, Mail, Send, Eye, AlertTriangle } from 'lucide-react';
import { api, type VisacionExtras, type VisacionInfo } from '../../api';

type Props = {
  token: string;
  creditoId: number;
  readOnly?: boolean;
  formatMoney: (val?: number | null) => string;
  formatDateTime: (val?: string | null) => string;
};

const openBlob = (blob: Blob) => {
  const url = URL.createObjectURL(blob);
  window.open(url, '_blank', 'noopener,noreferrer');
  window.setTimeout(() => URL.revokeObjectURL(url), 60000);
};

/** Visación: formal letter to the employer approving the payroll deduction, generated as PDF and emailed from the app. */
export const VisacionPanel: React.FC<Props> = ({ token, creditoId, readOnly = false, formatMoney, formatDateTime }) => {
  const [info, setInfo] = useState<VisacionInfo | null>(null);
  const [extras, setExtras] = useState<VisacionExtras>({ ciudad: '', entidadFinanciera: '', entidadOperadora: '', firmanteNombre: '', firmanteCargo: '' });
  const [para, setPara] = useState('');
  const [copia, setCopia] = useState('');
  const [mensaje, setMensaje] = useState('');
  const [busy, setBusy] = useState<'preview' | 'send' | null>(null);
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    api.getVisacion(token, creditoId)
      .then((data) => {
        setInfo(data);
        const { para: sugerido, ...rest } = data.sugerencias;
        setExtras(rest);
        setPara(sugerido);
      })
      .catch((err) => setFeedback({ ok: false, text: err instanceof Error ? err.message : 'No se pudo cargar la información de visación' }));
  }, [token, creditoId]);

  const set = (key: keyof VisacionExtras) => (event: React.ChangeEvent<HTMLInputElement>) => setExtras((current) => ({ ...current, [key]: event.target.value }));

  const preview = async () => {
    setBusy('preview');
    setFeedback(null);
    try { openBlob(await api.previewVisacion(token, creditoId, extras)); }
    catch (err) { setFeedback({ ok: false, text: err instanceof Error ? err.message : 'No se pudo generar la carta' }); }
    finally { setBusy(null); }
  };

  const enviar = async () => {
    setBusy('send');
    setFeedback(null);
    try {
      const res = await api.enviarVisacion(token, creditoId, { para, copia: copia || undefined, mensaje: mensaje || undefined, extras });
      setInfo((current) => (current ? { ...current, visaciones: res.visaciones } : current));
      setFeedback({ ok: res.enviado, text: res.detalle });
    } catch (err) {
      setFeedback({ ok: false, text: err instanceof Error ? err.message : 'No se pudo enviar la carta' });
    } finally {
      setBusy(null);
    }
  };

  if (!info) return <div className="estudio-panel">{feedback ? <p className="estudio-error" role="alert">{feedback.text}</p> : <p className="muted-note">Cargando información de visación…</p>}</div>;

  const d = info.datos;
  const ultimaEnviada = info.visaciones.find((item) => item.enviado);
  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(para);

  return (
    <section className="estudio-panel" aria-labelledby="visacion-title">
      <header className="estudio-header">
        <div>
          <h3 id="visacion-title"><FileText size={18} aria-hidden="true" /> Carta de visación a la empresa</h3>
          <p>Aprobación y autorización de descuento por libranza (Ley 1527 de 2012). Se envía en PDF a la pagaduría para que la firme y la devuelva.</p>
        </div>
        {ultimaEnviada && <span className="chip ok">Enviada {formatDateTime(ultimaEnviada.fecha)}</span>}
      </header>

      <div className="soportes-modalidad">
        <div><span>Empresa</span><strong>{d.empresa || '—'}</strong></div>
        <div><span>NIT</span><strong>{d.nit || '—'}</strong></div>
        <div><span>Trabajador</span><strong>{d.trabajador} · {d.cedula}</strong></div>
        <div><span>Préstamo</span><strong>{formatMoney(d.monto)}</strong></div>
        <div><span>Cuota</span><strong>{formatMoney(d.cuota)}</strong></div>
        <div><span>Plazo</span><strong>{d.plazo} meses</strong></div>
      </div>
      {!info.usaDecision && <p className="muted-note">Los valores son los solicitados; cuando registres la decisión del crédito, la carta usará el monto, plazo y cuota aprobados.</p>}
      {info.faltantes.length > 0 && (
        <p className="estudio-verdict bad"><AlertTriangle size={16} aria-hidden="true" /> Faltan datos en la ficha: {info.faltantes.join(', ')}. Saldrán como [campo] en la carta.</p>
      )}

      {!readOnly && (
        <>
          <div className="visacion-grid">
            <label className="estudio-field"><span>Para (correo de la empresa)</span><input className="visacion-input" type="email" value={para} onChange={(e) => setPara(e.target.value)} /></label>
            <label className="estudio-field"><span>Copia (opcional)</span><input className="visacion-input" type="email" value={copia} onChange={(e) => setCopia(e.target.value)} /></label>
            <label className="estudio-field"><span>Ciudad de la carta</span><input className="visacion-input" value={extras.ciudad} onChange={set('ciudad')} /></label>
            <label className="estudio-field"><span>Dirigida a (entidad financiera)</span><input className="visacion-input" value={extras.entidadFinanciera} onChange={set('entidadFinanciera')} /></label>
            <label className="estudio-field"><span>Recursos a favor de (entidad operadora)</span><input className="visacion-input" value={extras.entidadOperadora} onChange={set('entidadOperadora')} /></label>
            <label className="estudio-field"><span>Firma: nombre</span><input className="visacion-input" value={extras.firmanteNombre} onChange={set('firmanteNombre')} /></label>
            <label className="estudio-field"><span>Firma: cargo</span><input className="visacion-input" value={extras.firmanteCargo} onChange={set('firmanteCargo')} /></label>
          </div>
          <label className="estudio-field estudio-obs"><span>Mensaje adicional en el correo (opcional)</span><textarea rows={2} maxLength={2000} value={mensaje} onChange={(e) => setMensaje(e.target.value)} /></label>
          <div className="estudio-actions" style={{ justifyContent: 'flex-end' }}>
            <button type="button" className="stage-btn-outline" disabled={busy !== null} onClick={preview}><Eye size={14} aria-hidden="true" /> {busy === 'preview' ? 'Generando…' : 'Vista previa PDF'}</button>
            <button type="button" className="stage-btn-primary" disabled={busy !== null || !emailOk} onClick={enviar}><Send size={14} aria-hidden="true" /> {busy === 'send' ? 'Enviando…' : 'Enviar a la empresa'}</button>
          </div>
        </>
      )}
      {feedback && <p className={`estudio-verdict ${feedback.ok ? 'ok' : 'bad'}`} role="status">{feedback.text}</p>}

      {info.visaciones.length > 0 && (
        <div className="estudio-history">
          <h4>Cartas generadas</h4>
          <ul>
            {info.visaciones.map((item) => (
              <li key={item.id}>
                <span className={`chip ${item.enviado ? 'ok' : 'warn'}`}>{item.enviado ? 'Enviada' : 'Sin enviar'}</span>
                <span><Mail size={12} aria-hidden="true" /> {item.destinatario}</span>
                <button type="button" className="estudio-link" onClick={() => api.getVisacionPdf(token, item.id).then(openBlob).catch(() => setFeedback({ ok: false, text: 'No se pudo abrir la carta' }))}>Ver PDF</button>
                <small>{formatDateTime(item.fecha)}{item.usuario ? ` · ${item.usuario}` : ''}{item.detalle ? ` · ${item.detalle}` : ''}</small>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
};
