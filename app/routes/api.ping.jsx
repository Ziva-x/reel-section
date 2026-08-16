import { json } from "@remix-run/node";

export const loader = async () => {
  return json(
    { status: "alive", message: "Anti-sleep ping successful", timestamp: new Date().toISOString() },
    {
      headers: {
        "Cache-Control": "no-store, max-age=0", // Ensure Render doesn't cache the response
      },
    }
  );
};
