import React, { useEffect, useMemo, useState } from 'react';
import { api, type EmpresaRow, type FianzaItem, type PlazoPagoItem, type SimulacionCredito } from '../../api';
import { incorporarPorcentajeCalificacion } from './fianzaSimulacion';

type LineaSimulacion = {
  id: number;
  nombre: string;
  montoMinimo: number | null;
  montoMaximo: number | null;
  plazoMinimo: number | null;
  plazoMaximo: number | null;
};

interface CreditSimulationViewProps {
  token: string;
}

const formatMoney = (value?: number | null) => {
  if (value == null || Number.isNaN(Number(value))) return '$ 0';
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    maximumFractionDigits: 0
  }).format(Math.round(Number(value)));
};

const formatPercent = (value?: number | null) => {
  if (value == null || Number.isNaN(Number(value))) return '—';
  return `${Number(value).toLocaleString('es-CO', { maximumFractionDigits: 4 })}%`;
};

export const CreditSimulationView: React.FC<CreditSimulationViewProps> = ({ token }) => {
  const [empresas, setEmpresas] = useState<EmpresaRow[]>([]);
  const [lineas, setLineas] = useState<LineaSimulacion[]>([]);
  const [plazos, setPlazos] = useState<PlazoPagoItem[]>([]);
  const [fianzas, setFianzas] = useState<FianzaItem[]>([]);
  const [catalogError, setCatalogError] = useState('');
  const [loadingCatalogs, setLoadingCatalogs] = useState(true);
  const [loadingLineas, setLoadingLineas] = useState(false);

  const [idEmpresa, setIdEmpresa] = useState('');
  const [idLinea, setIdLinea] = useState('');
  const [plazoOpcion, setPlazoOpcion] = useState('');
  const [plazo, setPlazo] = useState('');
  const [idFianza, setIdFianza] = useState('');
  const [idCalificacion, setIdCalificacion] = useState('');
  const [valor, setValor] = useState('');

  const [simulation, setSimulation] = useState<SimulacionCredito | null>(null);
  const [calcError, setCalcError] = useState('');
  const [calculating, setCalculating] = useState(false);

  const cargarLineas = async (): Promise<LineaSimulacion[]> => {
    try {
      const productos = await api.listProductosCredito(token);
      const activas = productos.filter((item) => item.activo !== false);
      const fuente = activas.length > 0 ? activas : productos;
      if (fuente.length > 0) {
        return fuente.map((item) => ({
          id: item.id,
          nombre: [item.consecutivo, item.nombre].filter(Boolean).join(' - '),
          montoMinimo: item.montoMinimo,
          montoMaximo: item.montoMaximo,
          plazoMinimo: item.plazoMinimo,
          plazoMaximo: item.plazoMaximo
        }));
      }
    } catch {
      // El catálogo de créditos no exige el permiso de productos.
    }
    const catalogs = await api.listCreditosCatalogs(token);
    return catalogs.productos.map((item) => ({
      id: item.id,
      nombre: item.nombre,
      montoMinimo: null,
      montoMaximo: null,
      plazoMinimo: null,
      plazoMaximo: null
    }));
  };

  useEffect(() => {
    let active = true;
    setLoadingCatalogs(true);
    setLoadingLineas(true);
    Promise.all([
      api.listEmpresas(token),
      api.listPlazos(token, 'MESES'),
      api.listFianzas(token),
      cargarLineas()
    ]).then(([empresaRows, plazoRows, fianzaRows, lineaRows]) => {
      if (!active) return;
      setEmpresas(empresaRows);
      setPlazos(plazoRows.filter((item) => item.activo && item.unidad === 'MESES'));
      setFianzas(fianzaRows.filter((item) => item.activo));
      setLineas(lineaRows);
      setCatalogError(lineaRows.length ? '' : 'No hay líneas de crédito registradas.');
    }).catch((error: unknown) => {
      if (!active) return;
      setCatalogError(error instanceof Error ? error.message : 'No se pudieron cargar los filtros de simulación');
    }).finally(() => {
      if (active) {
        setLoadingCatalogs(false);
        setLoadingLineas(false);
      }
    });
    return () => { active = false; };
  }, [token]);

  const fianza = fianzas.find((item) => String(item.id) === idFianza) ?? null;
  const calificaciones = fianza?.calificaciones ?? [];
  const calificacion = calificaciones.length === 1
    ? calificaciones[0]
    : calificaciones.find((item) => String(item.id) === idCalificacion) ?? null;
  const porcentajeCalificacion = Number(calificacion?.porcentaje);
  const plazosMeses = useMemo(
    () => [...plazos].sort((a, b) => a.plazo - b.plazo || a.orden - b.orden),
    [plazos]
  );
  const linea = lineas.find((item) => String(item.id) === idLinea) ?? null;
  const monto = Number(valor);
  const meses = Number(plazo);
  const calificacionId = calificacion?.id;
  const listo = Boolean(
    idEmpresa
    && linea
    && Number.isInteger(meses)
    && meses > 0
    && monto > 0
    && fianza
    && calificacionId
    && porcentajeCalificacion > 0
  );

  useEffect(() => {
    if (!listo || !fianza || !calificacion || !calificacionId || !linea) {
      setSimulation(null);
      setCalculating(false);
      return;
    }
    let active = true;
    setCalculating(true);
    setCalcError('');
    const timer = window.setTimeout(() => {
      api.simularCredito(token, {
        idProductoCredito: linea.id,
        idEmpresa: Number(idEmpresa),
        idFianza: fianza.id,
        idCalificacionFianza: calificacionId,
        montoSolicitado: monto,
        plazo: meses
      }).then((data) => incorporarPorcentajeCalificacion(token, data, {
        id: fianza.id,
        nombre: fianza.nombre,
        idCalificacion: calificacionId,
        letra: calificacion.letra,
        porcentaje: porcentajeCalificacion
      }, linea.id)).then((data) => {
        if (!active) return;
        setSimulation(data);
        setCalcError('');
      }).catch((error: unknown) => {
        if (!active) return;
        setSimulation(null);
        setCalcError(error instanceof Error ? error.message : 'No se pudo calcular la simulación');
      }).finally(() => {
        if (active) setCalculating(false);
      });
    }, 300);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [token, listo, fianza, calificacion, calificacionId, porcentajeCalificacion, linea, idEmpresa, monto, meses]);

  const onPlazoCatalogo = (opcion: string) => {
    setPlazoOpcion(opcion);
    const elegido = plazosMeses.find((item) => String(item.id) === opcion);
    if (elegido) setPlazo(String(elegido.plazo));
  };

  const onPlazoNumero = (texto: string) => {
    const limpio = texto.replace(/[^\d]/g, '');
    setPlazo(limpio);
    const coincidencia = plazosMeses.find((item) => String(item.plazo) === limpio);
    setPlazoOpcion(coincidencia ? String(coincidencia.id) : limpio ? 'otro' : '');
  };

  const onFianza = (value: string) => {
    setIdFianza(value);
    const siguiente = fianzas.find((item) => String(item.id) === value);
    const unicas = siguiente?.calificaciones ?? [];
    setIdCalificacion(unicas.length === 1 && unicas[0].id ? String(unicas[0].id) : '');
  };

  const cuotaTexto = calculating
    ? 'Calculando...'
    : simulation
      ? formatMoney(simulation.resumen.cuotaEstimada)
      : '';

  return (
    <section className="sim-view">
      <header className="sim-heading">
        <div>
          <span className="section-kicker">Créditos</span>
          <h2>Simulación</h2>
          <p>Usa el mismo motor del portal. La cuota se recalcula con la línea, el plazo, el valor y el porcentaje de la calificación de la fianza.</p>
        </div>
      </header>

      {catalogError && <p className="sim-alert">{catalogError}</p>}

      <form className="sim-card" onSubmit={(event) => event.preventDefault()}>
        <div className="sim-grid">
          <label className="sim-field">
            <span>Empresa</span>
            <select value={idEmpresa} onChange={(event) => setIdEmpresa(event.target.value)} disabled={loadingCatalogs}>
              <option value="">{loadingCatalogs ? 'Cargando empresas...' : 'Selecciona una empresa'}</option>
              {empresas.map((empresa) => (
                <option key={empresa.id} value={empresa.id}>{empresa.razonSocial}</option>
              ))}
            </select>
          </label>

          <label className="sim-field">
            <span>Línea de crédito</span>
            <select value={idLinea} onChange={(event) => setIdLinea(event.target.value)} disabled={loadingLineas || lineas.length === 0}>
              <option value="">{loadingLineas ? 'Cargando líneas...' : lineas.length === 0 ? 'No hay líneas disponibles' : 'Selecciona una línea'}</option>
              {lineas.map((item) => (
                <option key={item.id} value={item.id}>{item.nombre}</option>
              ))}
            </select>
          </label>

          <label className="sim-field">
            <span>Plazo</span>
            <div className="sim-plazo">
              <select value={plazoOpcion} onChange={(event) => onPlazoCatalogo(event.target.value)} aria-label="Plazo del catálogo">
                <option value="">Selecciona un plazo</option>
                {plazosMeses.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.plazo} meses{item.descripcion ? ` · ${item.descripcion}` : ''}
                  </option>
                ))}
                <option value="otro">Otro plazo</option>
              </select>
              <input
                type="text"
                inputMode="numeric"
                value={plazo}
                onChange={(event) => onPlazoNumero(event.target.value)}
                placeholder="Meses"
                aria-label="Plazo en meses"
              />
            </div>
          </label>

          <label className="sim-field">
            <span>Tipo de fianza</span>
            <select value={idFianza} onChange={(event) => onFianza(event.target.value)} disabled={loadingCatalogs}>
              <option value="">Selecciona un tipo de fianza</option>
              {fianzas.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.nombre}{item.calificaciones.length === 1 ? ` · ${formatPercent(item.calificaciones[0].porcentaje)}` : ''}
                </option>
              ))}
            </select>
          </label>

          {calificaciones.length > 1 && (
            <label className="sim-field">
              <span>Calificación de la fianza</span>
              <select value={idCalificacion} onChange={(event) => setIdCalificacion(event.target.value)}>
                <option value="">Selecciona una calificación</option>
                {calificaciones.map((item) => (
                  <option key={item.id ?? item.letra} value={item.id}>
                    {item.letra} · {formatPercent(item.porcentaje)}
                  </option>
                ))}
              </select>
            </label>
          )}

          <label className="sim-field">
            <span>Valor</span>
            <input
              type="text"
              inputMode="decimal"
              value={valor}
              onChange={(event) => setValor(event.target.value.replace(/[^\d]/g, ''))}
              placeholder="Mayor a 0"
              aria-label="Valor solicitado"
            />
            {linea && (linea.montoMinimo != null || linea.montoMaximo != null) && (
              <small>
                Rango de la línea: {linea.montoMinimo != null ? formatMoney(linea.montoMinimo) : 'sin mínimo'}
                {' – '}
                {linea.montoMaximo != null ? formatMoney(linea.montoMaximo) : 'sin máximo'}
              </small>
            )}
          </label>

          <label className="sim-field">
            <span>Cuota</span>
            <input
              readOnly
              value={cuotaTexto}
              placeholder="Se calcula con el porcentaje de la calificación"
              aria-label="Cuota calculada"
            />
            {calificacion && porcentajeCalificacion > 0 && (
              <small>
                {fianza?.nombre}
                {calificacion.letra ? ` · ${calificacion.letra}` : ''}
                {' · '}
                {formatPercent(porcentajeCalificacion)} sobre el capital financiado
              </small>
            )}
          </label>
        </div>
        {calcError && <p className="sim-alert">{calcError}</p>}
        {!calcError && valor !== '' && monto <= 0 && <p className="sim-alert">El valor debe ser mayor a cero.</p>}
        {!calcError && calificacion && !(porcentajeCalificacion > 0) && <p className="sim-alert">La calificación seleccionada no tiene un porcentaje mayor a cero.</p>}
      </form>

      {simulation && (
        <>
          <div className="sim-summary">
            <article><span>Capital financiado</span><strong>{formatMoney(simulation.resumen.valorCredito)}</strong></article>
            <article><span>Cargos financiados</span><strong>{formatMoney(simulation.resumen.cargosFinanciados)}</strong></article>
            <article><span>Cuota</span><strong>{formatMoney(simulation.resumen.cuotaEstimada)}</strong></article>
            <article><span>Intereses</span><strong>{formatMoney(simulation.resumen.totalIntereses)}</strong></article>
            <article><span>Total a pagar</span><strong>{formatMoney(simulation.resumen.totalPagar)}</strong></article>
            <article><span>Tasa mensual</span><strong>{formatPercent(simulation.resumen.tasaMensual)}</strong></article>
          </div>

          <section className="sim-card">
            <h3>Desglose del crédito</h3>
            <div className="sim-table-wrap">
              <table className="sim-table">
                <thead>
                  <tr>
                    <th>Concepto</th>
                    <th>Aplicación</th>
                    <th>Porcentaje / valor</th>
                    <th>Valor calculado</th>
                  </tr>
                </thead>
                <tbody>
                  {simulation.atributos.map((item) => (
                    <tr key={item.id}>
                      <td>
                        <strong>{item.nombre}</strong>
                        {item.aplicaIva ? <small>IVA incluido</small> : null}
                      </td>
                      <td>{item.sumaAlCredito ? 'Al crédito' : item.sumaALaCuota ? 'A la cuota' : item.esDescuento ? 'Descuento al desembolso' : item.tipoAtributo}</td>
                      <td>{item.porcentaje != null ? formatPercent(item.porcentaje) : item.valor != null ? formatMoney(item.valor) : '—'}</td>
                      <td>{formatMoney(item.valorCalculado)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="sim-card">
            <h3>Plan de amortización</h3>
            <p className="sim-note">{simulation.plan.length} cuotas · valores estimados con la configuración actual de la línea.</p>
            <div className="sim-table-wrap sim-plan">
              <table className="sim-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Saldo inicial</th>
                    <th>Capital</th>
                    <th>Interés</th>
                    <th>Cargos</th>
                    <th>Cuota</th>
                    <th>Saldo final</th>
                  </tr>
                </thead>
                <tbody>
                  {simulation.plan.map((row) => (
                    <tr key={row.numero}>
                      <td>{row.numero}</td>
                      <td>{formatMoney(row.saldoInicial)}</td>
                      <td>{formatMoney(row.capital)}</td>
                      <td>{formatMoney(row.interes)}</td>
                      <td>{formatMoney(row.cargos)}</td>
                      <td>{formatMoney(row.cuota)}</td>
                      <td>{formatMoney(row.saldoFinal)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </section>
  );
};
