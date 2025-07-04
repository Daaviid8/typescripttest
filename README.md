## Uso de Cualquier Tester para TypeScript

1. **Compila el archivo TypeScript**:
   
   Primero, necesitas transpilar el archivo Typescript utilizando TypeScript Compiler (tsc):

   ```bash
   tsc <tester>.ts
   ```

2. **Ejecuta el Tester**:
   
   Luego, ejecuta el archivo generado de Javascript con Node.js, pasando el archivo TypeScript (`ejemplo.ts`) como entrada y generando un informe en formato HTML:

   ```bash
   node <tester>.js ejemplo.ts --output test-report --format html
   ```

Este procedimiento compilará tu archivo TypeScript y luego ejecutará las pruebas, generando un informe en HTML, json, txt...


3. **Opciones del Tester**:
   
   ##### Opciones Unity.ts:
- `-h, --help`: Muestra esta información de ayuda.
- `-o, --output <path>`: Ruta de salida para el informe de las pruebas.
- `-f, --format <format>`: Formato del informe: `json`, `html` o `text` (por defecto: `json`).
- `-i, --iterations <number>`: Número de iteraciones para las pruebas de rendimiento (por defecto: `100`).
- `-v, --verbose`: Habilita el registro detallado.

   ##### Opciones Integration.ts:
- `--output, -o <dir>`: Directorio donde guardar los informes de análisis.
- `--format, -f <format>`: Formato de salida (puede ser `text`, `html`, `dot`, o `json`).
- `--help, -h`: Muestra este mensaje de ayuda.
