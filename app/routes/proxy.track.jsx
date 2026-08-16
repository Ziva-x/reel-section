import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export const loader = async ({ request }) => {
  return json({ ok: true });
};

export const action = async ({ request }) => {
  try {
    const { session } = await authenticate.public.appProxy(request);
    
    if (session) {
      // Record a view for this shop
      const today = new Date();
      today.setHours(0, 0, 0, 0); // Start of day for grouping
      
      const shop = session.shop;
      
      // Update or create a ViewCount record for today
      await prisma.viewCount.upsert({
        where: {
          shop_date: {
            shop,
            date: today,
          }
        },
        update: {
          count: {
            increment: 1
          }
        },
        create: {
          shop,
          date: today,
          count: 1
        }
      });
      
      // TODO: Handle Usage Billing here
      
      return json({ success: true }, { headers: { "Access-Control-Allow-Origin": "*" } });
    }
  } catch (error) {
    console.error("Proxy error:", error);
  }
  
  return json({ success: false }, { status: 400 });
};
