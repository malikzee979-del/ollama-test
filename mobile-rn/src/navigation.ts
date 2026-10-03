/**
 * Route map shared by all screens. Three phases mirror the Flutter app's
 * root switching: Setup (unconfigured), Auth (configured, logged out), and
 * Main (logged in). The active phase is chosen in App.tsx.
 */
export type RootStackParamList = {
  // Setup phase
  ServerSetup: undefined;
  // Auth phase
  Login: undefined;
  Signup: undefined;
  // Main phase
  Sessions: undefined;
  Chat: { sessionId: string; initialTitle: string };
};
