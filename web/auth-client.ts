import { usernameClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

// Same origin as the app, so no baseURL needed. usernameClient adds the user's handle to the session.
export const authClient = createAuthClient({ plugins: [usernameClient()] });
