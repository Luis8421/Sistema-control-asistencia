const ExcelJS = require("exceljs");

/**
 * Genera un .xlsx con el listado de marcaciones y lo escribe directo en la
 * respuesta HTTP (sin guardar archivo temporal en disco).
 */
async function generarExcelMarcaciones(registros, res) {
  const workbook = new ExcelJS.Workbook();
  const hoja = workbook.addWorksheet("Marcaciones");

  hoja.columns = [
    { header: "Fecha/Hora", key: "fecha", width: 20 },
    { header: "Empleado", key: "empleado", width: 30 },
    { header: "Codigo", key: "codigo", width: 12 },
    { header: "Geocerca", key: "geocerca", width: 22 },
    { header: "Tipo", key: "tipo", width: 10 },
    { header: "Distancia (m)", key: "distancia", width: 14 },
    { header: "Valido", key: "valido", width: 10 },
    { header: "Motivo invalido", key: "motivo", width: 22 },
  ];
  hoja.getRow(1).font = { bold: true };

  for (const r of registros) {
    hoja.addRow({
      fecha: r.timestamp_servidor,
      empleado: r.nombre_completo,
      codigo: r.codigo_empleado,
      geocerca: r.bodega_nombre,
      tipo: r.tipo,
      distancia: Math.round(r.distancia_a_bodega_m),
      valido: r.valido ? "Si" : "No",
      motivo: r.motivo_invalido || "",
    });
  }

  res.setHeader(
    "Content-Type",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  );
  res.setHeader("Content-Disposition", 'attachment; filename="marcaciones.xlsx"');

  await workbook.xlsx.write(res);
  res.end();
}

module.exports = { generarExcelMarcaciones };
