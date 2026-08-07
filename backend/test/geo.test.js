const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { calcularDistanciaMetros, validarGeocerca } = require("../src/utils/geo");

// Bodega de referencia para la mayoria de los casos (coordenadas reales
// del seed del proyecto: "Oficina Principal", Quito).
const BODEGA = { latitud: -0.1807, longitud: -78.4678, radioMetros: 100 };
const PRECISION_OK = 10;
const MAX_PRECISION = 50;

/** Helper: llama a validarGeocerca contra BODEGA con valores por defecto
 * razonables, permitiendo sobreescribir solo lo que cada test necesita. */
function validar(overrides = {}) {
  return validarGeocerca({
    lat: BODEGA.latitud,
    lon: BODEGA.longitud,
    precisionM: PRECISION_OK,
    bodega: BODEGA,
    maxPrecisionAceptadaM: MAX_PRECISION,
    ubicacionSimulada: false,
    ...overrides,
  });
}

describe("calcularDistanciaMetros (Haversine)", () => {
  it("la misma coordenada da distancia 0", () => {
    assert.equal(calcularDistanciaMetros(-0.1807, -78.4678, -0.1807, -78.4678), 0);
  });

  it("valor de referencia conocido: 1 grado de latitud ~ 111,195 m", () => {
    // Circunferencia terrestre (radio 6,371,000 m) / 360 grados. Es el
    // mismo valor sin importar donde en el globo se mida (los meridianos
    // son circulos maximos), asi que sirve como "golden value" contra una
    // regresion en la constante del radio terrestre o en la formula.
    const distancia = calcularDistanciaMetros(0, 0, 1, 0);
    assert.ok(Math.abs(distancia - 111195) < 50, `esperaba ~111195 m, dio ${distancia}`);
  });

  it("cruce del antimeridiano da la distancia corta, no la vuelta larga", () => {
    // 179.9 y -179.9 estan a 0.2 grados de distancia real (cruzando la
    // linea de cambio de fecha), NO a ~359.8 grados. Si la formula no
    // manejara esto correctamente daria casi la mitad de la circunferencia
    // terrestre (~20,000 km) en vez de unos ~22 km.
    const distancia = calcularDistanciaMetros(0, 179.9, 0, -179.9);
    assert.ok(distancia < 30000, `esperaba una distancia corta (<30km), dio ${distancia} m`);
  });

  it("en el polo, distinta longitud da distancia ~0 (todas las longitudes convergen)", () => {
    const distancia = calcularDistanciaMetros(90, 0, 90, 180);
    assert.ok(distancia < 1, `esperaba ~0 m en el polo, dio ${distancia} m`);
  });

  it("antipodas: aprox. media circunferencia terrestre (~20,015 km)", () => {
    const distancia = calcularDistanciaMetros(0, 0, 0, 180);
    assert.ok(Math.abs(distancia - 20015086) < 1000, `esperaba ~20,015,086 m, dio ${distancia}`);
  });

  it("nunca devuelve una distancia negativa", () => {
    const casos = [
      [0, 0, 10, 10],
      [-45, 170, 45, -170],
      [89, 179, -89, -179],
    ];
    for (const [lat1, lon1, lat2, lon2] of casos) {
      const distancia = calcularDistanciaMetros(lat1, lon1, lat2, lon2);
      assert.ok(distancia >= 0, `distancia negativa para ${JSON.stringify([lat1, lon1, lat2, lon2])}: ${distancia}`);
    }
  });
});

