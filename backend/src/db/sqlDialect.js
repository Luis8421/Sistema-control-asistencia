function postgresSql(sql) {
  let converted = sql
    .replace(/date\('now',\s*'-5 hours'\)/gi, "(timezone('America/Guayaquil', now()))::date")
    .replace(/\bdate\(([\w.]+)\)/gi, "($1)::date")
    .replace(/\bdate\(\?\)/gi, "CAST(? AS date)")
    .replace(/\b((?:\w+\.)?(?:activo|valido|autorizado_todas_bodegas))\s*=\s*1\b/gi, "$1 = TRUE")
    .replace(/\b((?:\w+\.)?(?:activo|valido|autorizado_todas_bodegas))\s*=\s*0\b/gi, "$1 = FALSE")
    .replace(/\bLIKE\b/gi, "ILIKE");

  let position = 0;
  converted = converted.replace(/\?/g, () => `$${++position}`);
  return converted;
}

module.exports = { postgresSql };
