const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { clasificarResultadosBodega } = require("../src/utils/seleccionBodega");

const bodegaA = { id: "a", codigo: "AAA", nombre: "Bodega A" };
const bodegaB = { id: "b", codigo: "BBB", nombre: "Bodega B" };
const bodegaC = { id: "c", codigo: "CCC", nombre: "Bodega C" };

function valida(distanciaM) {
  return { valido: true, distanciaM, motivo: null };
}
function invalida(distanciaM, motivo = "fuera_de_rango") {
  return { valido: false, distanciaM, motivo };
}

describe("clasificarResultadosBodega", () => {
  it("una sola bodega, valida -> tipo unica", () => {
    const r = clasificarResultadosBodega([{ bodega: bodegaA, resultado: valida(10) }]);
    assert.equal(r.tipo, "unica");
    assert.equal(r.bodega, bodegaA);
  });

  it("una sola bodega, invalida -> tipo ninguna, la reporta como mas cercana", () => {
    const r = clasificarResultadosBodega([{ bodega: bodegaA, resultado: invalida(500) }]);
    assert.equal(r.tipo, "ninguna");
    assert.equal(r.masCercana.bodega, bodegaA);
  });

  it("dos bodegas validas al mismo tiempo -> tipo multiple, sin elegir ninguna", () => {
    const r = clasificarResultadosBodega([
      { bodega: bodegaA, resultado: valida(0) },
      { bodega: bodegaB, resultado: valida(0) },
    ]);
    assert.equal(r.tipo, "multiple");
    assert.equal(r.validas.length, 2);
    // No debe existir un campo "bodega" (que implicaria una eleccion automatica)
    assert.equal(r.bodega, undefined);
  });

  it("caso BOCQ/BDCQ: dos bodegas con distancia identica (0m, mismas coordenadas) -> multiple, se preservan ambas", () => {
    const r = clasificarResultadosBodega([
      { bodega: bodegaA, resultado: valida(0) },
      { bodega: bodegaB, resultado: valida(0) },
    ]);
    assert.equal(r.tipo, "multiple");
    const codigos = r.validas.map((v) => v.bodega.codigo).sort();
    assert.deepEqual(codigos, ["AAA", "BBB"]);
  });

  it("una valida entre varias invalidas -> la valida gana, sin importar distancia de las demas", () => {
    const r = clasificarResultadosBodega([
      { bodega: bodegaA, resultado: invalida(50) }, // mas cerca pero invalida
      { bodega: bodegaB, resultado: valida(2000) }, // mas lejos pero valida
    ]);
    assert.equal(r.tipo, "unica");
    assert.equal(r.bodega, bodegaB);
  });

  it("ninguna valida -> elige la de menor distancia entre las invalidas", () => {
    const r = clasificarResultadosBodega([
      { bodega: bodegaA, resultado: invalida(5000) },
      { bodega: bodegaB, resultado: invalida(200) },
      { bodega: bodegaC, resultado: invalida(900) },
    ]);
    assert.equal(r.tipo, "ninguna");
    assert.equal(r.masCercana.bodega, bodegaB);
  });

  it("ninguna valida, con distanciaM null mezclado (ej. coordenadas_invalidas) -> un numero real siempre gana sobre null", () => {
    const r = clasificarResultadosBodega([
      { bodega: bodegaA, resultado: invalida(null, "bodega_mal_configurada") },
      { bodega: bodegaB, resultado: invalida(300) },
    ]);
    assert.equal(r.tipo, "ninguna");
    assert.equal(r.masCercana.bodega, bodegaB);
  });

  it("todas con distanciaM null -> no revienta, devuelve la primera", () => {
    const r = clasificarResultadosBodega([
      { bodega: bodegaA, resultado: invalida(null, "bodega_mal_configurada") },
      { bodega: bodegaB, resultado: invalida(null, "coordenadas_invalidas") },
    ]);
    assert.equal(r.tipo, "ninguna");
    assert.equal(r.masCercana.bodega, bodegaA);
  });

  it("tres bodegas validas simultaneamente -> multiple con las 3", () => {
    const r = clasificarResultadosBodega([
      { bodega: bodegaA, resultado: valida(10) },
      { bodega: bodegaB, resultado: valida(5) },
      { bodega: bodegaC, resultado: valida(20) },
    ]);
    assert.equal(r.tipo, "multiple");
    assert.equal(r.validas.length, 3);
  });
});