describe("validarGeocerca — radio de la geocerca", () => {
  it("marcacion dentro del radio permitido -> valido", () => {
    // ~11m de distancia real (0.0001 grados de latitud), muy por debajo
    // del radio de 100m.
    const resultado = validar({ lat: BODEGA.latitud + 0.0001, lon: BODEGA.longitud });
    assert.equal(resultado.valido, true);
    assert.equal(resultado.motivo, null);
    assert.ok(resultado.distanciaM < BODEGA.radioMetros);
  });

  it("marcacion exactamente en el limite del radio -> valido (radio inclusivo)", () => {
    // Se construye el radio a partir de la distancia REAL entre dos
    // puntos (calculada por la misma funcion que se esta probando), para
    // que el limite sea exacto sin depender de conversiones manuales de
    // grados a metros.
    const puntoEmpleado = { lat: BODEGA.latitud + 0.001, lon: BODEGA.longitud + 0.0005 };
    const distanciaReal = calcularDistanciaMetros(puntoEmpleado.lat, puntoEmpleado.lon, BODEGA.latitud, BODEGA.longitud);
    const bodegaLimite = { ...BODEGA, radioMetros: distanciaReal };

    const resultado = validar({ lat: puntoEmpleado.lat, lon: puntoEmpleado.lon, bodega: bodegaLimite });

    assert.equal(resultado.valido, true, "la condicion es distancia > radio, asi que == radio debe ser valido");
    assert.equal(resultado.distanciaM, distanciaReal);
  });

  it("marcacion fuera del radio -> invalido, motivo fuera_de_rango", () => {
    // ~1.1km de distancia (0.01 grados de latitud), muy por encima del
    // radio de 100m.
    const resultado = validar({ lat: BODEGA.latitud + 0.01, lon: BODEGA.longitud });
    assert.equal(resultado.valido, false);
    assert.equal(resultado.motivo, "fuera_de_rango");
    assert.ok(resultado.distanciaM > BODEGA.radioMetros);
  });

  it("un metro apenas por encima del limite exacto -> invalido", () => {
    const puntoEmpleado = { lat: BODEGA.latitud + 0.001, lon: BODEGA.longitud };
    const distanciaReal = calcularDistanciaMetros(puntoEmpleado.lat, puntoEmpleado.lon, BODEGA.latitud, BODEGA.longitud);
    const bodegaLimite = { ...BODEGA, radioMetros: distanciaReal - 1 };

    const resultado = validar({ lat: puntoEmpleado.lat, lon: puntoEmpleado.lon, bodega: bodegaLimite });

    assert.equal(resultado.valido, false);
    assert.equal(resultado.motivo, "fuera_de_rango");
  });

  it("radio en cero: en el punto exacto de la bodega es valido", () => {
    const resultado = validar({ bodega: { ...BODEGA, radioMetros: 0 } });
    assert.equal(resultado.valido, true);
  });

  it("radio en cero: a cualquier distancia mayor a 0 es invalido", () => {
    const resultado = validar({
      lat: BODEGA.latitud + 0.0001,
      bodega: { ...BODEGA, radioMetros: 0 },
    });
    assert.equal(resultado.valido, false);
    assert.equal(resultado.motivo, "fuera_de_rango");
  });
});

describe("validarGeocerca — precision del GPS", () => {
  it("precision peor que el maximo aceptado -> invalido", () => {
    const resultado = validar({ precisionM: MAX_PRECISION + 1 });
    assert.equal(resultado.valido, false);
    assert.equal(resultado.motivo, "precision_insuficiente");
  });

  it("precision exactamente en el maximo aceptado -> valido (inclusivo)", () => {
    const resultado = validar({ precisionM: MAX_PRECISION });
    assert.equal(resultado.valido, true);
  });

  it("sin precisionM (undefined) -> invalido, motivo precision_invalida", () => {
    const resultado = validar({ precisionM: undefined });
    assert.equal(resultado.valido, false);
    assert.equal(resultado.motivo, "precision_invalida");
  });

  it("precisionM como texto (string) -> invalido", () => {
    const resultado = validar({ precisionM: "10" });
    assert.equal(resultado.valido, false);
    assert.equal(resultado.motivo, "precision_invalida");
  });

  it("precisionM = NaN -> invalido", () => {
    const resultado = validar({ precisionM: NaN });
    assert.equal(resultado.valido, false);
    assert.equal(resultado.motivo, "precision_invalida");
  });
});

