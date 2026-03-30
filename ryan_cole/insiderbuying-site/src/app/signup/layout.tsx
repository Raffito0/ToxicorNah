import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Sign Up | EarlyInsider",
  description:
    "Create your free EarlyInsider account. Get real-time SEC insider trading alerts and AI-powered conviction scoring.",
};

export default function SignupLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
