const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { validarSecuenciaDelDia } = require("../src/utils/secuenciaMarcaje");

describe("validarSecuenciaDelDia", () => {
  it("primera entrada del dia (sin marcajes previos) -> valido", () => {
    const r = validarSecuenciaDelDia(null, "entrada");
    assert.equal(r.valido, true);
  });

  it("salida despues de una entrada -> valido", () => {
    const r = validarSecuenciaDelDia("entrada", "salida");
    assert.equal(r.valido, true);
  });

  it("segunda entrada sin salida previa -> invalido, entrada_duplicada", () => {
    const r = validarSecuenciaDelDia("entrada", "entrada");
    assert.equal(r.valido, false);
    assert.equal(r.motivo, "entrada_duplicada");
  });

  it("salida sin haber marcado entrada -> invalido, salida_sin_entrada", () => {
    const r = validarSecuenciaDelDia(null, "salida");
    assert.equal(r.valido, false);
    assert.equal(r.motivo, "salida_sin_entrada");
  });

  it("segunda salida seguida -> invalido, salida_duplicada", () => {
    const r = validarSecuenciaDelDia("salida", "salida");
    assert.equal(r.valido, false);
    assert.equal(r.motivo, "salida_duplicada");
  });

  it("nueva entrada despues de completar entrada+salida -> valido (nuevo ciclo)", () => {
    const r = validarSecuenciaDelDia("salida", "entrada");
    assert.equal(r.valido, true);
  });
});
