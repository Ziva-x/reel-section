import { useEffect } from "react";

export default function LiveChatWidget({ shop = "" }) {
  useEffect(() => {
    if (typeof window === "undefined") return;

    window.$crisp = window.$crisp || [];
    window.CRISP_WEBSITE_ID = "db4b59b8-f965-4675-9a5d-9c2513f7a6f0";

    // Attach store identification to Crisp session
    if (shop) {
      const cleanName = shop.replace(".myshopify.com", "");
      window.$crisp.push(["set", "user:nickname", [cleanName]]);
      window.$crisp.push([
        "set",
        "session:data",
        [
          [
            ["store", shop],
            ["shop_domain", shop],
          ],
        ],
      ]);
    }

    // Inject Crisp script only once
    if (!document.getElementById("crisp-live-chat-script")) {
      const d = document;
      const s = d.createElement("script");
      s.id = "crisp-live-chat-script";
      s.src = "https://client.crisp.chat/l.js";
      s.async = 1;
      d.getElementsByTagName("head")[0].appendChild(s);
    }
  }, [shop]);

  return null; // Crisp renders its own ultra-sleek floating chat widget
}
