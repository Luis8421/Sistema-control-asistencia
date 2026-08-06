const PDFDocument = require("pdfkit");

const COLUMNAS = [
  { key: "fecha", label: "Fecha", x: 40, width: 90 },
  { key: "entrada", label: "Entrada", x: 130, width: 60 },
  { key: "salida", label: "Salida", x: 190, width: 60 },
  { key: "atraso", label: "Atraso", x: 250, width: 60 },
  { key: "horas", label: "Horas", x: 310, width: 60 },
  { key: "estado", label: "Estado", x: 370, width: 90 },
];
const ALTO_FILA = 16;
const Y_LIMITE_PAGINA = 760;

function dibujarFila(doc, y, valores, negrita) {
  doc.font(negrita ? "Helvetica-Bold" : "Helvetica");
  for (const col of COLUMNAS) {
    doc.text(valores[col.key] ?? "-", col.x, y, { width: col.width, lineBreak: false });
  }
}

/**
 * Genera un PDF con el resumen + detalle diario de indicadores de un
 * empleado (mismo objeto que devuelve GET /api/indicadores/:empleadoId) y
 * lo escribe directo en la respuesta HTTP.
 */
function generarPdfIndicadores(data, res) {
  const doc = new PDFDocument({ margin: 40, size: "A4" });

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="indicadores-${data.empleado.codigoEmpleado}.pdf"`
  );
  doc.pipe(res);

  doc.fontSize(16).font("Helvetica-Bold").text("Reporte de indicadores de asistencia", { align: "center" });
  doc.moveDown();

  doc.fontSize(11).font("Helvetica");
  doc.text(`Empleado: ${data.empleado.nombreCompleto} (${data.empleado.codigoEmpleado})`);
  doc.text(`Periodo: ${data.rango.desde} a ${data.rango.hasta}`);
  doc.moveDown();

  doc.fontSize(12).font("Helvetica-Bold").text("Resumen");
  doc.fontSize(10).font("Helvetica");
  doc.text(`Dias laborables: ${data.diasLaborables}`);
  doc.text(`Dias trabajados: ${data.diasTrabajados}`);
  doc.text(`Dias con atraso: ${data.diasConAtraso} (promedio ${data.minutosAtrasoPromedio} min)`);
  doc.text(`Ausencias: ${data.diasAusente}`);
  doc.text(`Horas trabajadas: ${data.horasTrabajadas} h`);
  doc.moveDown();

  doc.fontSize(12).font("Helvetica-Bold").text("Detalle diario");
  doc.moveDown(0.3);

  let y = doc.y;
  doc.fontSize(9);
  dibujarFila(doc, y, { fecha: "Fecha", entrada: "Entrada", salida: "Salida", atraso: "Atraso", horas: "Horas", estado: "Estado" }, true);
  y += ALTO_FILA;

  if (data.detallePorDia.length === 0) {
    doc.font("Helvetica").text("Sin marcaciones validas en el rango seleccionado.", 40, y);
  }

  for (const d of data.detallePorDia) {
    if (y > Y_LIMITE_PAGINA) {
      doc.addPage();
      y = 40;
    }
    dibujarFila(doc, y, {
      fecha: d.fecha,
      entrada: d.horaEntrada,
      salida: d.horaSalida || "-",
      atraso: d.minutosAtraso > 0 ? `${d.minutosAtraso} min` : "-",
      horas: d.horasTrabajadas !== null ? `${d.horasTrabajadas.toFixed(2)} h` : "-",
      estado: d.estado === "atrasado" ? "Atrasado" : "A tiempo",
    });
    y += ALTO_FILA;
  }

  doc.end();
}

module.exports = { generarPdfIndicadores };
