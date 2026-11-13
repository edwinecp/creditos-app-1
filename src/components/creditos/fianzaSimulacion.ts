import { calcularProducto, type AtributoCalculo } from './calculo-producto';
import {
  api,
  type FormulaCalculoRow,
  type ParametroFinancieroRow,
  type ProductoAtributoRow,
  type SimulacionCredito
} from '../../api';

export type FianzaAplicada = {
  id: number;
  nombre: string;
  idCalificacion: number;
  letra: string;
  porcentaje: number;
};

const contextoCache = new Map<string, Promise<{
  atributos: ProductoAtributoRow[];
  formulas: FormulaCalculoRow[];
  smlmv: number;
  iva: number;
}>>();

const clave = (nombre: string) => nombre.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
const esFianza = (nombre: string) => {
  const texto = clave(nombre);
  return texto.includes('FIANZA') && !texto.includes('INTERES');
};
const cerca = (a: number, b: number) => Math.abs(a - b) < 0.0001;
const money = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

function hoyIso() {
  const ahora = new Date();
  const mes = String(ahora.getMonth() + 1).padStart(2, '0');
  const dia = String(ahora.getDate()).padStart(2, '0');
  return `${ahora.getFullYear()}-${mes}-${dia}`;
}

function parametroVigente(rows: ParametroFinancieroRow[], codigo: string) {
  const hoy = hoyIso();
  const vigente = rows
    .filter((row) => row.activo && row.codigo === codigo && row.vigenciaDesde.slice(0, 10) <= hoy && (!row.vigenciaHasta || row.vigenciaHasta.slice(0, 10) >= hoy))
    .sort((a, b) => b.vigenciaDesde.localeCompare(a.vigenciaDesde))[0];
  return vigente ? Number(vigente.valor) : null;
}

function formulaDe(formulas: FormulaCalculoRow[], atributo: ProductoAtributoRow) {
  return formulas.find((item) => item.id === atributo.idTipoCalculo)
    ?? formulas.find((item) => item.nombre === atributo.tipoCalculo);
}

function fila(atributo: ProductoAtributoRow, formula?: FormulaCalculoRow): AtributoCalculo {
  return {
    id_producto_atributo: atributo.id,
    nombre: atributo.nombre,
    tipo_atributo: atributo.tipoAtributo,
    tipo_calculo: formula?.nombre ?? atributo.tipoCalculo,
    valor: atributo.valor,
    porcentaje: atributo.porcentaje,
    valor2: atributo.valor2,
    minimo: atributo.minimo,
    maximo: atributo.maximo,
    aplica_iva: atributo.aplicaIva,
    obligatorio: atributo.obligatorio,
    prioridad: atributo.prioridad,
    modo_calculo: atributo.modoCalculo ?? null,
    tipo_limite: atributo.tipoLimite ?? 'MONTO',
    formula_codigo: formula?.codigo ?? null,
    base_calculo: formula?.baseCalculo ?? null,
    operacion: formula?.operacion ?? null,
    expresion: formula?.expresion ?? null,
    aplica_minimo: formula?.aplicaMinimo ?? null,
    aplica_maximo: formula?.aplicaMaximo ?? null,
    multiplica_por_plazo: formula?.multiplicaPorPlazo ?? null,
    requiere_valor: formula?.requiereValor ?? null,
    requiere_valor2: formula?.requiereValor2 ?? null,
    requiere_porcentaje: formula?.requierePorcentaje ?? null
  };
}

function aplicarPorcentaje(rows: AtributoCalculo[], porcentaje: number, nombre: string) {
  const destino = rows.find((row) => esFianza(row.nombre));
  const aplicar = (row: AtributoCalculo) => {
    row.porcentaje = porcentaje;
    row.valor = null;
    row.valor2 = null;
    row.modo_calculo = 'PORCENTAJE';
    row.operacion = 'PORCENTAJE';
    row.expresion = null;
    row.formula_codigo = 'PORCENTAJE';
    row.tipo_calculo = 'PORCENTAJE';
    row.base_calculo = 'VALOR_CREDITO';
    row.requiere_porcentaje = true;
    row.requiere_valor = false;
    row.requiere_valor2 = false;
  };
  if (destino) {
    aplicar(destino);
    return;
  }
  rows.push({
    id_producto_atributo: -1,
    nombre,
    tipo_atributo: 'CREDITO',
    tipo_calculo: 'PORCENTAJE',
    formula_codigo: 'PORCENTAJE',
    base_calculo: 'VALOR_CREDITO',
    operacion: 'PORCENTAJE',
    expresion: null,
    valor: null,
    porcentaje,
    valor2: null,
    minimo: null,
    maximo: null,
    aplica_iva: false,
    obligatorio: true,
    prioridad: 40,
    modo_calculo: 'PORCENTAJE',
    tipo_limite: 'MONTO',
    aplica_minimo: false,
    aplica_maximo: false,
    multiplica_por_plazo: false,
    requiere_valor: false,
    requiere_valor2: false,
    requiere_porcentaje: true
  });
}

function porcentajeYaAplicado(simulation: SimulacionCredito, porcentaje: number) {
  if (simulation.fianzaAplicada && cerca(simulation.fianzaAplicada.porcentaje, porcentaje)) return true;
  const atributo = simulation.atributos.find((item) => esFianza(item.nombre));
  return Boolean(
    atributo
    && atributo.modoCalculo !== 'FORMULA'
    && atributo.porcentaje != null
    && cerca(atributo.porcentaje, porcentaje)
  );
}

function installment(principal: number, rate: number, months: number) {
  return rate === 0 ? principal / months : principal * rate / (1 - Math.pow(1 + rate, -months));
}

