# Welcome to your Expo app 👋

This is an [Expo](https://expo.dev) project created with [`create-expo-app`](https://www.npmjs.com/package/create-expo-app).

## Get started

1. Install dependencies

   ```bash
   npm install
   ```

2. Start the app

   ```bash
   npx expo start
   ```

In the output, you'll find options to open the app in a

- [development build](https://docs.expo.dev/develop/development-builds/introduction/)
- [Android emulator](https://docs.expo.dev/workflow/android-studio-emulator/)
- [iOS simulator](https://docs.expo.dev/workflow/ios-simulator/)
- [Expo Go](https://expo.dev/go), a limited sandbox for trying out app development with Expo

You can start developing by editing the files inside the **app** directory. This project uses [file-based routing](https://docs.expo.dev/router/introduction).

## Get a fresh project

When you're ready, run:

```bash
npm run reset-project
```

This command will move the starter code to the **app-example** directory and create a blank **app** directory where you can start developing.

### Other setup steps

- To set up ESLint for linting, run `npx expo lint`, or follow our guide on ["Using ESLint and Prettier"](https://docs.expo.dev/guides/using-eslint/)
- If you'd like to set up unit testing, follow our guide on ["Unit Testing with Jest"](https://docs.expo.dev/develop/unit-testing/)
- Learn more about the TypeScript setup in this template in our guide on ["Using TypeScript"](https://docs.expo.dev/guides/typescript/)

## Learn more

To learn more about developing your project with Expo, look at the following resources:

- [Expo documentation](https://docs.expo.dev/): Learn fundamentals, or go into advanced topics with our [guides](https://docs.expo.dev/guides).
- [Learn Expo tutorial](https://docs.expo.dev/tutorial/introduction/): Follow a step-by-step tutorial where you'll create a project that runs on Android, iOS, and the web.

## Join the community

Join our community of developers creating universal apps.

- [Expo on GitHub](https://github.com/expo/expo): View our open source platform and contribute.
- [Discord community](https://chat.expo.dev): Chat with Expo users and ask questions.

## Lectura NFC (`src/lib/nfc`)

El lector real usa `react-native-nfc-manager` (lee `tag.id` con NfcA, sin
autenticar MIFARE Classic). Usa codigo nativo, así que **Expo Go no sirve**:
hace falta un *development build*.

### Compilar el development build (Android)

Requisitos: Android SDK/JDK configurados y un telefono con NFC y depuracion USB.

```bash
cd frontend
npm install
npx expo run:android      # genera android/ (no se commitea) y lo instala
npx expo start --dev-client
```

Alternativa sin Android SDK local: EAS Build
(`npx eas build --profile development --platform android`, requiere cuenta de
Expo y un `eas.json` con un perfil `development` con `developmentClient: true`).

Despues de cambiar `app.json` (plugins/permisos) o dependencias nativas hay que
volver a compilar el build. `android/` e `ios/` los genera Expo (prebuild);
no se suben al repo.

### Probar sin tarjeta (lector simulado)

Con `EXPO_PUBLIC_NFC_MOCK=1` (por ejemplo en `.env.local` o al arrancar:
`EXPO_PUBLIC_NFC_MOCK=1 npx expo start`) `getNfcReader()` devuelve
`MockNfcReader`, que responde `04A1B2C3` o el UID fijado con `setNextUid()`.
La variable se inlinea al compilar el bundle: reinicia Metro con `--clear` al
cambiarla.

Pantalla de prueba solo para desarrollo: `/dev/nfc-test` (no esta enlazada
desde la navegacion; abrela con la URL del dev client).

### Pruebas

```bash
npm test             # jest-expo, con la libreria NFC simulada
npx tsc --noEmit
```

### Limitaciones

- Solo Android esta verificado. En otras plataformas `readUid()` falla con
  `unavailable`.
- **iOS no esta verificado para MIFARE Classic**: iOS (CoreNFC) no expone NfcA ni
  la lectura de tarjetas MIFARE Classic como Android, y el plugin de la libreria
  agrega el entitlement NFC de iOS, que exige una cuenta de desarrollador de
  pago para firmar.
