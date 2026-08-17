import { useState } from "react";
import { json } from "@remix-run/node";
import { useLoaderData, useActionData, useSubmit, useNavigation, useNavigate } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  BlockStack,
  TextField,
  Button,
  Banner,
  Text,
  Badge,
  Divider,
  InlineStack,
  Box,
  Modal,
  Select,
  List,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { LIFETIME_PLAN, MONTHLY_PLAN } from "../constants";
import { syncTestimonialsToMetafields } from "../metafields.server";

export const loader = async ({ request }) => {
  const { session, billing } = await authenticate.admin(request);
  
  // 1. Check if store is blocked
  const blockedEntry = await prisma.blockedStore.findUnique({
    where: { shop: session.shop },
  });

  // 2. Check manual override
  const manualOverride = await prisma.storePlanOverride.findUnique({
    where: { shop: session.shop },
  });

  let hasPaidPlan = false;
  let activePlanName = "Free Starter";
  let planType = "free";

  if (blockedEntry) {
    activePlanName = "Account Suspended";
    planType = "blocked";
    hasPaidPlan = false;
  } else if (manualOverride) {
    if (manualOverride.plan === "LIFETIME") {
      activePlanName = "Lifetime Access ($10)";
      planType = "lifetime";
      hasPaidPlan = true;
    } else if (manualOverride.plan === "MONTHLY") {
      activePlanName = "Monthly Pro ($2/mo)";
      planType = "monthly";
      hasPaidPlan = true;
    } else {
      activePlanName = "Free Starter";
      planType = "free";
      hasPaidPlan = false;
    }
  } else {
    try {
      const billingCheck = await billing.check({
        plans: [LIFETIME_PLAN, MONTHLY_PLAN],
        isTest: true,
      });
      hasPaidPlan = !!billingCheck.hasActivePayment;
      if (hasPaidPlan) {
        activePlanName = billingCheck.appSubscriptions?.length > 0
          ? billingCheck.appSubscriptions[0].name
          : billingCheck.oneTimePurchases?.length > 0
          ? billingCheck.oneTimePurchases[0].name
          : "Pro Active";
        planType = "paid";
      }
    } catch (e) {
      hasPaidPlan = false;
    }
  }

  // Monthly view counts
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);

  const viewsThisMonth = await prisma.viewCount.aggregate({
    where: { shop: session.shop, date: { gte: monthStart, lte: monthEnd } },
    _sum: { count: true },
  });
  const monthlyViews = viewsThisMonth._sum.count || 0;

  return json({
    shop: session.shop,
    hasPaidPlan,
    activePlanName,
    planType,
    monthlyViews,
    monthlyLimit: 1000,
    isBlocked: !!blockedEntry,
    blockReason: blockedEntry?.reason || "",
  });
};

