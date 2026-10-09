const test = require("node:test");
const assert = require("node:assert/strict");
const jwt = require("jsonwebtoken");

process.env.JWT_SECRET = "auth-middleware-test-secret";
const { requiereAutenticacion } = require("../src/middleware/auth");

function requestFor(payload) {
  return {
    req: {
      headers: {
        authorization: `Bearer ${jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: "1h" })}`,
      },
    },
    res: {
      statusCode: 200,
      body: null,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(body) {
        this.body = body;
        return this;
      },
    },
  };
}

test("rechaza tokens antiguos de empleados emitidos sin PIN", () => {
  const { req, res } = requestFor({ id: "empleado-1", rol: "empleado" });
  let nextCalled = false;

  requiereAutenticacion(req, res, () => {
    nextCalled = true;
  });

  assert.equal(res.statusCode, 401);
  assert.equal(nextCalled, false);
});

test("acepta tokens nuevos de empleados con authVersion vigente", () => {
  const { req, res } = requestFor({ id: "empleado-1", rol: "empleado", authVersion: 2 });
  let nextCalled = false;

  requiereAutenticacion(req, res, () => {
    nextCalled = true;
  });

  assert.equal(res.statusCode, 200);
  assert.equal(req.usuario.authVersion, 2);
  assert.equal(nextCalled, true);
});

test("no revoca tokens antiguos de supervisor o administrador", () => {
  const { req, res } = requestFor({ id: "admin-1", rol: "admin" });
  let nextCalled = false;

  requiereAutenticacion(req, res, () => {
    nextCalled = true;
  });

  assert.equal(res.statusCode, 200);
  assert.equal(nextCalled, true);
});
