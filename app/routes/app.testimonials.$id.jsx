import { useState } from "react";
import { json, redirect } from "@remix-run/node";
import { useActionData, useLoaderData, useNavigate, useSubmit, useNavigation } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  BlockStack,
  TextField,
  Button,
  Select,
  Checkbox,
  PageActions,
  Banner,
  Badge,
  InlineStack,
  Text,
  Modal,
  Box,
  Divider,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { syncTestimonialsToMetafields } from "../metafields.server";
import { LIFETIME_PLAN, MONTHLY_PLAN } from "../constants";

export const loader = async ({ request, params }) => {
  const { session, billing } = await authenticate.admin(request);
  const id = params.id;

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

  if (id === "new") {
    return json({ testimonial: null, hasPaidPlan });
  }

  const testimonial = await prisma.testimonial.findUnique({
    where: { id: parseInt(id), shop: session.shop },
  });

  if (!testimonial) {
    return redirect("/app");
  }

  return json({ testimonial, hasPaidPlan });
};

export const action = async ({ request, params }) => {
  const { session, admin } = await authenticate.admin(request);
  const { shop } = session;
  const id = params.id;
  
  const formData = await request.formData();
  const actionType = formData.get("_action");

  if (actionType === "delete") {
    await prisma.testimonial.delete({
      where: { id: parseInt(id), shop },
    });
    await syncTestimonialsToMetafields(admin, shop, false, null, true);
    return redirect("/app");
  }

  const videoUrl = formData.get("videoUrl");
  const MAX_VIDEO_MB = 100;
  const MAX_VIDEO_BYTES = MAX_VIDEO_MB * 1024 * 1024;

  if (!videoUrl) {
    return json({ error: "Video URL is required." }, { status: 400 });
  }

  const VIDEO_EXTENSIONS = [
    ".mp4", ".webm", ".mov", ".avi", ".mkv", ".flv", ".wmv",
    ".m4v", ".ogv", ".ogg", ".3gp", ".ts", ".mpeg", ".mpg",
    ".gif",
  ];
  const lowerUrl = videoUrl.toLowerCase().split("?")[0];
  const isValidFormat = VIDEO_EXTENSIONS.some((ext) => lowerUrl.endsWith(ext));
  if (!isValidFormat) {
    return json({
      error: `Unsupported file format. Supported formats: ${VIDEO_EXTENSIONS.join(", ")}.`
    }, { status: 400 });
  }

  try {
    const headRes = await fetch(videoUrl, { method: "HEAD" });
    const contentLength = headRes.headers.get("content-length");
    if (contentLength && parseInt(contentLength) > MAX_VIDEO_BYTES) {
      const sizeMB = (parseInt(contentLength) / 1024 / 1024).toFixed(1);
      return json({
        error: `Video file is ${sizeMB} MB, which exceeds the ${MAX_VIDEO_MB} MB limit.`
      }, { status: 400 });
    }
  } catch (e) {
    console.warn("Could not check video file size:", e.message);
  }

  const data = {
    shop,
    videoUrl,
    webmUrl: formData.get("webmUrl") || null,
    posterUrl: formData.get("posterUrl") || null,
    autoplay: formData.get("autoplay") === "true",
    customerName: formData.get("customerName"),
    customerRole: formData.get("customerRole") || null,
    reviewText: formData.get("reviewText") || null,
    rating: parseInt(formData.get("rating")) || 5,
    verified: formData.get("verified") === "true",
    productHandle: formData.get("productHandle") || null,
  };

  if (id === "new") {
    await prisma.testimonial.create({ data });
  } else {
    await prisma.testimonial.update({
      where: { id: parseInt(id), shop },
      data,
    });
  }

  await syncTestimonialsToMetafields(admin, shop);

  return redirect("/app");
};

