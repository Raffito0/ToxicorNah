import { builder } from "@builder.io/sdk-react";

builder.init("9547722ddcb045788c11c833b33bff32");

// Register custom components so they appear in Builder's visual editor
// These let you drag your site's actual components into Builder pages

builder.register("insertMenu", {
  name: "EarlyInsider Components",
  items: [
    { name: "HeroSection" },
    { name: "StatsSection" },
    { name: "PricingCard" },
    { name: "CTASection" },
  ],
});
