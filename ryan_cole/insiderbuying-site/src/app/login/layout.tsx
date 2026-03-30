import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Log In | EarlyInsider",
  description:
    "Log in to your EarlyInsider account to access real-time insider trading alerts and AI-powered stock analysis.",
};

export default function LoginLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
