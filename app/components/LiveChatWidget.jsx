import { useEffect } from "react";

export default function LiveChatWidget({ shop = "" }) {
  useEffect(() => {
    if (typeof window === "undefined") return;

    window.Tawk_API = window.Tawk_API || {};
    window.Tawk_LoadStart = new Date();

    // Set visitor attributes so you know which store is messaging you
    if (shop) {
      window.Tawk_API.onLoad = function () {
        if (window.Tawk_API && typeof window.Tawk_API.setAttributes === "function") {
          window.Tawk_API.setAttributes(
            {
              Store: shop,
              Name: shop.replace(".myshopify.com", ""),
            },
            function (error) {
              if (error) console.error("Tawk attribute error:", error);
            }
          );
        }
      };
    }

    // Inject Tawk.to script only once
    if (!document.getElementById("tawk-live-chat-script")) {
      const s1 = document.createElement("script");
      s1.id = "tawk-live-chat-script";
      s1.async = true;
      s1.src = "https://embed.tawk.to/6a8210b57f692a1d48ab8018/1k0612htm";
      s1.charset = "UTF-8";
      s1.setAttribute("crossorigin", "*");
      document.head.appendChild(s1);
    }
  }, [shop]);

  return null; // Tawk.to renders its own native floating chat widget
}
