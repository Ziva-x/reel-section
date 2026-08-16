import { useState, useEffect } from "react";
import { json } from "@remix-run/node";
import { useLoaderData, useNavigate, useRevalidator, useNavigation } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  BlockStack,
  Text,
  List,
  Badge,
  Divider,
  Box,
  InlineStack,
  Banner,
  Collapsible,
  Button,
  ProgressBar,
  Checkbox,
  Modal,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export const loader = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);

  // 1. Check if any testimonials exist
  const testimonialCount = await prisma.testimonial.count({
    where: { shop: session.shop },
  });

  // 2. Check if any storefront impressions have been logged
  const viewAgg = await prisma.viewCount.aggregate({
    where: { shop: session.shop },
    _sum: { count: true },
  });
  const totalViews = viewAgg._sum.count || 0;

  // 3. Try to check theme files if section block is added
  let isThemeBlockDetected = totalViews > 0;
  try {
    const themeRes = await admin.graphql(`
      query {
        themes(first: 5, roles: [MAIN]) {
          nodes {
            id
            name
            files(filenames: ["templates/index.json", "templates/product.json", "config/settings_data.json"]) {
              nodes {
                filename
                body {
                  ... on OnlineStoreThemeFileBodyText {
                    content
                  }
                }
              }
            }
          }
        }
      }
    `);
    const themeJson = await themeRes.json();
    const mainTheme = themeJson?.data?.themes?.nodes?.[0];
    if (mainTheme?.files?.nodes) {
      for (const f of mainTheme.files.nodes) {
        const c = f.body?.content || "";
        if (c.includes("video-testimonials") || c.includes("reelsection") || c.includes("video_testimonials")) {
          isThemeBlockDetected = true;
          break;
        }
      }
    }
  } catch (err) {
    // If read_themes scope not yet accepted, fallback to totalViews check
  }

  return json({
    shop: session.shop,
    testimonialCount,
    totalViews,
    isThemeBlockDetected,
  });
};

function Confetti({ active }) {
  if (!active) return null;
  const colors = ["#C9A15A", "#7C3AED", "#10B981", "#F59E0B", "#3B82F6", "#EF4444", "#EC4899", "#8B5CF6"];
  const pieces = Array.from({ length: 45 });
  return (
    <div style={{ position: "fixed", top: 0, left: 0, width: "100%", height: "100%", pointerEvents: "none", zIndex: 99999, overflow: "hidden" }}>
      {pieces.map((_, i) => {
        const bg = colors[i % colors.length];
        const left = `${(i * 2.2) % 100}%`;
        const delay = `${(i * 0.08) % 1.5}s`;
        const duration = `${2 + (i % 3) * 0.5}s`;
        const size = i % 2 === 0 ? "11px" : "7px";
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              top: "-20px",
              left,
              width: size,
              height: size,
              backgroundColor: bg,
              borderRadius: i % 3 === 0 ? "50%" : "2px",
              opacity: 0.95,
              animation: `popperFall ${duration} ease-in ${delay} infinite`,
            }}
          />
        );
      })}
      <style>{`
        @keyframes popperFall {
          0% { transform: translateY(0) rotate(0deg) scale(0.8); opacity: 1; }
          50% { transform: translateY(50vh) rotate(360deg) scale(1.2); opacity: 0.9; }
          100% { transform: translateY(105vh) rotate(720deg) scale(0.6); opacity: 0; }
        }
      `}</style>
    </div>
  );
}

const faqs = [
  {
    q: "What video formats are supported?",
    a: "All major video formats are supported, including MP4, WebM, MOV, GIF, AVI, MKV, FLV, WMV, M4V, and 3GP (up to 100MB file size). MP4 is recommended for fastest mobile streaming.",
  },
  {
    q: "Do I need to upload a poster thumbnail image?",
    a: "No, poster images are completely optional! If you leave the poster URL empty, the app automatically extracts and displays the video's first frame in crisp HD quality as the thumbnail.",
  },
  {
    q: "Where should I host my video files?",
    a: "Upload videos directly to Shopify Admin → Settings → Files (or Content → Files). Click the link icon next to your uploaded video to copy the free, fast Shopify CDN URL.",
  },
  {
    q: "How do I customize card colors, sizes, and fonts?",
    a: "All visual styling is customized live in the Shopify Theme Editor! Go to Online Store → Themes → Customize, click on your Reel Section block, and adjust card width, height, colors, headings, arrow controls, and auto-loop timers.",
  },
  {
    q: "How do I make the reel specific to a product?",
    a: "When creating or editing a testimonial in the app, type in the Product Handle (e.g., 'leather-jacket'). The video review will only display on that product's page in your store.",
  },
  {
    q: "How does the Auto-Loop carousel work?",
    a: "You can enable 'Auto-loop carousel timer' in the Theme Customizer and choose your preferred speed (from 2 to 10 seconds). The carousel will smoothly advance and seamlessly wrap back to the start. It automatically pauses when customers hover, touch, or play a video.",
  },
  {
    q: "Do I need to touch or configure metafields?",
    a: "Not at all! Whenever you create, edit, or delete a video testimonial, the app automatically updates and syncs your shop metafields in real time.",
  },
  {
    q: "How can I reach support if I need help?",
    a: "You can chat with our team on WhatsApp support 24/7 via the Settings & Support page, or reach out at +91 99478 77747.",
  },
];

