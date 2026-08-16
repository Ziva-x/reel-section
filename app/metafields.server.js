import prisma from "./db.server";

export async function syncTestimonialsToMetafields(admin, shop, hasPaidPlan = false, planName = null, isDeletion = false) {
  try {
    const allTestimonials = await prisma.testimonial.findMany({
      where: { shop },
      orderBy: { createdAt: "desc" },
    });

    const shopResponse = await admin.graphql(`#graphql
      query { shop { id } }
    `);
    const shopData = await shopResponse.json();
    const shopId = shopData.data?.shop?.id;
    if (!shopId) return;

    // Calculate monthly views for 1000 view free limit enforcement
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);

    const viewsThisMonth = await prisma.viewCount.aggregate({
      where: { shop, date: { gte: monthStart, lte: monthEnd } },
      _sum: { count: true },
    });
    const monthlyViews = viewsThisMonth._sum.count || 0;
    const isLimitReached = !hasPaidPlan && monthlyViews >= 1000;

    const planStatus = {
      isLimitReached,
      hasPaidPlan: !!hasPaidPlan,
      hasLifetime: !!hasPaidPlan,
      monthlyViews,
      monthlyLimit: 1000,
      plan: hasPaidPlan ? "pro" : "free",
      planName: planName || (hasPaidPlan ? "Monthly Pro" : "Free Starter"),
    };

    // Ensure Metafield Definitions exist with PUBLIC_READ access for Storefront Liquid
    const defs = [
      {
        name: "Video Testimonials Data",
        namespace: "video_testimonials",
        key: "data",
        type: "json",
        ownerType: "SHOP",
        access: { storefront: "PUBLIC_READ" },
      },
      {
        name: "Video Testimonials Plan Status",
        namespace: "video_testimonials",
        key: "plan_status",
        type: "json",
        ownerType: "SHOP",
        access: { storefront: "PUBLIC_READ" },
      },
    ];

    for (const def of defs) {
      try {
        await admin.graphql(
          `#graphql
          mutation CreateMetafieldDefinition($definition: MetafieldDefinitionInput!) {
            metafieldDefinitionCreate(definition: $definition) {
              createdDefinition { id }
              userErrors { field message code }
            }
          }`,
          { variables: { definition: def } }
        );
      } catch (defErr) {
        // Definition might already exist
      }
    }

    const metafieldsToSet = [
      {
        ownerId: shopId,
        namespace: "video_testimonials",
        key: "plan_status",
        type: "json",
        value: JSON.stringify(planStatus),
      }
    ];

    // CRITICAL: Protect against SQLite Ephemeral Wipes on Render.
    // Never push an empty array to Shopify UNLESS the user explicitly deleted everything.
    if (allTestimonials.length > 0 || isDeletion) {
      metafieldsToSet.push({
        ownerId: shopId,
        namespace: "video_testimonials",
        key: "data",
        type: "json",
        value: JSON.stringify(allTestimonials),
      });
    }

    // Set Metafields for data and plan status
    const syncResponse = await admin.graphql(
      `#graphql
      mutation MetafieldsSet($metafields: [MetafieldsSetInput!]!) {
        metafieldsSet(metafields: $metafields) {
          metafields { id key namespace }
          userErrors { field message }
        }
      }`,
      {
        variables: {
          metafields: metafieldsToSet,
        },
      }
    );

    const syncData = await syncResponse.json();
    if (syncData.data?.metafieldsSet?.userErrors?.length > 0) {
      console.error("MetafieldsSet userErrors:", syncData.data.metafieldsSet.userErrors);
    } else {
      console.log(`✅ Metafields synced for ${shop}: ${allTestimonials.length} items, hasPaidPlan: ${hasPaidPlan}, planName: ${planStatus.planName}, LimitReached: ${isLimitReached}`);
    }
  } catch (err) {
    console.error("Error syncing testimonials to metafields:", err);
  }
}
