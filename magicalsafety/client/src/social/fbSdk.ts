// Facebook JS SDK, loaded ONLY when VITE_FB_APP_ID is set. Without it the app never contacts Facebook.
//
// TODO(USER): Create a Meta (Facebook) app with the Facebook Login product, add http://localhost:5173 and your demo domain
//             to App Domains and Valid OAuth Redirect URIs, keep it in Development mode and add demo accounts as Testers.
//             Then set VITE_FB_APP_ID in magicalsafety/.env (it is public, not a secret) and FB_APP_SECRET (server-only).
// TODO(VERIFY): The Graph API version passed to FB.init is a default; set VITE_FB_GRAPH_VERSION to the version your app uses.

interface FbApi {
  init(o: { appId: string; version: string; cookie: boolean; xfbml: boolean }): void;
  login(cb: (r: { authResponse?: { accessToken: string } | null }) => void, o: { scope: string }): void;
  ui(o: { method: "share"; href: string }, cb?: (r: unknown) => void): void;
}
declare global { interface Window { FB?: FbApi; fbAsyncInit?: () => void } }

export const FB_APP_ID = (import.meta.env.VITE_FB_APP_ID as string | undefined)?.trim() || undefined;
export const fbConfigured = () => !!FB_APP_ID;

let loading: Promise<FbApi> | null = null;
export function loadFb(): Promise<FbApi> {
  if (!FB_APP_ID) return Promise.reject(new Error("Facebook isn't configured."));
  loading ??= new Promise<FbApi>((resolve, reject) => {
    window.fbAsyncInit = () => {
      window.FB!.init({ appId: FB_APP_ID!, version: (import.meta.env.VITE_FB_GRAPH_VERSION as string | undefined) ?? "v21.0", cookie: false, xfbml: false });
      resolve(window.FB!);
    };
    const s = document.createElement("script");
    s.src = "https://connect.facebook.net/en_US/sdk.js";
    s.async = true;
    s.onerror = () => { loading = null; reject(new Error("Facebook couldn't be loaded. An ad or tracking blocker may be stopping it.")); };
    document.head.appendChild(s);
  });
  return loading;
}

/** Login with `public_profile` only. Returns an access token, which the server verifies before trusting anything. */
export async function fbLogin(): Promise<string> {
  const FB = await loadFb();
  return new Promise((resolve, reject) => FB.login((r) => (r.authResponse?.accessToken ? resolve(r.authResponse.accessToken) : reject(new Error("Facebook login was cancelled."))), { scope: "public_profile" }));
}

/** The Share Dialog needs no permission beyond the app id. */
export async function fbShare(href: string): Promise<void> {
  const FB = await loadFb();
  return new Promise((resolve) => FB.ui({ method: "share", href }, () => resolve()));
}
