# Reportes de cobradores

App web para que los cobradores carguen reportes desde el telefono y el administrador los vea, edite, filtre y exporte.

## Cuentas

- Cobrador: puede cargar reportes sin clave.
- Administrador: entra con la clave definida en `ADMIN_PASSWORD`.

## Subir a Render

1. Subir esta carpeta a un repositorio de GitHub.
2. En Render, crear un nuevo Blueprint o Web Service usando esta carpeta como root directory:
   `app-reportes-cobradores`
3. Configurar el comando de build:
   `npm install`
4. Configurar el comando de inicio:
   `npm start`
5. Agregar la variable de entorno:
   `ADMIN_PASSWORD`
6. Agregar una base PostgreSQL y conectar su `DATABASE_URL` al servicio.

El archivo `render.yaml` ya deja preparado el servicio web y la base de datos para usar Blueprint.

## Local

Si se abre `index.html` directamente, la app sigue funcionando con datos guardados en ese navegador.

Si se ejecuta con servidor Node:

```bash
npm install
npm start
```

Luego abrir:

```text
http://localhost:10000
```