export default function TestimonialForm() {
  const { testimonial, hasPaidPlan } = useLoaderData();
  const actionData = useActionData();
  const navigate = useNavigate();
  const submit = useSubmit();
  const nav = useNavigation();
  const isSaving = nav.state === "submitting" && nav.formData?.get("_action") === "save";
  const isDeleting = nav.state === "submitting" && nav.formData?.get("_action") === "delete";

  const [formState, setFormState] = useState(
    testimonial
      ? {
          ...testimonial,
          videoUrl: testimonial.videoUrl || "",
          webmUrl: testimonial.webmUrl === "null" || !testimonial.webmUrl ? "" : testimonial.webmUrl,
          posterUrl: testimonial.posterUrl === "null" || !testimonial.posterUrl ? "" : testimonial.posterUrl,
          customerName: testimonial.customerName || "",
          customerRole: testimonial.customerRole || "",
          reviewText: testimonial.reviewText || "",
          productHandle: testimonial.productHandle === "null" || !testimonial.productHandle ? "" : testimonial.productHandle,
        }
      : {
          videoUrl: "",
          webmUrl: "",
          posterUrl: "",
          customerName: "",
          customerRole: "",
          reviewText: "",
          rating: 5,
          autoplay: true,
          verified: true,
          productHandle: "",
        }
  );

  const [showProLockModal, setShowProLockModal] = useState(false);

  const handleSave = () => {
    // If free user tries to save with a product handle, prompt them to upgrade to Pro
    if (!hasPaidPlan && formState.productHandle?.trim()) {
      setShowProLockModal(true);
      return;
    }
    submit({ ...formState, _action: "save" }, { method: "post" });
  };

  const handleSaveWithoutProduct = () => {
    setShowProLockModal(false);
    submit({ ...formState, productHandle: "", _action: "save" }, { method: "post" });
  };

  const handleDelete = () => {
    submit({ _action: "delete" }, { method: "post" });
  };

  return (
    <Page
      breadcrumbs={[{ content: "Testimonials", onAction: () => navigate("/app") }]}
      title={testimonial ? "Edit Testimonial" : "Create Testimonial"}
    >
      <Layout>
        <Layout.Section>
          <BlockStack gap="500">
            {actionData?.error && (
              <Banner title="Error saving testimonial" status="critical">
                <p>{actionData.error}</p>
              </Banner>
            )}

            {/* Video File Card */}
            <Card>
              <BlockStack gap="400">
                <Text variant="headingMd" as="h3">🎬 Video Media</Text>
                
                <Banner tone="warning">
                  <p>
                    <strong>⚡ Speed & Performance Tip:</strong> Keep video file sizes <strong>below 10 MB</strong> (ideally 2–8 MB compressed MP4/WebM). Uploading large video files will slow down your store's page loading speed and mobile conversions.
                  </p>
                </Banner>

                <TextField
                  label="Video URL (MP4 / WebM / MOV / All Formats)"
                  value={formState.videoUrl}
                  onChange={(val) => setFormState({ ...formState, videoUrl: val })}
                  helpText="Direct Shopify CDN link. Upload in Shopify Admin → Settings → Files (or Content → Files). Keep below 10 MB for fast page loading."
                  autoComplete="off"
                  error={actionData?.error?.includes("Video") ? actionData.error : undefined}
                />
                <TextField
                  label="Poster Thumbnail Image URL (Optional)"
                  value={formState.posterUrl}
                  onChange={(val) => setFormState({ ...formState, posterUrl: val })}
                  helpText="Optional: Leave empty for automatic HD first-frame capture."
                  autoComplete="off"
                />
                <Checkbox
                  label="Autoplay when visible on screen"
                  checked={formState.autoplay}
                  onChange={(val) => setFormState({ ...formState, autoplay: val })}
                />
              </BlockStack>
            </Card>

            {/* Customer Review Info Card */}
            <Card>
              <BlockStack gap="400">
                <Text variant="headingMd" as="h3">👤 Customer Review Details</Text>
                <TextField
                  label="Customer Name"
                  value={formState.customerName}
                  onChange={(val) => setFormState({ ...formState, customerName: val })}
                  autoComplete="off"
                />
                <TextField
                  label="Role or Location (Subtitle)"
                  value={formState.customerRole}
                  onChange={(val) => setFormState({ ...formState, customerRole: val })}
                  helpText="e.g. Verified Buyer, New York"
                  autoComplete="off"
                />
                <TextField
                  label="Review Text"
                  value={formState.reviewText}
                  onChange={(val) => setFormState({ ...formState, reviewText: val })}
                  multiline={4}
                  autoComplete="off"
                />
                <Select
                  label="Rating"
                  options={[
                    { label: "5 Stars (★★★★★)", value: "5" },
                    { label: "4 Stars (★★★★☆)", value: "4" },
                    { label: "3 Stars (★★★☆☆)", value: "3" },
                    { label: "2 Stars (★★☆☆☆)", value: "2" },
                    { label: "1 Star (★☆☆☆☆)", value: "1" },
                  ]}
                  value={formState.rating.toString()}
                  onChange={(val) => setFormState({ ...formState, rating: parseInt(val) })}
                />
                <Checkbox
                  label="Show Verified Buyer Badge"
                  checked={formState.verified}
                  onChange={(val) => setFormState({ ...formState, verified: val })}
                />
              </BlockStack>
            </Card>

            {/* Premium Feature: Click-to-Shop Product Link */}
            <Card background="bg-surface-secondary">
              <BlockStack gap="400">
                <InlineStack align="space-between" blockAlign="center" wrap>
                  <InlineStack gap="200" blockAlign="center">
                    <Text variant="headingMd" as="h3">🛍️ Product Link & 1-Click Buy</Text>
                    <Badge tone={hasPaidPlan ? "success" : "attention"}>
                      {hasPaidPlan ? "⭐ Pro Plan (Active)" : "⭐ Pro Feature [Try in Preview]"}
                    </Badge>
                  </InlineStack>
                </InlineStack>

                <Text as="p" tone="subdued">
                  Tag a product handle to render a <strong>Liquid Glass Product Pill</strong> on the bottom-left of the video card with thumbnail, live price, and direct checkout link.
                </Text>

                <TextField
                  label="Shopify Product Handle"
                  value={formState.productHandle}
                  onChange={(val) => setFormState({ ...formState, productHandle: val })}
                  placeholder="e.g. the-collection-snowboard-liquid"
                  autoComplete="off"
                />

                {/* Visual Guide: How to find your handle */}
                <Box background="bg-surface" padding="300" borderRadius="200" borderWidth="025" borderColor="border">
                  <BlockStack gap="200">
                    <Text variant="headingSm" as="h4">🔍 How to get your Product Handle:</Text>
                    <Text as="p" variant="bodySm">
                      <strong>Method 1 (Storefront URL — Fastest):</strong> View your product page in your browser. The handle is the text after <code>/products/</code> in your URL.
                    </Text>
                    <Box background="bg-surface-secondary" padding="200" borderRadius="100">
                      <Text as="p" variant="bodySm">
                        <code>https://your-store.myshopify.com/products/<strong>the-collection-snowboard-liquid</strong></code>
                      </Text>
                    </Box>
                    <Text as="p" variant="bodySm" tone="subdued">
                      <strong>Method 2 (Shopify Admin):</strong> Go to <strong>Products</strong> → Select your product → Scroll to the bottom to <strong>Search engine listing</strong> → Click <strong>Edit</strong> → Copy the <strong>URL handle</strong>.
                    </Text>
                  </BlockStack>
                </Box>

                {!hasPaidPlan && (
                  <Banner tone="info">
                    <p>💡 <strong>Preview Mode:</strong> You can enter product handles to preview how Liquid Glass tags look, but saving active product links on your live store requires a Pro plan (<strong>Monthly Pro for $2/mo</strong> or <strong>Lifetime Access for $10</strong>).</p>
                  </Banner>
                )}
              </BlockStack>
            </Card>
          </BlockStack>
        </Layout.Section>
      </Layout>

      {/* Pro Lock Upgrade Modal */}
      <Modal
        open={showProLockModal}
        onClose={() => setShowProLockModal(false)}
        title="🔒 Product Tagging Requires a Pro Plan"
        primaryAction={{
          content: "View Pro Plans ($2/mo or $10) →",
          onAction: () => {
            setShowProLockModal(false);
            navigate("/app/pricing");
          },
        }}
        secondaryActions={[
          {
            content: "Save without Product Link",
            onAction: handleSaveWithoutProduct,
          },
          {
            content: "Keep Editing",
            onAction: () => setShowProLockModal(false),
          },
        ]}
      >
        <Modal.Section>
          <BlockStack gap="400">
            <Text as="p">
              You tagged <strong>"{formState.productHandle}"</strong> on this video review.
            </Text>
            <Banner tone="info" title="⭐ Pro Feature (Monthly & Lifetime)">
              <p>
                Direct <strong>Click-to-Shop Liquid Glass Product Tags & 1-Click Buy</strong> is available on both our <strong>$2/month Monthly Pro</strong> and <strong>$10 Lifetime Access</strong> plans.
              </p>
            </Banner>
            <Text as="p" tone="subdued">
              Would you like to upgrade to activate unlimited views and direct product checkout, or save this review without product tagging?
            </Text>
          </BlockStack>
        </Modal.Section>
      </Modal>
      <div style={{ height: "60px" }} />

      <PageActions
        primaryAction={{
          content: "Save Testimonial",
          onAction: handleSave,
          loading: isSaving,
        }}
        secondaryActions={
          testimonial
            ? [
                {
                  content: "Delete",
                  destructive: true,
                  onAction: handleDelete,
                  loading: isDeleting,
                },
              ]
            : []
        }
      />
    </Page>
  );
}
