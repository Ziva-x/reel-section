import { useState } from "react";
import {
  Modal,
  Text,
  BlockStack,
  InlineStack,
  Box,
  Button,
  Badge,
  Divider,
} from "@shopify/polaris";

export default function LiveChatWidget({ defaultOpen = false, shop = "" }) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  const cleanShop = shop ? shop.replace(".myshopify.com", "") : "Store";
  const mailtoUrl = `mailto:support@zxtysix.com?subject=Live%20Chat%20Support%20-%20Reel%20Section%20(${encodeURIComponent(shop)})&body=Hi%20ZXTYSIX%20Support%20Team%2C%0A%0AMy%20Store%3A%20${encodeURIComponent(shop)}%0A%0AI%20need%20assistance%20with%3A%20`;
  const whatsappUrl = `https://wa.me/919947877747?text=Hi%20ZXTYSIX%20Team%2C%20I%20am%20from%20${encodeURIComponent(cleanShop)}%20and%20need%20help%20with%20Reel%20Section.`;

  return (
    <>
      {/* Floating Corner Button */}
      <div
        style={{
          position: "fixed",
          bottom: "24px",
          right: "24px",
          zIndex: 99999,
        }}
      >
        <button
          type="button"
          onClick={() => setIsOpen(true)}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            backgroundColor: "#1a1a1a",
            color: "#ffffff",
            border: "1.5px solid #333333",
            borderRadius: "50px",
            padding: "10px 18px",
            fontSize: "14px",
            fontWeight: "600",
            cursor: "pointer",
            boxShadow: "0 8px 24px rgba(0, 0, 0, 0.25), 0 2px 6px rgba(0, 0, 0, 0.15)",
            transition: "all 0.2s ease",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.transform = "translateY(-3px) scale(1.02)";
            e.currentTarget.style.boxShadow = "0 12px 28px rgba(0, 0, 0, 0.35)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.transform = "translateY(0) scale(1)";
            e.currentTarget.style.boxShadow = "0 8px 24px rgba(0, 0, 0, 0.25)";
          }}
        >
          <span
            style={{
              display: "inline-block",
              width: "10px",
              height: "10px",
              backgroundColor: "#10b981",
              borderRadius: "50%",
              boxShadow: "0 0 8px #10b981",
            }}
          />
          <span>💬 Live Support</span>
        </button>
      </div>

      {/* Support Hub Modal */}
      <Modal
        open={isOpen}
        onClose={() => setIsOpen(false)}
        title="💬 ZXTYSIX Live Support Hub"
        size="small"
      >
        <Modal.Section>
          <BlockStack gap="400">
            <Text as="p" tone="subdued">
              Our engineering team is active and ready to help you with reel setup, theme customization, or any technical questions.
            </Text>

            <Divider />

            {/* Option 1: WhatsApp Live 24/7 */}
            <Box background="bg-surface-secondary" padding="300" borderRadius="200">
              <BlockStack gap="200">
                <InlineStack align="space-between" blockAlign="center">
                  <Text variant="bodyMd" fontWeight="bold">📱 Instant WhatsApp Chat</Text>
                  <Badge tone="success">Fastest (24/7)</Badge>
                </InlineStack>
                <Text variant="bodySm" tone="subdued">
                  Connect 1-on-1 on WhatsApp (+91 99478 77747) with our lead developer for immediate assistance.
                </Text>
                <Button
                  tone="success"
                  variant="primary"
                  fullWidth
                  url={whatsappUrl}
                  target="_blank"
                >
                  💬 Start WhatsApp Chat Now
                </Button>
              </BlockStack>
            </Box>

            {/* Option 2: Email Support */}
            <Box background="bg-surface-secondary" padding="300" borderRadius="200">
              <BlockStack gap="200">
                <InlineStack align="space-between" blockAlign="center">
                  <Text variant="bodyMd" fontWeight="bold">✉️ Direct Email Support</Text>
                  <Badge tone="info">All Inquiries</Badge>
                </InlineStack>
                <Text variant="bodySm" tone="subdued">
                  Send an email directly to <strong>support@zxtysix.com</strong>.
                </Text>
                <Button
                  variant="secondary"
                  fullWidth
                  url={mailtoUrl}
                >
                  ✉️ Send Email (support@zxtysix.com)
                </Button>
              </BlockStack>
            </Box>
          </BlockStack>
        </Modal.Section>
      </Modal>
    </>
  );
}