function ajustarSobreSimulacion(simulation: SimulacionCredito, fianza: FianzaAplicada): SimulacionCredito {
  const capitalInicial = simulation.resumen.valorCredito;
  const monto = simulation.resumen.montoSolicitado;
  const atributos = simulation.atributos.map((item) => ({ ...item }));
  const actual = atributos.find((item) => esFianza(item.nombre) && item.sumaAlCredito)
    ?? atributos.find((item) => esFianza(item.nombre));
  const porcentajeAnterior = actual?.porcentaje ?? 0;
  const valorAnterior = actual?.valorCalculado ?? 0;
  const factorIva = porcentajeAnterior > 0 && capitalInicial > 0
    ? valorAnterior / (capitalInicial * porcentajeAnterior / 100)
    : actual?.aplicaIva ? 1.19 : 1;
  const tasaFianza = (fianza.porcentaje / 100) * (Number.isFinite(factorIva) && factorIva > 0 ? factorIva : 1);
  if (tasaFianza >= 1) return { ...simulation, fianzaAplicada: fianza };
  const otrosCargos = simulation.resumen.cargosFinanciados - (actual?.sumaAlCredito ? valorAnterior : 0);
  const valorCredito = money((monto + otrosCargos) / (1 - tasaFianza));
  const valorFianza = money(valorCredito * tasaFianza);
  if (actual) {
    actual.porcentaje = fianza.porcentaje;
    actual.valor = null;
    actual.modoCalculo = 'PORCENTAJE';
    actual.valorCalculado = valorFianza;
  } else {
    atributos.push({
      id: -1,
      nombre: `Fianza ${fianza.nombre}`,
      tipoAtributo: 'CREDITO',
      tipoCalculo: 'PORCENTAJE',
      valor: null,
      porcentaje: fianza.porcentaje,
      valorCalculado: valorFianza,
      aplicaIva: false,
      obligatorio: true,
      prioridad: 40,
      sumaALaCuota: false,
      sumaAlCredito: true,
      esDescuento: false,
      modoCalculo: 'PORCENTAJE'
    });
  }
  const cargosFinanciados = money(atributos.filter((item) => item.sumaAlCredito).reduce((total, item) => total + item.valorCalculado, 0));
  const rate = simulation.resumen.tasaMensual / 100;
  const plazo = simulation.resumen.plazo;
  const cuotaBase = money(installment(valorCredito, rate, plazo));
  const factorCargos = capitalInicial > 0 ? valorCredito / capitalInicial : 1;
  let saldo = valorCredito;
  const plan = Array.from({ length: plazo }, (_, index) => {
    const saldoInicial = saldo;
    const interes = money(saldo * rate);
    const capital = index === plazo - 1 ? saldo : Math.min(saldo, money(cuotaBase - interes));
    const cargos = money((simulation.plan[index]?.cargos ?? 0) * factorCargos);
    saldo = money(Math.max(0, saldo - capital));
    return { numero: index + 1, saldoInicial, capital, interes, cargos, cuota: money(capital + interes + cargos), saldoFinal: saldo };
  });
  const interes = atributos.find((item) => clave(item.nombre).includes('INTERES CORRIENTE'));
  if (interes && plan[0]) interes.valorCalculado = plan[0].interes;
  return {
    ...simulation,
    fianzaAplicada: fianza,
    resumen: {
      ...simulation.resumen,
      valorCredito,
      cargosFinanciados,
      cuotaBase,
      cargosPorCuota: plan[0]?.cargos ?? 0,
      cuotaEstimada: plan[0]?.cuota ?? cuotaBase,
      totalIntereses: money(plan.reduce((total, row) => total + row.interes, 0)),
      totalPagar: money(plan.reduce((total, row) => total + row.cuota, 0))
    },
    atributos,
    plan
  };
}

async function cargarContexto(token: string, productoId: number) {
  const key = `${productoId}`;
  let pending = contextoCache.get(key);
  if (!pending) {
    pending = Promise.all([
      api.listProductoAtributos(token, productoId),
      api.listProductosCreditoCatalogs(token),
      api.listParametrosFinancieros(token)
    ]).then(([atributos, catalogs, parametros]) => ({
      atributos,
      formulas: catalogs.tiposCalculo,
      smlmv: parametroVigente(parametros, 'SMLMV') ?? parametroVigente(parametros, 'SMMLV') ?? 0,
      iva: parametroVigente(parametros, 'IVA') ?? 0
    }));
    contextoCache.set(key, pending);
    pending.catch(() => contextoCache.delete(key));
  }
  return pending;
}

export async function incorporarPorcentajeCalificacion(
  token: string,
  simulation: SimulacionCredito,
  fianza: FianzaAplicada,
  productoId: number
): Promise<SimulacionCredito> {
  if (porcentajeYaAplicado(simulation, fianza.porcentaje)) {
    return { ...simulation, fianzaAplicada: simulation.fianzaAplicada ?? fianza };
  }
  try {
    const contexto = await cargarContexto(token, productoId);
    const rows = contexto.atributos.map((atributo) => fila(atributo, formulaDe(contexto.formulas, atributo)));
    aplicarPorcentaje(rows, fianza.porcentaje, `Fianza ${fianza.nombre}`);
    const calculo = calcularProducto(
      simulation.resumen.montoSolicitado,
      simulation.resumen.plazo,
      rows,
      contexto.smlmv,
      contexto.iva,
      simulation.resumen.tasaMensual
    );
    return {
      ...simulation,
      fianzaAplicada: fianza,
      resumen: calculo.resumen,
      atributos: calculo.atributos,
      plan: calculo.plan
    };
  } catch {
    return ajustarSobreSimulacion(simulation, fianza);
  }
}