describe("validarGeocerca — coordenadas del empleado", () => {
  it("coordenadas nulas -> invalido, motivo coordenadas_invalidas", () => {
    const resultado = validar({ lat: null, lon: null });
    assert.equal(resultado.valido, false);
    assert.equal(resultado.motivo, "coordenadas_invalidas");
    assert.equal(resultado.distanciaM, null);
  });

  it("coordenadas no numericas (string) -> invalido", () => {
    const resultado = validar({ lat: "no-es-numero", lon: BODEGA.longitud });
    assert.equal(resultado.valido, false);
    assert.equal(resultado.motivo, "coordenadas_invalidas");
  });

  it("latitud NaN -> invalido", () => {
    const resultado = validar({ lat: NaN });
    assert.equal(resultado.valido, false);
    assert.equal(resultado.motivo, "coordenadas_invalidas");
  });

  it("latitud fuera de rango geografico (>90) -> invalido", () => {
    const resultado = validar({ lat: 200 });
    assert.equal(resultado.valido, false);
    assert.equal(resultado.motivo, "coordenadas_invalidas");
  });

  it("longitud fuera de rango geografico (<-180) -> invalido", () => {
    const resultado = validar({ lon: -200 });
    assert.equal(resultado.valido, false);
    assert.equal(resultado.motivo, "coordenadas_invalidas");
  });

  it("latitud/longitud en los limites exactos (90, -180) -> validas geograficamente", () => {
    // No deben rechazarse por "coordenadas_invalidas": el polo norte y el
    // antimeridiano son ubicaciones reales. Aqui solo se comprueba que no
    // caen en el motivo de coordenadas invalidas (van a quedar fuera de
    // rango de la bodega, que es un motivo distinto).
    const resultado = validar({ lat: 90, lon: -180 });
    assert.notEqual(resultado.motivo, "coordenadas_invalidas");
  });

  it("coordenadas Infinity -> invalido", () => {
    const resultado = validar({ lat: Infinity });
    assert.equal(resultado.valido, false);
    assert.equal(resultado.motivo, "coordenadas_invalidas");
  });
});

describe("validarGeocerca — configuracion de la bodega", () => {
  it("radioMetros nulo -> invalido, motivo bodega_mal_configurada", () => {
    const resultado = validar({ bodega: { ...BODEGA, radioMetros: null } });
    assert.equal(resultado.valido, false);
    assert.equal(resultado.motivo, "bodega_mal_configurada");
    assert.equal(resultado.distanciaM, null);
  });

  it("radioMetros negativo -> invalido", () => {
    const resultado = validar({ bodega: { ...BODEGA, radioMetros: -50 } });
    assert.equal(resultado.valido, false);
    assert.equal(resultado.motivo, "bodega_mal_configurada");
  });

  it("bodega sin latitud/longitud (undefined) -> invalido", () => {
    const resultado = validar({ bodega: { latitud: undefined, longitud: undefined, radioMetros: 100 } });
    assert.equal(resultado.valido, false);
    assert.equal(resultado.motivo, "bodega_mal_configurada");
  });

  it("bodega con coordenadas no numericas -> invalido", () => {
    const resultado = validar({ bodega: { latitud: "norte", longitud: "oeste", radioMetros: 100 } });
    assert.equal(resultado.valido, false);
    assert.equal(resultado.motivo, "bodega_mal_configurada");
  });

  it("bodega null/undefined por completo -> invalido, no lanza excepcion", () => {
    assert.doesNotThrow(() => validar({ bodega: null }));
    const resultado = validar({ bodega: null });
    assert.equal(resultado.valido, false);
    assert.equal(resultado.motivo, "bodega_mal_configurada");
  });
});

describe("validarGeocerca — ubicacion simulada (mock location)", () => {
  it("mock location -> invalido, motivo gps_simulado, incluso estando dentro del radio", () => {
    const resultado = validar({ ubicacionSimulada: true });
    assert.equal(resultado.valido, false);
    assert.equal(resultado.motivo, "gps_simulado");
  });

  it("mock location tiene prioridad sobre precision insuficiente", () => {
    const resultado = validar({ ubicacionSimulada: true, precisionM: 999 });
    assert.equal(resultado.motivo, "gps_simulado");
  });
});

describe("validarGeocerca — prioridad entre validaciones", () => {
  it("bodega mal configurada se detecta antes que las coordenadas del empleado", () => {
    // Ambas cosas estan mal (bodega sin radio Y coordenadas del empleado
    // invalidas): el motivo reportado debe ser el de la bodega, porque es
    // un problema de configuracion que ningun reintento del empleado
    // puede arreglar.
    const resultado = validar({ lat: null, bodega: { ...BODEGA, radioMetros: null } });
    assert.equal(resultado.motivo, "bodega_mal_configurada");
  });

  it("un marcaje totalmente valido no tiene motivo de rechazo", () => {
    const resultado = validar();
    assert.equal(resultado.valido, true);
    assert.equal(resultado.motivo, null);
  });
});