function FAQItem({ question, answer }) {
  const [open, setOpen] = useState(false);
  return (
    <Box>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        style={{
          width: "100%",
          background: "none",
          border: "none",
          cursor: "pointer",
          padding: "14px 0",
          textAlign: "left",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <Text variant="headingSm" as="span">{question}</Text>
        <Text as="span" tone="subdued">{open ? "▲" : "▼"}</Text>
      </button>
      <Collapsible open={open} id={`faq-${question}`}>
        <Box paddingBlockEnd="300">
          <Text as="p" tone="subdued">{answer}</Text>
        </Box>
      </Collapsible>
      <Divider />
    </Box>
  );
}

export default function SetupTour() {
  const { shop, testimonialCount, totalViews, isThemeBlockDetected } = useLoaderData();
  const navigate = useNavigate();
  const revalidator = useRevalidator();
  const navigation = useNavigation();

  const [step2Manual, setStep2Manual] = useState(false);
  const [step3Manual, setStep3Manual] = useState(false);
  const [showConfetti, setShowConfetti] = useState(false);
  const [showWelcomeModal, setShowWelcomeModal] = useState(false);

  useEffect(() => {
    try {
      const s2 = window.localStorage.getItem("pvt_step2_theme_added");
      const s3 = window.localStorage.getItem("pvt_step3_customized");
      if (s2 === "true" || isThemeBlockDetected || totalViews > 0) setStep2Manual(true);
      if (s3 === "true" || isThemeBlockDetected || totalViews > 0) setStep3Manual(true);
    } catch (e) {}
  }, [isThemeBlockDetected, totalViews]);

  const step1Done = testimonialCount > 0;
  const step2Done = isThemeBlockDetected || step2Manual || totalViews > 0;
  const step3Done = step3Manual || isThemeBlockDetected || totalViews > 0;
  const step4Done = totalViews > 0 || (step1Done && step2Done);

  const completedCount = [step1Done, step2Done, step3Done, step4Done].filter(Boolean).length;
  const progressPercent = Math.round((completedCount / 4) * 100);

  // Trigger celebratory confetti and welcome popup when all steps are completed
  useEffect(() => {
    if (progressPercent === 100) {
      try {
        const hasCelebrated = window.sessionStorage.getItem("pvt_onboarding_celebrated");
        if (!hasCelebrated) {
          window.sessionStorage.setItem("pvt_onboarding_celebrated", "1");
          setShowConfetti(true);
          const modalTimer = setTimeout(() => setShowWelcomeModal(true), 400);
          const confettiTimer = setTimeout(() => setShowConfetti(false), 4000);
          return () => {
            clearTimeout(modalTimer);
            clearTimeout(confettiTimer);
          };
        }
      } catch (e) {}
    }
  }, [progressPercent]);

  const triggerCelebration = () => {
    setShowConfetti(true);
    setShowWelcomeModal(true);
    setTimeout(() => setShowConfetti(false), 4000);
  };

  const toggleStep2 = () => {
    const nextVal = !step2Done;
    setStep2Manual(nextVal);
    try { window.localStorage.setItem("pvt_step2_theme_added", String(nextVal)); } catch (e) {}
  };

  const toggleStep3 = () => {
    const nextVal = !step3Done;
    setStep3Manual(nextVal);
    try { window.localStorage.setItem("pvt_step3_customized", String(nextVal)); } catch (e) {}
  };

  const themeEditorUrl = `https://${shop}/admin/themes/current/editor`;

  return (
    <Page
      title="Setup & Interactive Tour"
      subtitle="Follow your live progress checklist to launch high-converting video review reels."
    >
      <Confetti active={showConfetti} />

      <Layout>
        {/* Progress Tracker Banner */}
        <Layout.Section>
          <Card background="bg-surface-secondary">
            <BlockStack gap="400">
              <InlineStack align="space-between" blockAlign="center" wrap>
                <BlockStack gap="100">
                  <Text variant="headingLg" as="h2">🚀 Onboarding & Launch Progress</Text>
                  <Text variant="bodyMd" tone="subdued">
                    {completedCount} of 4 steps completed ({progressPercent}%)
                  </Text>
                </BlockStack>
                <InlineStack gap="200" blockAlign="center">
                  <Badge
                    tone={progressPercent === 100 ? "success" : progressPercent >= 50 ? "attention" : "info"}
                    size="large"
                  >
                    {progressPercent === 100 ? "🎉 Fully Configured & Live!" : `${progressPercent}% Complete`}
                  </Badge>
                  {progressPercent === 100 && (
                    <Button size="slim" onClick={triggerCelebration}>
                      🎉 View Welcome Perks
                    </Button>
                  )}
                </InlineStack>
              </InlineStack>

              <ProgressBar progress={progressPercent} size="small" tone={progressPercent === 100 ? "success" : "primary"} />

              {progressPercent === 100 && (
                <Banner
                  tone="success"
                  title="Congratulations! Setup Complete 🎉"
                  action={{
                    content: "View Quick Tips",
                    onAction: triggerCelebration,
                  }}
                >
                  <p>All setup steps are completed and your video testimonials are live on your storefront!</p>
                </Banner>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* Step 1 */}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <InlineStack align="space-between" blockAlign="center" wrap>
                <InlineStack gap="300" blockAlign="center">
                  <Badge tone={step1Done ? "success" : "attention"}>
                    {step1Done ? "✅ Step 1: Complete" : "Step 1: Pending"}
                  </Badge>
                  <Text variant="headingMd" as="h3">Add Your Video Reviews</Text>
                </InlineStack>
                {step1Done && (
                  <Badge tone="success">{testimonialCount} {testimonialCount === 1 ? "Video" : "Videos"} Synced</Badge>
                )}
              </InlineStack>

              <Text as="p">
                Upload your video to <strong>Shopify Admin → Content → Files</strong> (or Settings → Files), then create your testimonial entry with customer name, star rating, and review text.
              </Text>

              <List type="bullet">
                <List.Item>Supports <code>.mp4</code>, <code>.mov</code>, <code>.webm</code>, <code>.gif</code>, and all formats up to 100MB.</List.Item>
                <List.Item>Poster thumbnails are optional — the app auto-captures the video's first frame in HD!</List.Item>
              </List>

              <InlineStack gap="200">
                <Button variant="primary" onClick={() => navigate("/app")}>
                  {step1Done ? "Manage Testimonials" : "Create First Testimonial"}
                </Button>
              </InlineStack>
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* Step 2 */}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <InlineStack align="space-between" blockAlign="center" wrap>
                <InlineStack gap="300" blockAlign="center">
                  <Badge tone={step2Done ? "success" : "attention"}>
                    {step2Done ? (isThemeBlockDetected ? "✅ Step 2: Auto-Detected in Theme" : "✅ Step 2: Complete") : "Step 2: Pending"}
                  </Badge>
                  <Text variant="headingMd" as="h3">Add Reel Section to Your Theme</Text>
                </InlineStack>
                <Checkbox
                  label="Mark as added"
                  checked={step2Done}
                  onChange={toggleStep2}
                />
              </InlineStack>

              <Text as="p">
                Open your Shopify Theme Customizer and add the section block anywhere on your store:
              </Text>

              <List type="number">
                <List.Item>Click the <strong>Open Theme Editor</strong> button below.</List.Item>
                <List.Item>Navigate to any page (Home, Product, or Landing Page).</List.Item>
                <List.Item>Click <strong>Add section</strong> → Switch to the <strong>Apps</strong> tab → Choose <strong>Reel Section</strong>.</List.Item>
                <List.Item>Click <strong>Save</strong> in the top right corner.</List.Item>
              </List>

              <InlineStack gap="200">
                <Button variant="primary" url={themeEditorUrl} target="_blank">
                  Open Theme Editor ↗
                </Button>
                <Button onClick={toggleStep2}>
                  {step2Done ? "Mark as Incomplete" : "Mark as Completed ✓"}
                </Button>
              </InlineStack>
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* Step 3 */}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <InlineStack align="space-between" blockAlign="center" wrap>
                <InlineStack gap="300" blockAlign="center">
                  <Badge tone={step3Done ? "success" : "attention"}>
                    {step3Done ? "✅ Step 3: Complete" : "Step 3: Pending"}
                  </Badge>
                  <Text variant="headingMd" as="h3">Customize Visual Styling & Sizing</Text>
                </InlineStack>
                <Checkbox
                  label="Mark as customized"
                  checked={step3Done}
                  onChange={toggleStep3}
                />
              </InlineStack>

              <Text as="p">
                Click on the <strong>Reel Section</strong> block in your Theme Editor sidebar to tailor the look and feel:
              </Text>

              <List type="bullet">
                <List.Item><strong>Card Dimensions:</strong> Set custom Card width (200–400px) and Media height (300–600px).</List.Item>
                <List.Item><strong>Colors:</strong> Match your store branding with custom card backgrounds, borders, text, and badge colors.</List.Item>
                <List.Item><strong>Auto-Play & Auto-Loop:</strong> Enable simultaneous auto-play and adjust auto-loop sliding speed slider (2–10s).</List.Item>
                <List.Item><strong>Audio Controls:</strong> Toggle the visitor unmute sound button.</List.Item>
              </List>

              <InlineStack gap="200">
                <Button url={themeEditorUrl} target="_blank">
                  Customize in Theme Editor ↗
                </Button>
                <Button onClick={toggleStep3}>
                  {step3Done ? "Mark as Incomplete" : "Mark as Completed ✓"}
                </Button>
              </InlineStack>
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* Step 4 */}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <InlineStack align="space-between" blockAlign="center" wrap>
                <InlineStack gap="300" blockAlign="center">
                  <Badge tone={step4Done ? "success" : "info"}>
                    {step4Done ? "✅ Step 4: Live & Active" : "Step 4: Ready for Traffic"}
                  </Badge>
                  <Text variant="headingMd" as="h3">Track Impressions & Video Views</Text>
                </InlineStack>
                <Badge tone="info">{totalViews.toLocaleString()} Total Impressions</Badge>
              </InlineStack>

              <Text as="p">
                Whenever customers visit your storefront, Reel Section automatically records view metrics.
                Track performance and view counters directly inside the Analytics dashboard.
              </Text>

              <InlineStack gap="200">
                <Button variant="primary" onClick={() => navigate("/app/analytics")}>
                  View Analytics Dashboard
                </Button>
              </InlineStack>
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* Collapsible FAQ */}
        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <Text variant="headingMd" as="h2">Frequently Asked Questions (FAQ)</Text>
              <Divider />
              {faqs.map((faq) => (
                <FAQItem key={faq.q} question={faq.q} answer={faq.a} />
              ))}
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
      <div style={{ height: "40px" }} />

      {/* Celebratory Welcome Modal */}
      <Modal
        open={showWelcomeModal}
        onClose={() => setShowWelcomeModal(false)}
        title="🎉 Welcome to Reel Section — Setup Complete!"
        primaryAction={{
          content: "Go to Dashboard & Manage Testimonials",
          onAction: () => {
            setShowWelcomeModal(false);
            navigate("/app");
          },
        }}
        secondaryActions={[
          {
            content: "Customize in Theme Editor ↗",
            onAction: () => {
              window.open(themeEditorUrl, "_blank");
            },
          },
        ]}
      >
        <Modal.Section>
          <BlockStack gap="400">
            <Banner tone="success" title="Your Video Review Reels Are Live!">
              <p>
                Congratulations! Your store is now fully set up with high-converting video review reels. Your impressions are now being tracked in real time!
              </p>
            </Banner>

            <Box padding="300" background="bg-surface-secondary" borderRadius="200">
              <BlockStack gap="200">
                <Text variant="headingSm" as="h4">🚀 Quick Tips for Success:</Text>
                <List>
                  <List.Item><strong>Upload frequently:</strong> Add new customer video reviews to keep your store fresh.</List.Item>
                  <List.Item><strong>Tag your products:</strong> Link a product handle to a video so it only appears on that specific product's page.</List.Item>
                  <List.Item><strong>Track your views:</strong> Use the Analytics dashboard to see how many people are watching your reviews.</List.Item>
                  <List.Item><strong>Customize freely:</strong> Go to the Theme Editor anytime to adjust colors, sizes, and layout modes.</List.Item>
                </List>
              </BlockStack>
            </Box>

            <Text as="p" tone="subdued">
              💡 Need direct help or custom styling advice? You can chat with our team on WhatsApp directly in the Settings tab!
            </Text>
          </BlockStack>
        </Modal.Section>
      </Modal>
    </Page>
  );
}
