import { createServerFn } from "@tanstack/react-start";

/** Which "Continue with …" buttons the sign-in screen should show. No auth needed. */
export const getSignInOptions = createServerFn({ method: "GET" }).handler(async () => {
  const { directSocialProviders } = await import("./server");
  return { google: directSocialProviders.google, apple: directSocialProviders.apple };
});
