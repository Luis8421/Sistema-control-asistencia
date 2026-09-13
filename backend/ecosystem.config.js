// Configuracion de PM2 para produccion (VPS). Uso:
//   pm2 start ecosystem.config.js
//   pm2 save
//   pm2 startup   (sigue las instrucciones que imprime, una sola vez)
//
// Con esto el backend se reinicia solo si Node se cae, y vuelve a
// arrancar solo despues de reiniciar el VPS (una vez configurado
// pm2 startup + pm2 save).
module.exports = {
  apps: [
    {
      name: "asistencia-backend",
      script: "src/server.js",
      cwd: __dirname,
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "300M",
      env: {
        NODE_ENV: "production",
      },
      out_file: "logs/out.log",
      error_file: "logs/error.log",
      time: true,
    },
  ],
};