export const action = async ({ request }) => {
  const { session, billing, admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const actionType = formData.get("_action");

  if (actionType === "feedback") {
    const feedback = formData.get("feedback");
    const email = formData.get("email") || "";
    const rating = parseInt(formData.get("rating"), 10) || 5;
    const type = formData.get("type") || "feature";

    await prisma.feedback.create({
      data: {
        shop: session.shop,
        email,
        rating,
        type,
        message: feedback,
      }
    });
    console.log(`[${type.toUpperCase()} from ${session.shop}]:`, feedback);
    return json({ success: true, message: "Thank you! Your submission has been saved directly to the engineering dashboard." });
  }

  if (actionType === "sync_pro") {
    let hasPaidPlan = false;
    try {
      const billingCheck = await billing.check({
        plans: [LIFETIME_PLAN, MONTHLY_PLAN],
        isTest: true,
      });
      hasPaidPlan = !!billingCheck.hasActivePayment;
    } catch (e) {
      hasPaidPlan = false;
    }
    await syncTestimonialsToMetafields(admin, session.shop, hasPaidPlan);
    return json({ success: true, message: "Pro features successfully activated and synced to storefront!" });
  }

  return json({ success: true });
};

export default function Settings() {
  const { shop, hasPaidPlan, activePlanName, planType, monthlyViews, monthlyLimit, isBlocked, blockReason } = useLoaderData();
  const actionData = useActionData();
  const submit = useSubmit();
  const navigate = useNavigate();
  const nav = useNavigation();
  const isSubmitting = nav.state === "submitting";

  const [selectedRating, setSelectedRating] = useState(5);
  const [feedbackType, setFeedbackType] = useState("feature");
  const [feedbackText, setFeedbackText] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [showUninstallInfo, setShowUninstallInfo] = useState(false);
  const [secretUnlocked, setSecretUnlocked] = useState(false);
  const [tapCount, setTapCount] = useState(0);

  const cleanStoreName = shop.replace(".myshopify.com", "");
  const appsSettingsUrl = `https://admin.shopify.com/store/${cleanStoreName}/settings/apps`;
  const supportMailUrl = `mailto:support@zxtysix.com?subject=Support%20Request%20-%20Reel%20Section%20(${encodeURIComponent(shop)})&body=Hi%20Reel%20Section%20Support%20Team%2C%0A%0AStore%3A%20${encodeURIComponent(shop)}%0A%0AI%20need%20help%20with%3A%20`;

  const handleSendFeedback = () => {
    if (!feedbackText.trim()) return;
    submit(
      {
        _action: "feedback",
        feedback: feedbackText,
        rating: selectedRating.toString(),
        type: feedbackType,
        email: contactEmail,
      },
      { method: "post" }
    );
  };

  const handleSyncPro = () => {
    submit({ _action: "sync_pro" }, { method: "post" });
  };

  const planTone = isBlocked ? "critical" : hasPaidPlan ? "success" : "info";

  return (
    <Page
      title="Settings & Support"
      subtitle="Manage your store preferences, feedback, and customer support channels."
    >
      {isBlocked && (
        <div style={{ marginBottom: "20px" }}>
          <Banner title="🚫 Account Access Suspended" tone="critical">
            <p>
              Your access to video testimonials and analytics features has been suspended by the administrator.
            </p>
            {blockReason && (
              <p style={{ marginTop: "6px" }}>
                <strong>Reason:</strong> {blockReason}
              </p>
            )}
            <p style={{ marginTop: "6px" }}>
              You can still use the support & feedback form below to reach our team and request account reactivation.
            </p>
          </Banner>
        </div>
      )}

      {actionData?.message && (
        <div style={{ marginBottom: "20px" }}>
          <Banner title="Success" tone="success" onDismiss={() => {}}>
            <p>{actionData.message}</p>
          </Banner>
        </div>
      )}

      <Layout>
        {/* Left Column: Plan Info, Feedback, Developer Details, Manage App */}
        <Layout.Section>
          <BlockStack gap="500">
            {/* Current Subscription Plan Card */}
            <Card>
              <BlockStack gap="400">
                <InlineStack align="space-between" blockAlign="center">
                  <Text variant="headingMd" as="h3">💳 Current Subscription Plan</Text>
                  <Badge tone={planTone}>{activePlanName}</Badge>
                </InlineStack>
                
                <Text variant="bodyMd" tone="subdued">
                  {isBlocked
                    ? "Your plan is temporarily suspended. Reach out to support below for assistance."
                    : hasPaidPlan
                    ? "You have full access to Unlimited Video Views, Click-to-Shop Buy Tags, and Pro Customizations."
                    : "You are on the Free Starter tier with 1,000 free video views per calendar month."}
                </Text>

                <Divider />

                <InlineStack align="space-between" blockAlign="center">
                  <BlockStack gap="050">
                    <Text variant="bodySm" fontWeight="semibold">Monthly Video Impressions</Text>
                    <Text variant="bodySm" tone="subdued">
                      {hasPaidPlan ? "Unlimited (No Caps)" : `${monthlyViews.toLocaleString()} / 1,000 views used this month`}
                    </Text>
                  </BlockStack>
                  {!isBlocked && (
                    <Button onClick={() => navigate("/app/pricing")}>
                      {hasPaidPlan ? "Manage Plans" : "Upgrade to Pro"}
                    </Button>
                  )}
                </InlineStack>
              </BlockStack>
            </Card>

            {/* Feedback & Review Card */}
            <Card>
              <BlockStack gap="400">
                <InlineStack align="space-between" blockAlign="center">
                  <Text variant="headingMd" as="h3">⭐ Feedback, Suggestions & Complaints</Text>
                  <Badge tone="info">Help & Support</Badge>
                </InlineStack>
                <Text variant="bodyMd" tone="subdued">
                  Have a suggestion, question, or encountering an issue? Send your complaint or feature request directly to our engineering team.
                </Text>

                <BlockStack gap="200">
                  <Text variant="bodySm" fontWeight="semibold">Rate your experience:</Text>
                  <InlineStack gap="100">
                    {[1, 2, 3, 4, 5].map((star) => (
                      <button
                        key={star}
                        type="button"
                        onClick={() => setSelectedRating(star)}
                        style={{
                          background: "none",
                          border: "none",
                          cursor: "pointer",
                          padding: "4px",
                          fontSize: "24px",
                          lineHeight: 1,
                          filter: star <= selectedRating ? "grayscale(0%)" : "grayscale(100%) opacity(40%)",
                          transition: "transform 0.15s ease",
                        }}
                      >
                        ⭐
                      </button>
                    ))}
                    <Text variant="bodySm" tone="subdued" alignment="center">
                      ({selectedRating} / 5 Stars)
                    </Text>
                  </InlineStack>
                </BlockStack>

                <Select
                  label="Category"
                  options={[
                    { label: "💡 Feature Request / Suggestion", value: "feature" },
                    { label: "🐛 Bug Report / Complaint", value: "bug" },
                    { label: "⭐ General Feedback", value: "feedback" },
                  ]}
                  value={feedbackType}
                  onChange={setFeedbackType}
                />

                <TextField
                  label={feedbackType === "bug" ? "Describe the issue / complaint in detail:" : "Your feedback, suggestions, or feature requests:"}
                  value={feedbackText}
                  onChange={setFeedbackText}
                  multiline={4}
                  placeholder={feedbackType === "bug" ? "Please tell us what went wrong, what steps caused it, or what store behavior is unexpected..." : "Tell us what you love, or what features you'd like to see next..."}
                  autoComplete="off"
                />

                <TextField
                  label="Contact Email (Optional - for replies):"
                  value={contactEmail}
                  onChange={setContactEmail}
                  placeholder="merchant@yourstore.com"
                  autoComplete="email"
                />

                <InlineStack align="end">
                  <Button
                    variant="primary"
                    onClick={handleSendFeedback}
                    loading={isSubmitting}
                    disabled={!feedbackText.trim()}
                  >
                    Submit Feedback
                  </Button>
                </InlineStack>
              </BlockStack>
            </Card>

            {/* Developer Details Card */}
            <Card>
              <BlockStack gap="300">
                <div
                  onClick={() => {
                    const next = tapCount + 1;
                    setTapCount(next);
                    if (next >= 3) {
                      setSecretUnlocked(true);
                      navigate("/app/feedback-admin");
                    }
                  }}
                  style={{ cursor: "pointer", userSelect: "none" }}
                  title="Developer Details"
                >
                  <Text variant="headingMd" as="h3">👨‍💻 Developer Details</Text>
                </div>
                <Divider />
                <BlockStack gap="200">
                  <InlineStack align="space-between">
                    <Text variant="bodySm" tone="subdued">Company / Studio:</Text>
                    <Text variant="bodySm" fontWeight="semibold">ZXTYSIX LLP</Text>
                  </InlineStack>
                  <InlineStack align="space-between">
                    <Text variant="bodySm" tone="subdued">App Name:</Text>
                    <Text variant="bodySm" fontWeight="semibold">Reel Section</Text>
                  </InlineStack>
                  <InlineStack align="space-between">
                    <Text variant="bodySm" tone="subdued">Architecture:</Text>
                    <Text variant="bodySm" fontWeight="semibold">Shopify OS 2.0 Native</Text>
                  </InlineStack>
                  <InlineStack align="space-between">
                    <Text variant="bodySm" tone="subdued">Version:</Text>
                    <Text variant="bodySm" fontWeight="semibold">v2.4.0</Text>
                  </InlineStack>
                  <InlineStack align="space-between">
                    <Text variant="bodySm" tone="subdued">System Status:</Text>
                    <Badge tone="success">Operational</Badge>
                  </InlineStack>
                  {secretUnlocked && (
                    <>
                      <Divider />
                      <InlineStack align="end">
                        <Button
                          variant="primary"
                          onClick={() => navigate("/app/feedback-admin")}
                        >
                          🔒 Open Developer Portal
                        </Button>
                      </InlineStack>
                    </>
                  )}
                </BlockStack>
              </BlockStack>
            </Card>

            {/* Sync Pro Features Card */}
            <Card>
              <BlockStack gap="300">
                <InlineStack align="space-between" blockAlign="center">
                  <Text variant="headingMd" as="h3">🔄 Sync Pro Features</Text>
                  <Badge tone="success">Troubleshooting</Badge>
                </InlineStack>
                <Text variant="bodyMd" tone="subdued">
                  If you just purchased a Pro plan and your live storefront doesn't reflect the premium features yet, click below to force a manual synchronization.
                </Text>
                <Divider />
                <InlineStack>
                  <Button
                    variant="primary"
                    onClick={handleSyncPro}
                    loading={isSubmitting}
                  >
                    ✅ Activate Pro Features Now
                  </Button>
                </InlineStack>
              </BlockStack>
            </Card>

            {/* Manage & Uninstall App Card (Placed below Feedback) */}
            <Card>
              <BlockStack gap="300">
                <InlineStack align="space-between" blockAlign="center">
                  <Text variant="headingMd" as="h3">🗑️ Manage App</Text>
                  <Badge tone="subdued">Shopify Admin</Badge>
                </InlineStack>
                <Text variant="bodyMd" tone="subdued">
                  You can manage your subscription, review app permissions, or remove the app at any time directly through your official Shopify store settings.
                </Text>
                <Divider />
                <InlineStack gap="200" wrap>
                  <Button
                    variant="primary"
                    tone="critical"
                    url={appsSettingsUrl}
                    target="_blank"
                  >
                    Manage & Uninstall App
                  </Button>
                  <Button
                    variant="plain"
                    onClick={() => setShowUninstallInfo(true)}
                  >
                    Uninstall instructions
                  </Button>
                </InlineStack>
              </BlockStack>
            </Card>
          </BlockStack>
        </Layout.Section>

        {/* Right Column: Customer Support */}
        <Layout.Section variant="oneThird">
          <BlockStack gap="500">
            {/* YouTube Video Tutorials Card */}
            <Card>
              <BlockStack gap="400">
                <InlineStack align="space-between" blockAlign="center">
                  <Text variant="headingMd" as="h3">📺 Video Tutorials & Guides</Text>
                  <Badge tone="info">Watch & Learn</Badge>
                </InlineStack>
                <Text variant="bodyMd" tone="subdued">
                  Watch quick step-by-step video guides on setting up video reels, customizing theme styling, and boosting store conversions.
                </Text>
                
                <Divider />

                {/* YouTube Video Embed */}
                <div style={{ position: "relative", paddingBottom: "56.25%", height: 0, overflow: "hidden", borderRadius: "10px", boxShadow: "0 4px 12px rgba(0,0,0,0.1)" }}>
                  <iframe
                    src="https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?rel=0"
                    title="Reel Section Setup Tutorial"
                    style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", border: "none" }}
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                    allowFullScreen
                  />
                </div>

                <BlockStack gap="200">
                  <Text variant="bodySm" fontWeight="semibold">Tutorial Topics Covered:</Text>
                  <List type="bullet">
                    <List.Item>🎬 Uploading & syncing HD video reviews</List.Item>
                    <List.Item>🎨 Adding & styling the section in Theme Editor</List.Item>
                    <List.Item>⚡ Auto-play, loop speed & audio controls</List.Item>
                  </List>
                </BlockStack>

                <Button
                  variant="primary"
                  fullWidth
                  onClick={() => navigate("/app/tutorial")}
                >
                  🚀 Open Full Setup & Interactive Tour
                </Button>
              </BlockStack>
            </Card>
          </BlockStack>
        </Layout.Section>
      </Layout>
      <div style={{ height: "40px" }} />

      {/* Uninstall Guide Modal */}
      <Modal
        open={showUninstallInfo}
        onClose={() => setShowUninstallInfo(false)}
        title="How to Uninstall Reel Section"
        primaryAction={{
          content: "Open Shopify Apps Settings",
          url: appsSettingsUrl,
          target: "_blank",
        }}
        secondaryActions={[
          {
            content: "Close",
            onAction: () => setShowUninstallInfo(false),
          },
        ]}
      >
        <Modal.Section>
          <BlockStack gap="300">
            <Text as="p">To safely uninstall Reel Section from your store:</Text>
            <ol style={{ paddingLeft: "20px", margin: 0, lineHeight: 1.8 }}>
              <li>Go to <strong>Shopify Admin &rarr; Settings &rarr; Apps and sales channels</strong>.</li>
              <li>Find <strong>Reel Section</strong> in the list of installed apps.</li>
              <li>Click <strong>Uninstall</strong> to remove the app and cancel active recurring plans.</li>
            </ol>
            <Banner tone="info">
              <p>Because Reel Section uses native Shopify OS 2.0 Theme App Extensions, no leftover code will remain in your theme files after uninstalling!</p>
            </Banner>
          </BlockStack>
        </Modal.Section>
      </Modal>
    </Page>
  );
}
