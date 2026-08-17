import { Link, Outlet, useLoaderData, useRouteError } from "@remix-run/react";
import { json, redirect } from "@remix-run/node";
import { boundary } from "@shopify/shopify-app-remix/server";
import { AppProvider } from "@shopify/shopify-app-remix/react";
import { NavMenu } from "@shopify/app-bridge-react";
import polarisStyles from "@shopify/polaris/build/esm/styles.css?url";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import LiveChatWidget from "../components/LiveChatWidget";

export const links = () => [{ rel: "stylesheet", href: polarisStyles }];

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const url = new URL(request.url);
  const pathname = url.pathname;

  // Check if store is blocked
  const blockedEntry = await prisma.blockedStore.findUnique({
    where: { shop: session.shop },
  });

  const isBlocked = !!blockedEntry;
  const isSuperAdmin = process.env.ADMIN_SHOP && session.shop === process.env.ADMIN_SHOP;

  // If blocked, lock down all routes and allow ONLY /app/settings
  if (isBlocked && !isSuperAdmin) {
    if (!pathname.startsWith("/app/settings")) {
      return redirect("/app/settings");
    }
  }

  return json({
    apiKey: process.env.SHOPIFY_API_KEY || "",
    shop: session.shop,
    isBlocked,
    blockReason: blockedEntry?.reason || "",
  });
};

export default function App() {
  const { apiKey, shop, isBlocked } = useLoaderData();

  return (
    <AppProvider isEmbeddedApp apiKey={apiKey}>
      <NavMenu>
        {isBlocked ? (
          <Link to="/app/settings" rel="home">Settings</Link>
        ) : (
          <>
            <Link to="/app" rel="home">Testimonials</Link>
            <Link to="/app/tutorial">Setup & Tour</Link>
            <Link to="/app/analytics">Analytics</Link>
            <Link to="/app/pricing">Plans & Pricing</Link>
            <Link to="/app/settings">Settings</Link>
          </>
        )}
      </NavMenu>
      <Outlet />
      <LiveChatWidget shop={shop} />
    </AppProvider>
  );
}

// Shopify needs Remix to catch some thrown responses, so that their headers are included in the response.
export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
